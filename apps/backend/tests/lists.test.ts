import { describe, it, expect } from 'bun:test'
import { createCallerFactory } from '@trpc/server/unstable-core-do-not-import'
import { randomUUID } from 'crypto'
import { appRouter } from '../src/router.js'
import { makeTestDb } from './helpers.js'
import { users, lists, listMemberships, tasks } from '../src/db/schema.js'

const createCaller = createCallerFactory()(appRouter)

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

async function seedPersonalList(db: ReturnType<typeof makeTestDb>, userId: string) {
  const listId = randomUUID()
  const now = Date.now()
  await db.insert(lists).values({ id: listId, ownerId: userId, encryptedName: '{}', isShared: false, isPersonal: true, createdAt: now })
  await db.insert(listMemberships).values({ id: randomUUID(), listId, userId, encryptedListKey: 'k', invitedBy: null, createdAt: now })
  return listId
}

describe('lists.delete', () => {
  it('removes the list and its tasks for every member', async () => {
    const db = makeTestDb()
    const aliceId = await seedUser(db, 'alice')
    const bobId = await seedUser(db, 'bob')
    const caller = createCaller({ db, userId: aliceId })
    await caller.lists.create({ encryptedName: '{}', encryptedListKey: 'alice-key' })
    const list = (await caller.lists.list())[0]
    await caller.lists.invite({ listId: list.id, inviteeUsername: 'bob', encryptedListKey: 'bob-key' })
    await caller.tasks.create({ listId: list.id, encryptedPayload: '{}' })

    await caller.lists.delete({ listId: list.id })

    expect(await caller.lists.list()).toHaveLength(0)
    const bobCaller = createCaller({ db, userId: bobId })
    expect(await bobCaller.lists.list()).toHaveLength(0)
    expect(await db.select().from(tasks)).toHaveLength(0)
    expect(await db.select().from(listMemberships)).toHaveLength(0)
  })

  it('rejects deletion by a member who does not own the list', async () => {
    const db = makeTestDb()
    const aliceId = await seedUser(db, 'alice')
    const bobId = await seedUser(db, 'bob')
    const caller = createCaller({ db, userId: aliceId })
    await caller.lists.create({ encryptedName: '{}', encryptedListKey: 'alice-key' })
    const list = (await caller.lists.list())[0]
    await caller.lists.invite({ listId: list.id, inviteeUsername: 'bob', encryptedListKey: 'bob-key' })

    const bobCaller = createCaller({ db, userId: bobId })
    await expect(bobCaller.lists.delete({ listId: list.id })).rejects.toThrow('FORBIDDEN')
    expect(await caller.lists.list()).toHaveLength(1)
  })

  it('rejects deletion of the personal list', async () => {
    const db = makeTestDb()
    const aliceId = await seedUser(db, 'alice')
    const listId = await seedPersonalList(db, aliceId)
    const caller = createCaller({ db, userId: aliceId })

    await expect(caller.lists.delete({ listId })).rejects.toThrow('The personal list cannot be deleted')
    expect(await caller.lists.list()).toHaveLength(1)
  })
})

describe('lists.leave', () => {
  it('drops only the caller membership, leaving the list for others', async () => {
    const db = makeTestDb()
    const aliceId = await seedUser(db, 'alice')
    const bobId = await seedUser(db, 'bob')
    const caller = createCaller({ db, userId: aliceId })
    await caller.lists.create({ encryptedName: '{}', encryptedListKey: 'alice-key' })
    const list = (await caller.lists.list())[0]
    await caller.lists.invite({ listId: list.id, inviteeUsername: 'bob', encryptedListKey: 'bob-key' })
    await caller.tasks.create({ listId: list.id, encryptedPayload: '{}' })

    const bobCaller = createCaller({ db, userId: bobId })
    await bobCaller.lists.leave({ listId: list.id })

    expect(await bobCaller.lists.list()).toHaveLength(0)
    expect(await caller.lists.list()).toHaveLength(1)
    expect(await db.select().from(tasks)).toHaveLength(1)
  })

  it('rejects the owner leaving their own list', async () => {
    const db = makeTestDb()
    const aliceId = await seedUser(db, 'alice')
    const caller = createCaller({ db, userId: aliceId })
    await caller.lists.create({ encryptedName: '{}', encryptedListKey: 'alice-key' })
    const list = (await caller.lists.list())[0]

    await expect(caller.lists.leave({ listId: list.id })).rejects.toThrow('FORBIDDEN')
    expect(await caller.lists.list()).toHaveLength(1)
  })

  it('rejects leaving a list the caller is not a member of', async () => {
    const db = makeTestDb()
    const aliceId = await seedUser(db, 'alice')
    const bobId = await seedUser(db, 'bob')
    const caller = createCaller({ db, userId: aliceId })
    await caller.lists.create({ encryptedName: '{}', encryptedListKey: 'alice-key' })
    const list = (await caller.lists.list())[0]

    const bobCaller = createCaller({ db, userId: bobId })
    await expect(bobCaller.lists.leave({ listId: list.id })).rejects.toThrow('FORBIDDEN')
  })
})

describe('lists.list flags', () => {
  it('marks ownership and the personal list', async () => {
    const db = makeTestDb()
    const aliceId = await seedUser(db, 'alice')
    const bobId = await seedUser(db, 'bob')
    await seedPersonalList(db, aliceId)
    const caller = createCaller({ db, userId: aliceId })
    await caller.lists.create({ encryptedName: '{}', encryptedListKey: 'alice-key' })
    const shared = (await caller.lists.list()).find(l => !l.isPersonal)!
    await caller.lists.invite({ listId: shared.id, inviteeUsername: 'bob', encryptedListKey: 'bob-key' })

    const personal = (await caller.lists.list()).find(l => l.isPersonal)!
    expect(personal.isOwner).toBe(true)
    expect(shared.isOwner).toBe(true)

    const bobCaller = createCaller({ db, userId: bobId })
    const bobView = (await bobCaller.lists.list())[0]
    expect(bobView.isOwner).toBe(false)
    expect(bobView.isPersonal).toBe(false)
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
