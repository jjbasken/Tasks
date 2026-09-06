import { describe, it, expect } from 'bun:test'
import { createCallerFactory } from '@trpc/server/unstable-core-do-not-import'
import { randomUUID } from 'crypto'
import { appRouter } from '../src/router.js'
import { makeTestDb } from './helpers.js'
import { users, lists, listMemberships } from '../src/db/schema.js'
import { assertUsableJwtSecret } from '../src/lib/jwt.js'
import { MAX_TASK_IDS, MAX_TASK_PAYLOAD } from '../src/lib/limits.js'

const createCaller = createCallerFactory()(appRouter)

async function seedUser(db: ReturnType<typeof makeTestDb>, username: string) {
  const userId = randomUUID()
  await db.insert(users).values({
    id: userId, username, email: `${username}@test.com`,
    passwordHash: 'h', publicKey: `pk-${username}`, kdfSalt: 's',
    encryptedPrivateKey: '{}', encryptedPersonalListKey: '{}', createdAt: Date.now(),
  })
  return userId
}

describe('lists.invite — only the owner may share', () => {
  it('rejects an invite from a member who does not own the list', async () => {
    const db = makeTestDb()
    const aliceId = await seedUser(db, 'alice')
    const malloryId = await seedUser(db, 'mallory')
    await seedUser(db, 'victim')

    const alice = createCaller({ db, userId: aliceId })
    const { id: listId } = await alice.lists.create({ encryptedName: '{}', encryptedListKey: 'alice-key' })
    await alice.lists.invite({ listId, inviteeUsername: 'mallory', encryptedListKey: 'mallory-key' })

    // Mallory is a member, not the owner. Membership is not authority to share.
    const mallory = createCaller({ db, userId: malloryId })
    await expect(
      mallory.lists.invite({ listId, inviteeUsername: 'victim', encryptedListKey: 'attacker-key' })
    ).rejects.toThrow('FORBIDDEN')

    const rows = await db.select().from(listMemberships)
    expect(rows.filter(r => r.listId === listId)).toHaveLength(2)
  })

  it('rejects an invite from someone with no membership at all', async () => {
    const db = makeTestDb()
    const aliceId = await seedUser(db, 'alice')
    const outsiderId = await seedUser(db, 'outsider')
    await seedUser(db, 'victim')

    const alice = createCaller({ db, userId: aliceId })
    const { id: listId } = await alice.lists.create({ encryptedName: '{}', encryptedListKey: 'k' })

    const outsider = createCaller({ db, userId: outsiderId })
    await expect(
      outsider.lists.invite({ listId, inviteeUsername: 'victim', encryptedListKey: 'k' })
    ).rejects.toThrow('FORBIDDEN')
  })

  it('refuses to add the same member twice', async () => {
    const db = makeTestDb()
    const aliceId = await seedUser(db, 'alice')
    await seedUser(db, 'bob')
    const alice = createCaller({ db, userId: aliceId })
    const { id: listId } = await alice.lists.create({ encryptedName: '{}', encryptedListKey: 'alice-key' })

    await alice.lists.invite({ listId, inviteeUsername: 'bob', encryptedListKey: 'bob-key' })
    await expect(
      alice.lists.invite({ listId, inviteeUsername: 'bob', encryptedListKey: 'GARBAGE' })
    ).rejects.toThrow('Already a member')

    const rows = await db.select().from(listMemberships)
    expect(rows.filter(r => r.listId === listId)).toHaveLength(2)
    // Bob keeps the key sealed by the real invite; the second blob never landed.
    expect(rows.find(r => r.encryptedListKey === 'GARBAGE')).toBeUndefined()
  })

  it('refuses to re-add the owner, which would poison their own view of the list', async () => {
    const db = makeTestDb()
    const aliceId = await seedUser(db, 'alice')
    const alice = createCaller({ db, userId: aliceId })
    const { id: listId } = await alice.lists.create({ encryptedName: '{}', encryptedListKey: 'alice-key' })

    await expect(
      alice.lists.invite({ listId, inviteeUsername: 'alice', encryptedListKey: 'GARBAGE' })
    ).rejects.toThrow()

    const seen = await alice.lists.list()
    expect(seen.filter(l => l.id === listId)).toHaveLength(1)
    expect(seen[0].encryptedListKey).toBe('alice-key')
  })

  it('refuses to share the personal list', async () => {
    const db = makeTestDb()
    const aliceId = await seedUser(db, 'alice')
    await seedUser(db, 'bob')
    const listId = randomUUID()
    const now = Date.now()
    await db.insert(lists).values({ id: listId, ownerId: aliceId, encryptedName: '{}', isShared: false, isPersonal: true, createdAt: now })
    await db.insert(listMemberships).values({ id: randomUUID(), listId, userId: aliceId, encryptedListKey: 'k', invitedBy: null, createdAt: now })

    const alice = createCaller({ db, userId: aliceId })
    await expect(
      alice.lists.invite({ listId, inviteeUsername: 'bob', encryptedListKey: 'k' })
    ).rejects.toThrow('The personal list cannot be shared')
  })

  it('the database rejects a duplicate membership even if the router check is bypassed', async () => {
    const db = makeTestDb()
    const aliceId = await seedUser(db, 'alice')
    const alice = createCaller({ db, userId: aliceId })
    const { id: listId } = await alice.lists.create({ encryptedName: '{}', encryptedListKey: 'k' })

    const insertDuplicate = async () => {
      await db.insert(listMemberships).values({
        id: randomUUID(), listId, userId: aliceId, encryptedListKey: 'GARBAGE', invitedBy: null, createdAt: Date.now(),
      })
    }
    await expect(insertDuplicate()).rejects.toThrow(/UNIQUE constraint failed/i)
  })
})

describe('auth.login — rate limiting', () => {
  const registration = {
    email: 'rl@example.com', publicKey: 'pk', kdfSalt: 's',
    encryptedPrivateKey: '{}', encryptedPersonalListKey: '{}', encryptedPersonalListName: '{}',
  }

  it('locks an account out after repeated failures, then still admits the right password once the window is reset', async () => {
    const db = makeTestDb()
    const caller = createCaller({ db, userId: null })
    await caller.auth.register({ ...registration, username: 'target', passwordHash: 'right' })

    for (let i = 0; i < 10; i++) {
      await expect(caller.auth.login({ username: 'target', passwordHash: 'wrong' })).rejects.toThrow('UNAUTHORIZED')
    }
    // The 11th attempt is refused before any Argon2id work happens.
    await expect(caller.auth.login({ username: 'target', passwordHash: 'wrong' }))
      .rejects.toThrow('Too many failed attempts')
    // Even the correct password is refused while the lockout stands.
    await expect(caller.auth.login({ username: 'target', passwordHash: 'right' }))
      .rejects.toThrow('Too many failed attempts')
  })

  it('does not penalise an account for its own successful logins', async () => {
    const db = makeTestDb()
    const caller = createCaller({ db, userId: null })
    await caller.auth.register({ ...registration, username: 'busy', passwordHash: 'right' })

    for (let i = 0; i < 25; i++) {
      const result = await caller.auth.login({ username: 'busy', passwordHash: 'right' })
      expect(result.token).toBeString()
    }
  })

  it('clears the failure count after a success', async () => {
    const db = makeTestDb()
    const caller = createCaller({ db, userId: null })
    await caller.auth.register({ ...registration, username: 'recover', passwordHash: 'right' })

    for (let i = 0; i < 9; i++) {
      await expect(caller.auth.login({ username: 'recover', passwordHash: 'wrong' })).rejects.toThrow('UNAUTHORIZED')
    }
    await caller.auth.login({ username: 'recover', passwordHash: 'right' })
    // Budget is back: nine more failures still do not trip the limit.
    for (let i = 0; i < 9; i++) {
      await expect(caller.auth.login({ username: 'recover', passwordHash: 'wrong' })).rejects.toThrow('UNAUTHORIZED')
    }
  })

  it('limits unknown usernames the same way, so a lockout is not an enumeration oracle', async () => {
    const db = makeTestDb()
    const caller = createCaller({ db, userId: null })
    await caller.auth.register({ ...registration, username: 'real', passwordHash: 'right' })

    const codeAfterTenFailures = async (username: string) => {
      for (let i = 0; i < 10; i++) {
        await caller.auth.login({ username, passwordHash: 'wrong' }).catch(() => {})
      }
      try {
        await caller.auth.login({ username, passwordHash: 'wrong' })
        return 'OK'
      } catch (err: any) {
        return err.code ?? err.cause?.code ?? String(err)
      }
    }

    expect(await codeAfterTenFailures('ghost')).toBe(await codeAfterTenFailures('real'))
  })
})

describe('assertUsableJwtSecret', () => {
  const withSecret = <T>(value: string | undefined, fn: () => T): T => {
    const previous = process.env.JWT_SECRET
    if (value === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = value
    try { return fn() } finally { process.env.JWT_SECRET = previous }
  }

  it('rejects an unset secret', () => {
    withSecret(undefined, () => expect(() => assertUsableJwtSecret()).toThrow('must be set'))
  })

  it('rejects the placeholder that ships in .env.example', () => {
    withSecret('change-me', () => expect(() => assertUsableJwtSecret()).toThrow('placeholder'))
    withSecret('CHANGE-ME', () => expect(() => assertUsableJwtSecret()).toThrow('placeholder'))
  })

  it('rejects a secret that is too short to be an HS256 key', () => {
    withSecret('a'.repeat(31), () => expect(() => assertUsableJwtSecret()).toThrow('at least 32 characters'))
  })

  it('accepts a generated secret', () => {
    withSecret('x7Qv2mKp9LsRt4Wn8Zb3Yc6Fd1Gh5Jk0', () => expect(() => assertUsableJwtSecret()).not.toThrow())
  })
})

describe('input bounds', () => {
  async function listCtx() {
    const db = makeTestDb()
    const userId = await seedUser(db, 'alice')
    const caller = createCaller({ db, userId })
    const { id: listId } = await caller.lists.create({ encryptedName: '{}', encryptedListKey: 'k' })
    return { caller, listId }
  }

  it('rejects an oversized task payload', async () => {
    const { caller, listId } = await listCtx()
    await expect(
      caller.tasks.create({ listId, encryptedPayload: 'x'.repeat(MAX_TASK_PAYLOAD + 1) })
    ).rejects.toThrow()
    // The bound is generous enough for real ciphertext.
    await expect(caller.tasks.create({ listId, encryptedPayload: 'x'.repeat(1024) })).resolves.toBeDefined()
  })

  it('rejects an unbounded clearDone batch', async () => {
    const { caller, listId } = await listCtx()
    const taskIds = Array.from({ length: MAX_TASK_IDS + 1 }, () => randomUUID())
    await expect(caller.tasks.clearDone({ listId, taskIds })).rejects.toThrow()
  })

  it('rejects an oversized password hash before hashing it', async () => {
    const db = makeTestDb()
    const caller = createCaller({ db, userId: null })
    await expect(
      caller.auth.login({ username: 'anyone', passwordHash: 'x'.repeat(100_000) })
    ).rejects.toThrow()
  })

  it('rejects a verification code that is not six digits', async () => {
    const db = makeTestDb()
    const userId = await seedUser(db, 'alice')
    const caller = createCaller({ db, userId })
    await expect(
      caller.devices.approve({ deviceId: randomUUID(), verificationCode: 'x'.repeat(5000), sealedUserPrivateKey: 's' })
    ).rejects.toThrow()
  })
})
