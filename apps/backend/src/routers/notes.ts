import { TRPCError } from '@trpc/server'
import { and, desc, eq, gte, inArray, notInArray } from 'drizzle-orm'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { router, protectedProcedure } from '../router.js'
import { files, noteRevisions, notes, noteTags, syncTombstones } from '../db/schema.js'
import { assertListAccess } from '../lib/access.js'
import { removeStoredFiles } from '../lib/fileStore.js'
import {
  MAX_FILE_METADATA, MAX_ID, MAX_IMPORT_BATCH, MAX_NOTE_PAYLOAD, MAX_REVISIONS_PER_NOTE,
  MAX_TAG_PAYLOAD, REVISION_INTERVAL_MS,
} from '../lib/limits.js'

const noteInput = z.object({ id: z.string().uuid(), encryptedPayload: z.string().max(MAX_NOTE_PAYLOAD) })
const tagInput = z.object({ id: z.string().uuid(), encryptedPayload: z.string().max(MAX_TAG_PAYLOAD) })

async function loadNote(db: any, noteId: string, userId: string) {
  const [note] = await db.select().from(notes).where(eq(notes.id, noteId))
  if (!note) throw new TRPCError({ code: 'NOT_FOUND' })
  await assertListAccess(db, note.listId, userId)
  return note as typeof notes.$inferSelect
}

/**
 * Insert unless the id already exists. A retried offline creation must neither
 * duplicate nor overwrite an edited row, and an id collision in another list
 * never grants access to that row.
 */
function insertIdempotent(tx: any, table: typeof notes | typeof noteTags, listId: string, id: string, encryptedPayload: string, now: number) {
  const [existing] = tx.select({ listId: table.listId }).from(table).where(eq(table.id, id)).all()
  if (existing) {
    if (existing.listId !== listId) throw new TRPCError({ code: 'CONFLICT' })
    return
  }
  // A re-import of a previously deleted id resurrects it; the tombstone would
  // otherwise tell syncing clients to drop the fresh row.
  tx.delete(syncTombstones).where(eq(syncTombstones.id, id)).run()
  tx.insert(table).values({ id, listId, encryptedPayload, createdAt: now, updatedAt: now }).run()
}

/** Deletes notes with their history and attachments. Returns file ids to unlink. */
export function deleteNotesInTx(tx: any, listId: string, noteIds: string[], now: number) {
  if (noteIds.length === 0) return []
  const owned = and(eq(files.listId, listId), inArray(files.noteId, noteIds))
  const fileIds = tx.select({ id: files.id }).from(files).where(owned).all().map((f: { id: string }) => f.id)
  tx.delete(files).where(owned).run()
  tx.delete(noteRevisions).where(inArray(noteRevisions.noteId, noteIds)).run()
  tx.delete(notes).where(inArray(notes.id, noteIds)).run()
  for (const id of noteIds) {
    tx.insert(syncTombstones).values({ id, listId, kind: 'note', deletedAt: now })
      .onConflictDoUpdate({ target: syncTombstones.id, set: { deletedAt: now, listId, kind: 'note' } }).run()
  }
  return fileIds as string[]
}

export const notesRouter = router({
  // Incremental: rows changed at or after `since`. Inclusive so a write landing in
  // the same millisecond as the previous cursor is never missed; clients merge by id.
  sync: protectedProcedure
    .input(z.object({ listId: z.string().max(MAX_ID), since: z.number().int().min(0) }))
    .query(async ({ ctx, input }) => {
      await assertListAccess(ctx.db, input.listId, ctx.userId)
      return ctx.db.transaction(tx => {
        const noteRows = tx.select().from(notes).where(and(eq(notes.listId, input.listId), gte(notes.updatedAt, input.since))).all()
        const tagRows = tx.select().from(noteTags).where(and(eq(noteTags.listId, input.listId), gte(noteTags.updatedAt, input.since))).all()
        const deleted = input.since === 0 ? [] : tx.select({ id: syncTombstones.id, kind: syncTombstones.kind, deletedAt: syncTombstones.deletedAt })
          .from(syncTombstones).where(and(eq(syncTombstones.listId, input.listId), gte(syncTombstones.deletedAt, input.since))).all()
        const cursor = Math.max(input.since, ...noteRows.map(r => r.updatedAt), ...tagRows.map(r => r.updatedAt), ...deleted.map(d => d.deletedAt))
        return { notes: noteRows, tags: tagRows, deleted: deleted.map(({ id, kind }) => ({ id, kind })), cursor }
      })
    }),

  create: protectedProcedure
    .input(noteInput.extend({ listId: z.string().max(MAX_ID) }))
    .mutation(async ({ ctx, input }) => {
      await assertListAccess(ctx.db, input.listId, ctx.userId)
      ctx.db.transaction(tx => insertIdempotent(tx, notes, input.listId, input.id, input.encryptedPayload, Date.now()), { behavior: 'immediate' })
      return { id: input.id }
    }),

  update: protectedProcedure
    .input(z.object({ noteId: z.string().max(MAX_ID), encryptedPayload: z.string().max(MAX_NOTE_PAYLOAD) }))
    .mutation(async ({ ctx, input }) => {
      await loadNote(ctx.db, input.noteId, ctx.userId)
      ctx.db.transaction(tx => {
        const [note] = tx.select().from(notes).where(eq(notes.id, input.noteId)).all()
        if (!note) throw new TRPCError({ code: 'NOT_FOUND' })
        if (note.encryptedPayload === input.encryptedPayload) return
        const now = Date.now()
        const [latest] = tx.select({ createdAt: noteRevisions.createdAt }).from(noteRevisions)
          .where(eq(noteRevisions.noteId, note.id)).orderBy(desc(noteRevisions.createdAt)).limit(1).all()
        // Snapshot the version being replaced, at most once per interval, so a
        // typing session yields one restorable point rather than hundreds.
        if (!latest || now - latest.createdAt >= REVISION_INTERVAL_MS) {
          tx.insert(noteRevisions).values({ id: randomUUID(), noteId: note.id, listId: note.listId, encryptedPayload: note.encryptedPayload, createdAt: now }).run()
          const keep = tx.select({ id: noteRevisions.id }).from(noteRevisions).where(eq(noteRevisions.noteId, note.id))
            .orderBy(desc(noteRevisions.createdAt)).limit(MAX_REVISIONS_PER_NOTE).all().map(r => r.id)
          tx.delete(noteRevisions).where(and(eq(noteRevisions.noteId, note.id), notInArray(noteRevisions.id, keep))).run()
        }
        tx.update(notes).set({ encryptedPayload: input.encryptedPayload, updatedAt: now }).where(eq(notes.id, note.id)).run()
      }, { behavior: 'immediate' })
    }),

  // Permanent. Moving to the trash is an ordinary update of the encrypted flags.
  delete: protectedProcedure
    .input(z.object({ noteId: z.string().max(MAX_ID) }))
    .mutation(async ({ ctx, input }) => {
      const note = await loadNote(ctx.db, input.noteId, ctx.userId)
      const fileIds = ctx.db.transaction(tx => deleteNotesInTx(tx, note.listId, [note.id], Date.now()), { behavior: 'immediate' })
      await removeStoredFiles(fileIds)
    }),

  // Imports go straight to the server in bounded batches: thousands of notes
  // would overflow the browser-local outbox.
  importBatch: protectedProcedure
    .input(z.object({
      listId: z.string().max(MAX_ID),
      notes: z.array(noteInput).max(MAX_IMPORT_BATCH),
      tags: z.array(tagInput).max(MAX_IMPORT_BATCH),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertListAccess(ctx.db, input.listId, ctx.userId)
      ctx.db.transaction(tx => {
        const now = Date.now()
        for (const tag of input.tags) insertIdempotent(tx, noteTags, input.listId, tag.id, tag.encryptedPayload, now)
        for (const note of input.notes) insertIdempotent(tx, notes, input.listId, note.id, note.encryptedPayload, now)
      }, { behavior: 'immediate' })
      return { notes: input.notes.length, tags: input.tags.length }
    }),

  revisions: protectedProcedure
    .input(z.object({ noteId: z.string().max(MAX_ID) }))
    .query(async ({ ctx, input }) => {
      await loadNote(ctx.db, input.noteId, ctx.userId)
      return ctx.db.select({ id: noteRevisions.id, encryptedPayload: noteRevisions.encryptedPayload, createdAt: noteRevisions.createdAt })
        .from(noteRevisions).where(eq(noteRevisions.noteId, input.noteId)).orderBy(desc(noteRevisions.createdAt))
    }),

  // The client re-encrypts the note and its attachment metadata under the target
  // list's key. Revisions are under the old key and stay readable only to the old
  // list's members, so they are dropped rather than carried across.
  move: protectedProcedure
    .input(z.object({
      noteId: z.string().max(MAX_ID),
      toListId: z.string().max(MAX_ID),
      encryptedPayload: z.string().max(MAX_NOTE_PAYLOAD),
      files: z.array(z.object({ id: z.string().max(MAX_ID), encryptedMetadata: z.string().max(MAX_FILE_METADATA) })).max(1000),
    }))
    .mutation(async ({ ctx, input }) => {
      const note = await loadNote(ctx.db, input.noteId, ctx.userId)
      await assertListAccess(ctx.db, input.toListId, ctx.userId)
      if (note.listId === input.toListId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'The note is already in that list' })
      ctx.db.transaction(tx => {
        const attached = tx.select({ id: files.id }).from(files).where(and(eq(files.listId, note.listId), eq(files.noteId, note.id))).all().map(f => f.id)
        const provided = new Set(input.files.map(f => f.id))
        if (attached.length !== provided.size || attached.some(id => !provided.has(id))) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Every attachment must be re-encrypted for the target list' })
        }
        const now = Date.now()
        tx.delete(noteRevisions).where(eq(noteRevisions.noteId, note.id)).run()
        tx.update(notes).set({ listId: input.toListId, encryptedPayload: input.encryptedPayload, updatedAt: now }).where(eq(notes.id, note.id)).run()
        for (const file of input.files) {
          tx.update(files).set({ listId: input.toListId, encryptedMetadata: file.encryptedMetadata }).where(eq(files.id, file.id)).run()
        }
        tx.insert(syncTombstones).values({ id: note.id, listId: note.listId, kind: 'note', deletedAt: now })
          .onConflictDoUpdate({ target: syncTombstones.id, set: { listId: note.listId, kind: 'note', deletedAt: now } }).run()
      }, { behavior: 'immediate' })
    }),
})

export const tagsRouter = router({
  create: protectedProcedure
    .input(tagInput.extend({ listId: z.string().max(MAX_ID) }))
    .mutation(async ({ ctx, input }) => {
      await assertListAccess(ctx.db, input.listId, ctx.userId)
      ctx.db.transaction(tx => insertIdempotent(tx, noteTags, input.listId, input.id, input.encryptedPayload, Date.now()), { behavior: 'immediate' })
      return { id: input.id }
    }),

  update: protectedProcedure
    .input(z.object({ tagId: z.string().max(MAX_ID), encryptedPayload: z.string().max(MAX_TAG_PAYLOAD) }))
    .mutation(async ({ ctx, input }) => {
      const [tag] = await ctx.db.select().from(noteTags).where(eq(noteTags.id, input.tagId))
      if (!tag) throw new TRPCError({ code: 'NOT_FOUND' })
      await assertListAccess(ctx.db, tag.listId, ctx.userId)
      await ctx.db.update(noteTags).set({ encryptedPayload: input.encryptedPayload, updatedAt: Date.now() }).where(eq(noteTags.id, input.tagId))
    }),

  // Notes keep the dangling id inside their encrypted payload; clients ignore it.
  delete: protectedProcedure
    .input(z.object({ tagId: z.string().max(MAX_ID) }))
    .mutation(async ({ ctx, input }) => {
      const [tag] = await ctx.db.select().from(noteTags).where(eq(noteTags.id, input.tagId))
      if (!tag) throw new TRPCError({ code: 'NOT_FOUND' })
      await assertListAccess(ctx.db, tag.listId, ctx.userId)
      ctx.db.transaction(tx => {
        const now = Date.now()
        tx.delete(noteTags).where(eq(noteTags.id, tag.id)).run()
        tx.insert(syncTombstones).values({ id: tag.id, listId: tag.listId, kind: 'tag', deletedAt: now })
          .onConflictDoUpdate({ target: syncTombstones.id, set: { listId: tag.listId, kind: 'tag', deletedAt: now } }).run()
      }, { behavior: 'immediate' })
    }),
})
