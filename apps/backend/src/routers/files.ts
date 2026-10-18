import { randomUUID } from 'crypto'
import { renameSync, rmSync } from 'fs'
import { TRPCError } from '@trpc/server'
import { and, eq, sum } from 'drizzle-orm'
import { z } from 'zod'
import { router, protectedProcedure } from '../router.js'
import { files, notes } from '../db/schema.js'
import { assertListAccess } from '../lib/access.js'
import { filePath, removeStoredFiles } from '../lib/fileStore.js'
import { FILES_QUOTA_BYTES, MAX_FILE_BYTES, MAX_FILE_METADATA, MAX_ID } from '../lib/limits.js'
import type { AppContext } from '../context.js'

export async function usedBytes(db: any, userId: string) {
  const [row] = await db.select({ total: sum(files.size) }).from(files).where(eq(files.uploaderId, userId))
  return Number(row?.total ?? 0)
}

async function loadFile(db: any, fileId: string, userId: string) {
  const [file] = await db.select().from(files).where(eq(files.id, fileId))
  if (!file) throw new TRPCError({ code: 'NOT_FOUND' })
  await assertListAccess(db, file.listId, userId)
  return file as typeof files.$inferSelect
}

export const filesRouter = router({
  // Reserves the row and the quota before any bytes are sent; the upload route
  // then accepts exactly the declared size, once.
  create: protectedProcedure
    .input(z.object({
      fileId: z.string().uuid(),
      listId: z.string().max(MAX_ID),
      noteId: z.string().uuid(),
      size: z.number().int().positive().max(MAX_FILE_BYTES),
      encryptedMetadata: z.string().max(MAX_FILE_METADATA),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertListAccess(ctx.db, input.listId, ctx.userId)
      ctx.db.transaction(tx => {
        // Tie the file to a note in the same list, so nobody can hang files off a
        // note in a list they cannot see (and block its move or deletion).
        const [note] = tx.select({ listId: notes.listId }).from(notes).where(eq(notes.id, input.noteId)).all()
        if (!note || note.listId !== input.listId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Save the note before attaching files' })
        const [existing] = tx.select({ id: files.id }).from(files).where(eq(files.id, input.fileId)).all()
        if (existing) throw new TRPCError({ code: 'CONFLICT' })
        const [usage] = tx.select({ total: sum(files.size) }).from(files).where(eq(files.uploaderId, ctx.userId)).all()
        if (Number(usage?.total ?? 0) + input.size > FILES_QUOTA_BYTES) {
          throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE', message: 'Attachment storage quota exceeded' })
        }
        tx.insert(files).values({
          id: input.fileId, listId: input.listId, noteId: input.noteId, uploaderId: ctx.userId,
          size: input.size, encryptedMetadata: input.encryptedMetadata, uploaded: false, createdAt: Date.now(),
        }).run()
      }, { behavior: 'immediate' })
      return { id: input.fileId }
    }),

  forNote: protectedProcedure
    .input(z.object({ listId: z.string().max(MAX_ID), noteId: z.string().max(MAX_ID) }))
    .query(async ({ ctx, input }) => {
      await assertListAccess(ctx.db, input.listId, ctx.userId)
      return ctx.db.select({ id: files.id, size: files.size, encryptedMetadata: files.encryptedMetadata, uploaded: files.uploaded, createdAt: files.createdAt })
        .from(files).where(and(eq(files.listId, input.listId), eq(files.noteId, input.noteId)))
    }),

  forList: protectedProcedure
    .input(z.object({ listId: z.string().max(MAX_ID) }))
    .query(async ({ ctx, input }) => {
      await assertListAccess(ctx.db, input.listId, ctx.userId)
      return ctx.db.select({ id: files.id, noteId: files.noteId, size: files.size, encryptedMetadata: files.encryptedMetadata, uploaded: files.uploaded, createdAt: files.createdAt })
        .from(files).where(eq(files.listId, input.listId))
    }),

  usage: protectedProcedure.query(async ({ ctx }) => ({ used: await usedBytes(ctx.db, ctx.userId), quota: FILES_QUOTA_BYTES, maxFile: MAX_FILE_BYTES })),

  delete: protectedProcedure
    .input(z.object({ fileId: z.string().max(MAX_ID) }))
    .mutation(async ({ ctx, input }) => {
      const file = await loadFile(ctx.db, input.fileId, ctx.userId)
      await ctx.db.delete(files).where(eq(files.id, file.id))
      await removeStoredFiles([file.id])
    }),
})

function httpError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'content-type': 'application/json' } })
}

async function authorize(ctx: AppContext, fileId: string) {
  if (!ctx.userId) return { error: httpError(401, 'Unauthorized') }
  if (!z.string().uuid().safeParse(fileId).success) return { error: httpError(404, 'Not found') }
  try {
    return { file: await loadFile(ctx.db, fileId, ctx.userId) }
  } catch (err) {
    if (err instanceof TRPCError && err.code === 'FORBIDDEN') return { error: httpError(403, 'Forbidden') }
    return { error: httpError(404, 'Not found') }
  }
}

const activeUploads = new Set<string>()

/** Raw ciphertext upload for a reserved file row. */
export async function handleFileUpload(ctx: AppContext, fileId: string, req: Request): Promise<Response> {
  const { file, error } = await authorize(ctx, fileId)
  if (error) return error
  if (file.uploaded) return httpError(409, 'Already uploaded')
  if (file.uploaderId !== ctx.userId) return httpError(403, 'Forbidden')
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > 0 && declared !== file.size) return httpError(400, 'Size does not match the reservation')
  // Read at most the reserved size; a body that runs longer is rejected without
  // buffering the remainder.
  const reader = req.body?.getReader()
  if (!reader) return httpError(400, 'Missing body')
  if (activeUploads.has(file.id)) { await reader.cancel(); return httpError(409, 'Upload already in progress') }
  activeUploads.add(file.id)
  // Stream into a temporary file with bounded memory. Publish it only after
  // checking that its reservation and permissions still hold.
  const staged = `${filePath(file.id)}.${randomUUID()}.tmp`
  const writer = Bun.file(staged).writer({ highWaterMark: 64 * 1024 })
  let ended = false
  try {
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > file.size) return httpError(400, 'Size does not match the reservation')
      writer.write(value)
      await writer.flush()
    }
    if (received !== file.size) return httpError(400, 'Size does not match the reservation')
    await writer.end()
    ended = true
    const currentAuth = await authorize(ctx, fileId)
    if (currentAuth.error) return currentAuth.error
    return ctx.db.transaction(tx => {
      const current = tx.select().from(files).where(eq(files.id, file.id)).get()
      if (!current) return httpError(404, 'Not found')
      if (current.uploaded) return httpError(409, 'Already uploaded')
      if (current.listId !== file.listId || current.encryptedMetadata !== file.encryptedMetadata) return httpError(409, 'Attachment changed during upload')
      renameSync(staged, filePath(file.id))
      tx.update(files).set({ uploaded: true }).where(eq(files.id, file.id)).run()
      return new Response(null, { status: 204 })
    }, { behavior: 'immediate' })
  } finally {
    try {
      if (!ended) await writer.end()
    } finally {
      activeUploads.delete(file.id)
      await reader.cancel().catch(() => {})
      rmSync(staged, { force: true })
    }
  }
}

export async function handleFileDownload(ctx: AppContext, fileId: string): Promise<Response> {
  const { file, error } = await authorize(ctx, fileId)
  if (error) return error
  if (!file.uploaded) return httpError(404, 'Not found')
  const blob = Bun.file(filePath(file.id))
  if (!(await blob.exists())) return httpError(404, 'Not found')
  return new Response(blob, {
    headers: {
      'content-type': 'application/octet-stream',
      'content-disposition': 'attachment',
      'cache-control': 'private, no-store',
    },
  })
}
