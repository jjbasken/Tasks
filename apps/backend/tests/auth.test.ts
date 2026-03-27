import { describe, it, expect } from 'bun:test'
import { createCallerFactory } from '@trpc/server/unstable-core-do-not-import'
import { appRouter } from '../src/router.js'
import { makeCtx } from './helpers.js'

const createCaller = createCallerFactory()(appRouter)

describe('auth.register', () => {
  it('creates a user and returns userId', async () => {
    const ctx = makeCtx()
    const caller = createCaller(ctx)
    const result = await caller.auth.register({
      username: 'alice',
      email: 'alice@example.com',
      passwordHash: 'hashed',
      publicKey: 'pubkey-b64',
      kdfSalt: 'salt-b64',
      encryptedPrivateKey: JSON.stringify({ ciphertext: 'ct', nonce: 'n' }),
      encryptedPersonalListKey: JSON.stringify({ ciphertext: 'ct2', nonce: 'n2' }),
    })
    expect(result.userId).toBeString()
  })

  it('throws if username is already taken', async () => {
    const ctx = makeCtx()
    const caller = createCaller(ctx)
    const payload = {
      username: 'bob',
      email: 'bob@example.com',
      passwordHash: 'hashed',
      publicKey: 'pk',
      kdfSalt: 'salt',
      encryptedPrivateKey: '{}',
      encryptedPersonalListKey: '{}',
    }
    await caller.auth.register(payload)
    await expect(caller.auth.register({ ...payload, email: 'bob2@example.com' })).rejects.toThrow()
  })
})

describe('auth.getLoginChallenge', () => {
  it('returns kdfSalt and encrypted keys for a registered user', async () => {
    const ctx = makeCtx()
    const caller = createCaller(ctx)
    await caller.auth.register({
      username: 'carol',
      email: 'carol@example.com',
      passwordHash: 'h',
      publicKey: 'pk',
      kdfSalt: 'my-salt',
      encryptedPrivateKey: '{"ciphertext":"c","nonce":"n"}',
      encryptedPersonalListKey: '{"ciphertext":"c2","nonce":"n2"}',
    })
    const challenge = await caller.auth.getLoginChallenge({ username: 'carol' })
    expect(challenge.kdfSalt).toBe('my-salt')
    expect(challenge.encryptedPrivateKey).toBeString()
  })

  it('throws NOT_FOUND for unknown username', async () => {
    const ctx = makeCtx()
    const caller = createCaller(ctx)
    await expect(caller.auth.getLoginChallenge({ username: 'nobody' })).rejects.toThrow()
  })
})

describe('auth.login', () => {
  it('returns a token for valid credentials', async () => {
    const ctx = makeCtx()
    const caller = createCaller(ctx)
    await caller.auth.register({
      username: 'dave',
      email: 'dave@example.com',
      passwordHash: 'secret',
      publicKey: 'pk',
      kdfSalt: 's',
      encryptedPrivateKey: '{}',
      encryptedPersonalListKey: '{}',
    })
    const result = await caller.auth.login({ username: 'dave', passwordHash: 'secret' })
    expect(result.token).toBeString()
  })

  it('throws UNAUTHORIZED for wrong password', async () => {
    const ctx = makeCtx()
    const caller = createCaller(ctx)
    await caller.auth.register({
      username: 'eve',
      email: 'eve@example.com',
      passwordHash: 'correct',
      publicKey: 'pk',
      kdfSalt: 's',
      encryptedPrivateKey: '{}',
      encryptedPersonalListKey: '{}',
    })
    await expect(caller.auth.login({ username: 'eve', passwordHash: 'wrong' })).rejects.toThrow()
  })
})
