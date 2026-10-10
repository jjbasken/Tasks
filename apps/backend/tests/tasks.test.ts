import { describe, it, expect } from 'bun:test'
import { createCallerFactory } from '@trpc/server/unstable-core-do-not-import'
import { randomUUID } from 'crypto'
import { appRouter } from '../src/router.js'
import { makeTestDb } from './helpers.js'
import { users, lists, listMemberships } from '../src/db/schema.js'

const createCaller = createCallerFactory()(appRouter)

async function seedUserAndList(db: ReturnType<typeof makeTestDb>) {
  const userId = randomUUID()
  const listId = randomUUID()
  await db.insert(users).values({
    id: userId, username: 'test', email: 'test@test.com',
    passwordHash: 'h', publicKey: 'pk', kdfSalt: 's',
    encryptedPrivateKey: '{}', encryptedPersonalListKey: '{}',
    createdAt: Date.now(),
  })
  await db.insert(lists).values({
    id: listId, ownerId: userId, encryptedName: '{}',
    isShared: false, createdAt: Date.now(),
  })
  await db.insert(listMemberships).values({
    id: randomUUID(), listId, userId, encryptedListKey: 'key',
    invitedBy: null, createdAt: Date.now(),
  })
  return { userId, listId }
}

describe('tasks.create + list', () => {
  it('creates a task and retrieves it', async () => {
    const db = makeTestDb()
    const { userId, listId } = await seedUserAndList(db)
    const caller = createCaller({ db, userId })
    await caller.tasks.create({ listId, encryptedPayload: '{"ciphertext":"c","nonce":"n"}' })
    const result = await caller.tasks.list({ listId })
    expect(result).toHaveLength(1)
    expect(result[0].encryptedPayload).toBe('{"ciphertext":"c","nonce":"n"}')
  })
})

describe('tasks.update', () => {
  it('updates the encrypted payload', async () => {
    const db = makeTestDb()
    const { userId, listId } = await seedUserAndList(db)
    const caller = createCaller({ db, userId })
    const { id } = await caller.tasks.create({ listId, encryptedPayload: 'old' })
    await caller.tasks.update({ taskId: id, encryptedPayload: 'new' })
    const [task] = await caller.tasks.list({ listId })
    expect(task.encryptedPayload).toBe('new')
  })
})

describe('tasks.delete', () => {
  it('removes the task', async () => {
    const db = makeTestDb()
    const { userId, listId } = await seedUserAndList(db)
    const caller = createCaller({ db, userId })
    const { id } = await caller.tasks.create({ listId, encryptedPayload: 'data' })
    await caller.tasks.delete({ taskId: id })
    expect(await caller.tasks.list({ listId })).toHaveLength(0)
  })
})

describe('tasks authorization', () => {
  it('throws UNAUTHORIZED when no userId', async () => {
    const db = makeTestDb()
    const { listId } = await seedUserAndList(db)
    const caller = createCaller({ db, userId: null })
    await expect(caller.tasks.list({ listId })).rejects.toThrow('UNAUTHORIZED')
  })
})

describe('offline creation replay', () => {
  it('keeps the client id and does not duplicate or overwrite an edited task on retry', async () => {
    const db = makeTestDb()
    const { userId, listId } = await seedUserAndList(db)
    const caller = createCaller({ db, userId })
    const taskId = randomUUID()
    expect(await caller.tasks.create({ taskId, listId, encryptedPayload: 'original' })).toEqual({ id: taskId })
    await caller.tasks.update({ taskId, encryptedPayload: 'edited' })
    await caller.tasks.create({ taskId, listId, encryptedPayload: 'original' })
    const rows = await caller.tasks.list({ listId })
    expect(rows).toHaveLength(1)
    expect(rows[0].encryptedPayload).toBe('edited')
    await caller.tasks.delete({ taskId })
    expect(await caller.tasks.list({ listId })).toHaveLength(0)
  })

  it('rejects a client id already belonging to another list', async () => {
    const db = makeTestDb()
    const { userId, listId } = await seedUserAndList(db)
    const caller = createCaller({ db, userId })
    const { id } = await caller.lists.create({ encryptedName: '{}', encryptedListKey: 'key' })
    const taskId = randomUUID()
    await caller.tasks.create({ taskId, listId, encryptedPayload: 'original' })
    await expect(caller.tasks.create({ taskId, listId: id, encryptedPayload: 'replacement' })).rejects.toThrow()
    expect((await caller.tasks.list({ listId }))[0].encryptedPayload).toBe('original')
    expect(await caller.tasks.list({ listId: id })).toHaveLength(0)
  })
})

it('accepts concurrent retries of one client task id without duplicates', async () => {
  const db = makeTestDb()
  const { userId, listId } = await seedUserAndList(db)
  const caller = createCaller({ db, userId })
  const payload = { taskId: randomUUID(), listId, encryptedPayload: 'original' }
  const results = await Promise.all([caller.tasks.create(payload), caller.tasks.create(payload)])
  expect(results[0]).toEqual(results[1])
  expect(await caller.tasks.list({ listId })).toHaveLength(1)
})
