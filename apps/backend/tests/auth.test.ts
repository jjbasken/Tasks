import { describe, it, expect } from 'bun:test'
import { createCallerFactory } from '@trpc/server/unstable-core-do-not-import'
import { appRouter } from '../src/router.js'
import { makeCtx, makeAdminCtx } from './helpers.js'

const createCaller = createCallerFactory()(appRouter)

describe('auth.register', () => {
  it('creates a user and returns userId', async () => {
    const ctx = await makeAdminCtx()
    const caller = createCaller(ctx)
    const result = await caller.auth.register({
      username: 'alice',
      email: 'alice@example.com',
      passwordHash: 'hashed',
      publicKey: 'pubkey-b64',
      kdfSalt: 'salt-b64',
      encryptedPrivateKey: JSON.stringify({ ciphertext: 'ct', nonce: 'n' }),
      encryptedPersonalListKey: JSON.stringify({ ciphertext: 'ct2', nonce: 'n2' }),
      encryptedPersonalListName: JSON.stringify({ ciphertext: 'ct3', nonce: 'n3' }),
    })
    expect(result.userId).toBeString()
  })

  it('throws if username is already taken', async () => {
    const ctx = await makeAdminCtx()
    const caller = createCaller(ctx)
    const payload = {
      username: 'bob',
      email: 'bob@example.com',
      passwordHash: 'hashed',
      publicKey: 'pk',
      kdfSalt: 'salt',
      encryptedPrivateKey: '{}',
      encryptedPersonalListKey: '{}',
      encryptedPersonalListName: '{}',
    }
    await caller.auth.register(payload)
    await expect(caller.auth.register({ ...payload, email: 'bob2@example.com' })).rejects.toThrow()
  })

  it('throws UNAUTHORIZED when called without admin context after first user exists', async () => {
    // Bootstrap the first user, then verify unauthenticated callers are rejected
    const ctx = makeCtx()
    const caller = createCaller(ctx)
    await caller.auth.register({
      username: 'bootstrap',
      email: 'bootstrap@example.com',
      passwordHash: 'h',
      publicKey: 'pk',
      kdfSalt: 's',
      encryptedPrivateKey: '{}',
      encryptedPersonalListKey: '{}',
      encryptedPersonalListName: '{}',
    })
    await expect(caller.auth.register({
      username: 'x',
      email: 'x@example.com',
      passwordHash: 'h',
      publicKey: 'pk',
      kdfSalt: 's',
      encryptedPrivateKey: '{}',
      encryptedPersonalListKey: '{}',
      encryptedPersonalListName: '{}',
    })).rejects.toThrow()
  })
})

describe('auth.getLoginChallenge', () => {
  it('returns only the kdfSalt for a registered user (no encrypted key material)', async () => {
    const ctx = await makeAdminCtx()
    const caller = createCaller(ctx)
    await caller.auth.register({
      username: 'carol',
      email: 'carol@example.com',
      passwordHash: 'h',
      publicKey: 'pk',
      kdfSalt: 'my-salt',
      encryptedPrivateKey: '{"ciphertext":"c","nonce":"n"}',
      encryptedPersonalListKey: '{"ciphertext":"c2","nonce":"n2"}',
      encryptedPersonalListName: '{"ciphertext":"c3","nonce":"n3"}',
    })
    const challenge = await caller.auth.getLoginChallenge({ username: 'carol' })
    expect(challenge.kdfSalt).toBe('my-salt')
    // Encrypted key material must NOT be exposed pre-authentication.
    expect((challenge as any).encryptedPrivateKey).toBeUndefined()
  })

  it('returns a stable decoy salt for unknown usernames (no enumeration oracle)', async () => {
    const ctx = makeCtx()
    const caller = createCaller(ctx)
    // Must not throw / must not distinguish unknown users from known ones.
    const first = await caller.auth.getLoginChallenge({ username: 'nobody' })
    const second = await caller.auth.getLoginChallenge({ username: 'nobody' })
    expect(first.kdfSalt).toBeString()
    expect(first.kdfSalt).toBe(second.kdfSalt) // deterministic per username
  })
})

describe('auth.login', () => {
  it('returns a token for valid credentials', async () => {
    const ctx = await makeAdminCtx()
    const caller = createCaller(ctx)
    await caller.auth.register({
      username: 'dave',
      email: 'dave@example.com',
      passwordHash: 'secret',
      publicKey: 'pk',
      kdfSalt: 's',
      encryptedPrivateKey: '{}',
      encryptedPersonalListKey: '{}',
      encryptedPersonalListName: '{}',
    })
    const result = await caller.auth.login({ username: 'dave', passwordHash: 'secret' })
    expect(result.token).toBeString()
    // Encrypted key material is delivered here, after password verification.
    expect(result.encryptedPrivateKey).toBeString()
    expect(result.encryptedPersonalListKey).toBeString()
  })

  it('throws UNAUTHORIZED for wrong password', async () => {
    const ctx = await makeAdminCtx()
    const caller = createCaller(ctx)
    await caller.auth.register({
      username: 'eve',
      email: 'eve@example.com',
      passwordHash: 'correct',
      publicKey: 'pk',
      kdfSalt: 's',
      encryptedPrivateKey: '{}',
      encryptedPersonalListKey: '{}',
      encryptedPersonalListName: '{}',
    })
    await expect(caller.auth.login({ username: 'eve', passwordHash: 'wrong' })).rejects.toThrow()
  })
})

describe('auth.register bootstrap mode', () => {
  it('allows unauthenticated first registration and grants isAdmin', async () => {
    // Fresh DB with zero users — unauthenticated caller should be allowed
    const ctx = makeCtx()  // userId: null
    const caller = createCaller(ctx)
    const { userId } = await caller.auth.register({
      username: 'firstuser',
      email: 'first@example.com',
      passwordHash: 'h',
      publicKey: 'pk',
      kdfSalt: 's',
      encryptedPrivateKey: '{}',
      encryptedPersonalListKey: '{}',
      encryptedPersonalListName: '{}',
    })
    const rows = await ctx.db.select().from((await import('../src/db/schema.js')).users)
    const created = rows.find(u => u.id === userId)
    expect(created?.isAdmin).toBe(true)
  })

  it('rejects unauthenticated registration when users already exist', async () => {
    const ctx = makeCtx()
    const caller = createCaller(ctx)
    // First registration succeeds (bootstrap)
    await caller.auth.register({
      username: 'first',
      email: 'first@example.com',
      passwordHash: 'h',
      publicKey: 'pk',
      kdfSalt: 's',
      encryptedPrivateKey: '{}',
      encryptedPersonalListKey: '{}',
      encryptedPersonalListName: '{}',
    })
    // Second registration without auth must fail
    await expect(caller.auth.register({
      username: 'second',
      email: 'second@example.com',
      passwordHash: 'h',
      publicKey: 'pk',
      kdfSalt: 's',
      encryptedPrivateKey: '{}',
      encryptedPersonalListKey: '{}',
      encryptedPersonalListName: '{}',
    })).rejects.toThrow()
  })
})

describe('auth.register isAdmin', () => {
  it('creates a regular user by default', async () => {
    const ctx = await makeAdminCtx()
    const caller = createCaller(ctx)
    const { userId } = await caller.auth.register({
      username: 'regular',
      email: 'regular@example.com',
      passwordHash: 'h',
      publicKey: 'pk',
      kdfSalt: 's',
      encryptedPrivateKey: '{}',
      encryptedPersonalListKey: '{}',
      encryptedPersonalListName: '{}',
    })
    const rows = await ctx.db.select().from((await import('../src/db/schema.js')).users)
    const newUser = rows.find(u => u.id === userId)
    expect(newUser?.isAdmin).toBe(false)
  })

  it('creates an admin user when isAdmin is true', async () => {
    const ctx = await makeAdminCtx()
    const caller = createCaller(ctx)
    const { userId } = await caller.auth.register({
      username: 'newadmin',
      email: 'newadmin@example.com',
      passwordHash: 'h',
      publicKey: 'pk',
      kdfSalt: 's',
      encryptedPrivateKey: '{}',
      encryptedPersonalListKey: '{}',
      encryptedPersonalListName: '{}',
      isAdmin: true,
    })
    const rows = await ctx.db.select().from((await import('../src/db/schema.js')).users)
    const newUser = rows.find(u => u.id === userId)
    expect(newUser?.isAdmin).toBe(true)
  })
})

describe('auth.logout — session revocation', () => {
  it('invalidates the calling token without touching other sessions', async () => {
    const { createContext } = await import('../src/context.js')
    const ctx = await makeAdminCtx()
    const caller = createCaller(ctx)
    await caller.auth.register({
      username: 'frank',
      email: 'frank@example.com',
      passwordHash: 'pw',
      publicKey: 'pk',
      kdfSalt: 's',
      encryptedPrivateKey: '{}',
      encryptedPersonalListKey: '{}',
      encryptedPersonalListName: '{}',
    })

    // Two independent sessions for the same user
    const a = await caller.auth.login({ username: 'frank', passwordHash: 'pw' })
    const b = await caller.auth.login({ username: 'frank', passwordHash: 'pw' })
    const ctxFor = (token: string) =>
      createContext({ req: new Request('http://localhost', { headers: { authorization: `Bearer ${token}` } }) }, ctx.db)

    const before = await ctxFor(a.token)
    expect(before.userId).toBeString()

    // Log out session A
    await createCaller(await ctxFor(a.token)).auth.logout()

    expect((await ctxFor(a.token)).userId).toBeNull()
    // Session B is untouched — logout is per-session, not logout-everywhere.
    expect((await ctxFor(b.token)).userId).toBeString()
  })
})

describe('auth.login — account enumeration', () => {
  it('fails the same way for unknown and wrong-password logins', async () => {
    const ctx = await makeAdminCtx()
    const caller = createCaller(ctx)
    await caller.auth.register({
      username: 'grace',
      email: 'grace@example.com',
      passwordHash: 'right',
      publicKey: 'pk',
      kdfSalt: 's',
      encryptedPrivateKey: '{}',
      encryptedPersonalListKey: '{}',
      encryptedPersonalListName: '{}',
    })

    const codeOf = async (username: string) => {
      try {
        await caller.auth.login({ username, passwordHash: 'wrong' })
        return 'OK'
      } catch (err: any) {
        return err.code ?? err.cause?.code ?? String(err)
      }
    }

    expect(await codeOf('nobody-at-all')).toBe(await codeOf('grace'))
  })
})
