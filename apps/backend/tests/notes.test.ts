import { describe, it, expect, beforeAll, setSystemTime, afterEach } from 'bun:test'
import { createCallerFactory } from '@trpc/server/unstable-core-do-not-import'
import { randomUUID } from 'crypto'
import { mkdtempSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { eq } from 'drizzle-orm'
import { appRouter } from '../src/router.js'
import { makeTestDb } from './helpers.js'
import { users, lists, listMemberships, noteRevisions, files } from '../src/db/schema.js'
import { handleFileDownload, handleFileUpload } from '../src/routers/files.js'
import { filePath } from '../src/lib/fileStore.js'

const createCaller = createCallerFactory()(appRouter)
type Db = ReturnType<typeof makeTestDb>

beforeAll(() => { process.env.FILES_PATH = mkdtempSync(join(tmpdir(), 'notes-test-')) })
afterEach(() => { setSystemTime() })

async function seedUser(db: Db, username: string) {
  const userId = randomUUID()
  await db.insert(users).values({
    id: userId, username, email: `${username}@test.com`, passwordHash: 'h', publicKey: `pk-${username}`,
    kdfSalt: `salt-${username}`, encryptedPrivateKey: '{}', encryptedPersonalListKey: '{}', createdAt: Date.now(),
  })
  return userId
}

async function seedList(db: Db, ownerId: string, memberIds: string[] = []) {
  const listId = randomUUID()
  await db.insert(lists).values({ id: listId, ownerId, encryptedName: '{}', isShared: memberIds.length > 0, createdAt: Date.now() })
  for (const userId of [ownerId, ...memberIds]) {
    await db.insert(listMemberships).values({ id: randomUUID(), listId, userId, encryptedListKey: 'k', invitedBy: null, createdAt: Date.now() })
  }
  return listId
}

async function setup() {
  const db = makeTestDb()
  const alice = await seedUser(db, 'alice')
  const mallory = await seedUser(db, 'mallory')
  const listId = await seedList(db, alice)
  return { db, alice, mallory, listId, caller: createCaller({ db, userId: alice }), intruder: createCaller({ db, userId: mallory }) }
}

describe('notes create + sync', () => {
  it('returns created notes and tags on a full sync', async () => {
    const { caller, listId } = await setup()
    const id = randomUUID()
    const tagId = randomUUID()
    await caller.notes.create({ listId, id, encryptedPayload: 'n1' })
    await caller.tags.create({ listId, id: tagId, encryptedPayload: 't1' })
    const result = await caller.notes.sync({ listId, since: 0 })
    expect(result.notes.map(n => n.id)).toEqual([id])
    expect(result.tags.map(t => t.id)).toEqual([tagId])
    expect(result.cursor).toBeGreaterThan(0)
  })

  it('is idempotent for a retried create and never overwrites an edit', async () => {
    const { caller, listId } = await setup()
    const id = randomUUID()
    await caller.notes.create({ listId, id, encryptedPayload: 'v1' })
    await caller.notes.update({ noteId: id, encryptedPayload: 'v2' })
    await caller.notes.create({ listId, id, encryptedPayload: 'v1' })
    const { notes } = await caller.notes.sync({ listId, since: 0 })
    expect(notes).toHaveLength(1)
    expect(notes[0].encryptedPayload).toBe('v2')
  })

  it('rejects an id that already exists in another list', async () => {
    const { db, alice, caller, listId } = await setup()
    const other = await seedList(db, alice)
    const id = randomUUID()
    await caller.notes.create({ listId, id, encryptedPayload: 'v1' })
    await expect(caller.notes.create({ listId: other, id, encryptedPayload: 'x' })).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('returns only changes and deletions since the cursor', async () => {
    const { caller, listId } = await setup()
    const keep = randomUUID()
    const gone = randomUUID()
    setSystemTime(new Date(1_000_000))
    await caller.notes.create({ listId, id: keep, encryptedPayload: 'a' })
    await caller.notes.create({ listId, id: gone, encryptedPayload: 'b' })
    const first = await caller.notes.sync({ listId, since: 0 })
    setSystemTime(new Date(2_000_000))
    await caller.notes.update({ noteId: keep, encryptedPayload: 'a2' })
    await caller.notes.delete({ noteId: gone })
    const next = await caller.notes.sync({ listId, since: first.cursor + 1 })
    expect(next.notes.map(n => n.encryptedPayload)).toEqual(['a2'])
    expect(next.deleted).toEqual([{ id: gone, kind: 'note' }])
    expect(next.cursor).toBe(2_000_000)
  })
})

describe('notes access control', () => {
  it('forbids non-members on every procedure', async () => {
    const { caller, intruder, listId } = await setup()
    const id = randomUUID()
    const tagId = randomUUID()
    await caller.notes.create({ listId, id, encryptedPayload: 'secret' })
    await caller.tags.create({ listId, id: tagId, encryptedPayload: 'tag' })
    const forbidden = { code: 'FORBIDDEN' }
    await expect(intruder.notes.sync({ listId, since: 0 })).rejects.toMatchObject(forbidden)
    await expect(intruder.notes.create({ listId, id: randomUUID(), encryptedPayload: 'x' })).rejects.toMatchObject(forbidden)
    await expect(intruder.notes.update({ noteId: id, encryptedPayload: 'x' })).rejects.toMatchObject(forbidden)
    await expect(intruder.notes.delete({ noteId: id })).rejects.toMatchObject(forbidden)
    await expect(intruder.notes.revisions({ noteId: id })).rejects.toMatchObject(forbidden)
    await expect(intruder.notes.importBatch({ listId, notes: [], tags: [] })).rejects.toMatchObject(forbidden)
    await expect(intruder.tags.update({ tagId, encryptedPayload: 'x' })).rejects.toMatchObject(forbidden)
    await expect(intruder.tags.delete({ tagId })).rejects.toMatchObject(forbidden)
    await expect(intruder.files.forList({ listId })).rejects.toMatchObject(forbidden)
  })

  it('lets members of a shared list read and edit notes', async () => {
    const { db, alice, mallory } = await setup()
    const shared = await seedList(db, alice, [mallory])
    const member = createCaller({ db, userId: mallory })
    const id = randomUUID()
    await createCaller({ db, userId: alice }).notes.create({ listId: shared, id, encryptedPayload: 'hi' })
    await member.notes.update({ noteId: id, encryptedPayload: 'hello' })
    const { notes } = await member.notes.sync({ listId: shared, since: 0 })
    expect(notes[0].encryptedPayload).toBe('hello')
  })
})

describe('note revisions', () => {
  it('snapshots the previous version at most once per interval', async () => {
    const { caller, listId } = await setup()
    const id = randomUUID()
    setSystemTime(new Date(10_000_000))
    await caller.notes.create({ listId, id, encryptedPayload: 'v1' })
    await caller.notes.update({ noteId: id, encryptedPayload: 'v2' })
    await caller.notes.update({ noteId: id, encryptedPayload: 'v3' })
    expect((await caller.notes.revisions({ noteId: id })).map(r => r.encryptedPayload)).toEqual(['v1'])
    setSystemTime(new Date(10_000_000 + 11 * 60 * 1000))
    await caller.notes.update({ noteId: id, encryptedPayload: 'v4' })
    expect((await caller.notes.revisions({ noteId: id })).map(r => r.encryptedPayload)).toEqual(['v3', 'v1'])
  })

  it('keeps at most 100 revisions per note', async () => {
    const { caller, listId } = await setup()
    const id = randomUUID()
    await caller.notes.create({ listId, id, encryptedPayload: 'v0' })
    for (let i = 1; i <= 105; i++) {
      setSystemTime(new Date(i * 11 * 60 * 1000))
      await caller.notes.update({ noteId: id, encryptedPayload: `v${i}` })
    }
    const revisions = await caller.notes.revisions({ noteId: id })
    expect(revisions).toHaveLength(100)
    expect(revisions[0].encryptedPayload).toBe('v104')
  })

  it('does not snapshot an unchanged payload', async () => {
    const { db, caller, listId } = await setup()
    const id = randomUUID()
    await caller.notes.create({ listId, id, encryptedPayload: 'same' })
    await caller.notes.update({ noteId: id, encryptedPayload: 'same' })
    expect(await db.select().from(noteRevisions)).toHaveLength(0)
  })
})

describe('notes.importBatch', () => {
  it('imports tags and notes idempotently', async () => {
    const { caller, listId } = await setup()
    const batch = { listId, notes: [{ id: randomUUID(), encryptedPayload: 'n' }], tags: [{ id: randomUUID(), encryptedPayload: 't' }] }
    await caller.notes.importBatch(batch)
    await caller.notes.importBatch(batch)
    const result = await caller.notes.sync({ listId, since: 0 })
    expect(result.notes).toHaveLength(1)
    expect(result.tags).toHaveLength(1)
  })

  it('bounds the batch size', async () => {
    const { caller, listId } = await setup()
    const notes = Array.from({ length: 101 }, () => ({ id: randomUUID(), encryptedPayload: 'n' }))
    await expect(caller.notes.importBatch({ listId, notes, tags: [] })).rejects.toThrow()
  })

  it('resurrects a previously deleted id', async () => {
    const { caller, listId } = await setup()
    const id = randomUUID()
    await caller.notes.create({ listId, id, encryptedPayload: 'a' })
    await caller.notes.delete({ noteId: id })
    await caller.notes.importBatch({ listId, notes: [{ id, encryptedPayload: 'b' }], tags: [] })
    const result = await caller.notes.sync({ listId, since: 1 })
    expect(result.notes.map(n => n.id)).toEqual([id])
    expect(result.deleted).toEqual([])
  })
})

describe('notes.move', () => {
  it('moves a note and its files, drops revisions and tombstones the old list', async () => {
    const { db, alice, caller, listId } = await setup()
    const target = await seedList(db, alice)
    const id = randomUUID()
    const fileId = randomUUID()
    await caller.notes.create({ listId, id, encryptedPayload: 'a' })
    await caller.notes.update({ noteId: id, encryptedPayload: 'b' })
    await caller.files.create({ fileId, listId, noteId: id, size: 3, encryptedMetadata: 'm' })
    await expect(caller.notes.move({ noteId: id, toListId: target, encryptedPayload: 'c', files: [] })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await caller.notes.move({ noteId: id, toListId: target, encryptedPayload: 'c', files: [{ id: fileId, encryptedMetadata: 'm2' }] })
    expect((await caller.notes.sync({ listId: target, since: 0 })).notes.map(n => n.encryptedPayload)).toEqual(['c'])
    expect((await caller.notes.sync({ listId, since: 1 })).deleted).toEqual([{ id, kind: 'note' }])
    expect(await caller.notes.revisions({ noteId: id })).toHaveLength(0)
    const [file] = await db.select().from(files).where(eq(files.id, fileId))
    expect(file.listId).toBe(target)
    expect(file.encryptedMetadata).toBe('m2')
  })

  it('requires access to the target list', async () => {
    const { db, mallory, caller, listId } = await setup()
    const foreign = await seedList(db, mallory)
    const id = randomUUID()
    await caller.notes.create({ listId, id, encryptedPayload: 'a' })
    await expect(caller.notes.move({ noteId: id, toListId: foreign, encryptedPayload: 'c', files: [] })).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('tags', () => {
  it('updates and deletes with a tombstone', async () => {
    const { caller, listId } = await setup()
    const tagId = randomUUID()
    await caller.tags.create({ listId, id: tagId, encryptedPayload: 't1' })
    await caller.tags.update({ tagId, encryptedPayload: 't2' })
    expect((await caller.notes.sync({ listId, since: 0 })).tags[0].encryptedPayload).toBe('t2')
    await caller.tags.delete({ tagId })
    const result = await caller.notes.sync({ listId, since: 1 })
    expect(result.tags).toHaveLength(0)
    expect(result.deleted).toEqual([{ id: tagId, kind: 'tag' }])
  })
})

function uploadRequest(bytes: Uint8Array) {
  return new Request('http://x/api/files/id', { method: 'PUT', body: bytes as BodyInit, headers: { 'content-length': String(bytes.byteLength) } })
}

describe('files', () => {
  it('uploads exactly the reserved size once and downloads for members only', async () => {
    const { db, alice, mallory, caller, listId } = await setup()
    const noteId = randomUUID()
    const fileId = randomUUID()
    await caller.notes.create({ listId, id: noteId, encryptedPayload: 'n' })
    await caller.files.create({ fileId, listId, noteId, size: 4, encryptedMetadata: 'meta' })
    const ctx = { db, userId: alice }
    expect((await handleFileUpload(ctx, fileId, uploadRequest(new Uint8Array([1, 2, 3])))).status).toBe(400)
    expect((await handleFileUpload(ctx, fileId, uploadRequest(new Uint8Array([1, 2, 3, 4])))).status).toBe(204)
    expect((await handleFileUpload(ctx, fileId, uploadRequest(new Uint8Array([1, 2, 3, 4])))).status).toBe(409)
    const download = await handleFileDownload(ctx, fileId)
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect((await handleFileDownload({ db, userId: mallory }, fileId)).status).toBe(403)
    expect((await handleFileDownload({ db, userId: null }, fileId)).status).toBe(401)
    expect((await handleFileDownload(ctx, '../../etc/passwd')).status).toBe(404)
  })

  it('requires the note to exist in the same list', async () => {
    const { db, mallory, caller, listId } = await setup()
    const noteId = randomUUID()
    await caller.notes.create({ listId, id: noteId, encryptedPayload: 'n' })
    const malloryList = await seedList(db, mallory)
    const intruder = createCaller({ db, userId: mallory })
    await expect(intruder.files.create({ fileId: randomUUID(), listId: malloryList, noteId, size: 1, encryptedMetadata: 'm' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('enforces the per-user quota', async () => {
    const { caller, listId } = await setup()
    const noteId = randomUUID()
    await caller.notes.create({ listId, id: noteId, encryptedPayload: 'n' })
    const big = 40 * 1024 * 1024
    for (let i = 0; i < 51; i++) {
      await caller.files.create({ fileId: randomUUID(), listId, noteId, size: big, encryptedMetadata: 'm' })
    }
    await expect(caller.files.create({ fileId: randomUUID(), listId, noteId, size: big, encryptedMetadata: 'm' }))
      .rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' })
  })

  it('removes files on disk when their note is deleted', async () => {
    const { db, alice, caller, listId } = await setup()
    const noteId = randomUUID()
    const fileId = randomUUID()
    await caller.notes.create({ listId, id: noteId, encryptedPayload: 'n' })
    await caller.files.create({ fileId, listId, noteId, size: 1, encryptedMetadata: 'm' })
    await handleFileUpload({ db, userId: alice }, fileId, uploadRequest(new Uint8Array([9])))
    expect(existsSync(filePath(fileId))).toBe(true)
    await caller.notes.delete({ noteId })
    expect(existsSync(filePath(fileId))).toBe(false)
    expect(await db.select().from(files)).toHaveLength(0)
  })
})

describe('lists.delete cascade', () => {
  it('removes notes, tags, revisions and files', async () => {
    const { db, alice, caller } = await setup()
    const listId = await seedList(db, alice)
    const noteId = randomUUID()
    const fileId = randomUUID()
    await caller.notes.create({ listId, id: noteId, encryptedPayload: 'a' })
    await caller.notes.update({ noteId, encryptedPayload: 'b' })
    await caller.tags.create({ listId, id: randomUUID(), encryptedPayload: 't' })
    await caller.files.create({ fileId, listId, noteId, size: 1, encryptedMetadata: 'm' })
    await handleFileUpload({ db, userId: alice }, fileId, uploadRequest(new Uint8Array([7])))
    await caller.lists.delete({ listId })
    expect(await db.select().from(noteRevisions)).toHaveLength(0)
    expect(await db.select().from(files)).toHaveLength(0)
    expect(existsSync(filePath(fileId))).toBe(false)
  })
})

describe('auth.kdfSalt', () => {
  it('returns the caller’s own salt', async () => {
    const { caller } = await setup()
    expect(await caller.auth.kdfSalt()).toEqual({ kdfSalt: 'salt-alice' })
  })
})
