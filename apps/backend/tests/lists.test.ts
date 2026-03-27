import { describe, it, expect } from 'bun:test'
import { createCallerFactory } from '@trpc/server'
import { randomUUID } from 'crypto'
import { appRouter } from '../src/router.js'
import { makeTestDb } from './helpers.js'
import { users } from '../src/db/schema.js'

const createCaller = createCallerFactory(appRouter)

async function seedUser(db: ReturnType<typeof makeTestDb>, username = 'alice') {
  const userId = randomUUID()
  await db.insert(users).values({
    id: userId, username, email: `${username}@test.com`,
    passwordHash: 'h', publicKey: `pk-${username}`, kdfSalt: 's',
    encryptedPrivateKey: '{}', encryptedPersonalListKey: '{}', createdAt: Date.now(),
  })
  return userId
}

describe('lists.create + list', () => {
  it('creates a list and returns it with encrypted key', async () => {
    const db = makeTestDb()
    const userId = await seedUser(db)
    const caller = createCaller({ db, userId })
    await caller.lists.create({ encryptedName: '{"ct":"x","n":"y"}', encryptedListKey: 'sealed-key' })
    const result = await caller.lists.list()
    expect(result).toHaveLength(1)
    expect(result[0].encryptedListKey).toBe('sealed-key')
  })
})

describe('lists.invite', () => {
  it('adds a second member with their own encrypted list key', async () => {
    const db = makeTestDb()
    const aliceId = await seedUser(db, 'alice')
    const bobId = await seedUser(db, 'bob')
    const caller = createCaller({ db, userId: aliceId })
    await caller.lists.create({ encryptedName: '{}', encryptedListKey: 'alice-key' })
    const list = (await caller.lists.list())[0]
    await caller.lists.invite({ listId: list.id, inviteeUsername: 'bob', encryptedListKey: 'bob-key' })
    const bobCaller = createCaller({ db, userId: bobId })
    const bobLists = await bobCaller.lists.list()
    expect(bobLists).toHaveLength(1)
    expect(bobLists[0].encryptedListKey).toBe('bob-key')
  })
})

describe('lists.removeMember', () => {
  it('removes a member from the list', async () => {
    const db = makeTestDb()
    const aliceId = await seedUser(db, 'alice')
    const bobId = await seedUser(db, 'bob')
    const caller = createCaller({ db, userId: aliceId })
    await caller.lists.create({ encryptedName: '{}', encryptedListKey: 'alice-key' })
    const list = (await caller.lists.list())[0]
    await caller.lists.invite({ listId: list.id, inviteeUsername: 'bob', encryptedListKey: 'bob-key' })
    await caller.lists.removeMember({ listId: list.id, userId: bobId })
    const bobCaller = createCaller({ db, userId: bobId })
    expect(await bobCaller.lists.list()).toHaveLength(0)
  })
})
