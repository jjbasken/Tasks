import { beforeEach, describe, it, expect } from 'bun:test'
import { createCallerFactory } from '@trpc/server/unstable-core-do-not-import'
import { randomUUID } from 'crypto'
import { deviceVerificationCode } from '@tasks/shared'
import { appRouter } from '../src/router.js'
import { makeTestDb } from './helpers.js'
import { devices, users } from '../src/db/schema.js'
import { resetAllRateLimits } from '../src/lib/rateLimit.js'

const createCaller = createCallerFactory()(appRouter)

beforeEach(() => resetAllRateLimits())

async function seedUser(db: ReturnType<typeof makeTestDb>) {
  const userId = randomUUID()
  await db.insert(users).values({ id: userId, username: 'u', email: 'u@u.com', passwordHash: 'h', publicKey: 'pk', kdfSalt: 's', encryptedPrivateKey: '{}', encryptedPersonalListKey: '{}', createdAt: Date.now() })
  return userId
}

import { eq } from 'drizzle-orm'
import { createContext } from '../src/context.js'

describe('devices.revoke — token invalidation', () => {
  it('revoked device token is rejected by createContext', async () => {
    const db = makeTestDb()
    const userId = await seedUser(db)
    const anonCaller = createCaller({ db, userId: null })
    const authedCaller = createCaller({ db, userId })

    const { deviceId, pendingToken } = await anonCaller.devices.requestApproval({ username: 'u', name: 'Test', devicePublicKey: 'pk' })
    await authedCaller.devices.approve({ deviceId, verificationCode: await deviceVerificationCode('pk'), sealedUserPrivateKey: 'sealed' })
    const result = await anonCaller.devices.checkApproval({ deviceId, pendingToken })
    const token = result!.token

    // Verify token works before revocation
    const ctxBefore = await createContext({ req: new Request('http://localhost', { headers: { authorization: `Bearer ${token}` } }) }, db)
    expect(ctxBefore.userId).toBe(userId)

    // Revoke the device
    await authedCaller.devices.revoke({ deviceId })

    // Verify token no longer works after revocation
    const ctxAfter = await createContext({ req: new Request('http://localhost', { headers: { authorization: `Bearer ${token}` } }) }, db)
    expect(ctxAfter.userId).toBeNull()
  })
})

describe('devices.requestApproval rate limit', () => {
  it('returns a non-resolving decoy when a user already has 5 pending requests', async () => {
    const db = makeTestDb()
    await seedUser(db)
    const caller = createCaller({ db, userId: null })

    // Submit 5 pending requests
    for (let i = 0; i < 5; i++) {
      await caller.devices.requestApproval({ username: 'u', name: `device-${i}`, devicePublicKey: `pk${i}` })
    }

    const overflow = await caller.devices.requestApproval({ username: 'u', name: 'overflow', devicePublicKey: 'pkX' })
    expect(await caller.devices.checkApproval(overflow)).toBeNull()
    expect(await db.select().from(devices)).toHaveLength(5)
  })

  it('removes expired requests before applying the per-account quota', async () => {
    const db = makeTestDb()
    const userId = await seedUser(db)
    const caller = createCaller({ db, userId: null })
    for (let i = 0; i < 5; i++) {
      await caller.devices.requestApproval({ username: 'u', name: `stale-${i}`, devicePublicKey: `pk${i}` })
    }
    await db.update(devices).set({ createdAt: Date.now() - 11 * 60 * 1000 }).where(eq(devices.userId, userId))

    const fresh = await caller.devices.requestApproval({ username: 'u', name: 'legitimate', devicePublicKey: 'fresh-pk' })
    const [stored] = await db.select().from(devices).where(eq(devices.id, fresh.deviceId))
    expect(stored?.name).toBe('legitimate')
    expect(await db.select().from(devices)).toHaveLength(1)
  })
})

describe('devices.requestApproval', () => {
  it('creates a pending device and returns pendingToken', async () => {
    const db = makeTestDb()
    await seedUser(db)
    const caller = createCaller({ db, userId: null })
    const result = await caller.devices.requestApproval({ username: 'u', name: 'iPhone', devicePublicKey: 'devpk' })
    expect(result.deviceId).toBeString()
    expect(result.pendingToken).toBeString()
  })
})

describe('devices.checkApproval token reuse prevention', () => {
  it('clears pendingToken after first successful checkApproval', async () => {
    const db = makeTestDb()
    const userId = await seedUser(db)
    const anonCaller = createCaller({ db, userId: null })
    const authedCaller = createCaller({ db, userId })

    const { deviceId, pendingToken } = await anonCaller.devices.requestApproval({ username: 'u', name: 'Test', devicePublicKey: 'pk' })
    await authedCaller.devices.approve({ deviceId, verificationCode: await deviceVerificationCode('pk'), sealedUserPrivateKey: 'sealed' })

    // First call succeeds
    const first = await anonCaller.devices.checkApproval({ deviceId, pendingToken })
    expect(first?.token).toBeString()

    // Second call with same token returns null (token was cleared)
    const second = await anonCaller.devices.checkApproval({ deviceId, pendingToken })
    expect(second).toBeNull()
  })
})

describe('devices.listPending + approve + checkApproval', () => {
  it('full device approval flow', async () => {
    const db = makeTestDb()
    const userId = await seedUser(db)

    const anonCaller = createCaller({ db, userId: null })
    const { deviceId, pendingToken } = await anonCaller.devices.requestApproval({ username: 'u', name: 'iPad', devicePublicKey: 'devpk2' })

    const authedCaller = createCaller({ db, userId })
    const pending = await authedCaller.devices.listPending()
    expect(pending).toHaveLength(1)
    expect(pending[0].id).toBe(deviceId)

    await authedCaller.devices.approve({ deviceId, verificationCode: await deviceVerificationCode('devpk2'), sealedUserPrivateKey: 'sealed-key' })

    const approval = await anonCaller.devices.checkApproval({ deviceId, pendingToken })
    expect(approval?.sealedUserPrivateKey).toBe('sealed-key')
    expect(approval?.token).toBeString()
  })
})

describe('devices.approve — pairing verification code', () => {
  it('rejects approval when the verification code does not match the device key', async () => {
    const db = makeTestDb()
    const userId = await seedUser(db)
    const anonCaller = createCaller({ db, userId: null })
    const authedCaller = createCaller({ db, userId })

    // Attacker queues a request against a known username with their own keypair.
    const { deviceId, pendingToken } = await anonCaller.devices.requestApproval({ username: 'u', name: 'iPhone 15', devicePublicKey: 'attacker-pk' })

    // Any code other than the one derived from the device's own key.
    const real = await deviceVerificationCode('attacker-pk')
    const wrong = real === '000000' ? '111111' : '000000'

    // Victim clicking approve is not enough — without the code from the requesting
    // device's screen, the private key is never sealed to it.
    await expect(
      authedCaller.devices.approve({ deviceId, verificationCode: wrong, sealedUserPrivateKey: 'sealed' })
    ).rejects.toThrow()

    const approval = await anonCaller.devices.checkApproval({ deviceId, pendingToken })
    expect(approval).toBeNull()
  })

  it('rejects approval of an expired pending request and hides it from listPending', async () => {
    const db = makeTestDb()
    const userId = await seedUser(db)
    const anonCaller = createCaller({ db, userId: null })
    const authedCaller = createCaller({ db, userId })

    const { deviceId } = await anonCaller.devices.requestApproval({ username: 'u', name: 'stale', devicePublicKey: 'pk' })
    // Age the request past the 10-minute window
    await db.update(devices).set({ createdAt: Date.now() - 11 * 60 * 1000 }).where(eq(devices.id, deviceId))

    expect(await authedCaller.devices.listPending()).toHaveLength(0)
    await expect(
      authedCaller.devices.approve({ deviceId, verificationCode: await deviceVerificationCode('pk'), sealedUserPrivateKey: 'sealed' })
    ).rejects.toThrow()
  })

  it('rejects re-approval of an already-revoked device', async () => {
    const db = makeTestDb()
    const userId = await seedUser(db)
    const anonCaller = createCaller({ db, userId: null })
    const authedCaller = createCaller({ db, userId })
    const code = await deviceVerificationCode('pk')

    const { deviceId } = await anonCaller.devices.requestApproval({ username: 'u', name: 'Test', devicePublicKey: 'pk' })
    await authedCaller.devices.approve({ deviceId, verificationCode: code, sealedUserPrivateKey: 'sealed' })
    await authedCaller.devices.revoke({ deviceId })

    await expect(
      authedCaller.devices.approve({ deviceId, verificationCode: code, sealedUserPrivateKey: 'sealed-again' })
    ).rejects.toThrow()
  })
})

describe('devices.requestApproval — account enumeration', () => {
  it('returns an unapprovable handle for unknown usernames instead of NOT_FOUND', async () => {
    const db = makeTestDb()
    await seedUser(db)
    const caller = createCaller({ db, userId: null })

    const known = await caller.devices.requestApproval({ username: 'u', name: 'a', devicePublicKey: 'pk1' })
    const unknown = await caller.devices.requestApproval({ username: 'does-not-exist', name: 'a', devicePublicKey: 'pk2' })

    // Same response shape — no oracle for which accounts exist.
    expect(unknown.deviceId).toBeString()
    expect(unknown.pendingToken).toBeString()
    expect(Object.keys(unknown).sort()).toEqual(Object.keys(known).sort())

    // ...and the decoy handle never resolves to a session.
    expect(await caller.devices.checkApproval({ deviceId: unknown.deviceId, pendingToken: unknown.pendingToken })).toBeNull()
    // No row was created for the nonexistent user.
    expect(await db.select().from(devices)).toHaveLength(1)
  })

  it('keeps the same response behavior after a real account reaches its quota', async () => {
    const db = makeTestDb()
    await seedUser(db)
    const caller = createCaller({ db, userId: null })
    for (let i = 0; i < 5; i++) {
      await caller.devices.requestApproval({ username: 'u', name: `a-${i}`, devicePublicKey: `pk-${i}` })
    }
    const knownFull = await caller.devices.requestApproval({ username: 'u', name: 'a', devicePublicKey: 'pk-x' })
    const unknown = await caller.devices.requestApproval({ username: 'missing', name: 'a', devicePublicKey: 'pk-y' })
    expect(Object.keys(knownFull).sort()).toEqual(Object.keys(unknown).sort())
    expect(await caller.devices.checkApproval(knownFull)).toBeNull()
    expect(await caller.devices.checkApproval(unknown)).toBeNull()
  })
})
