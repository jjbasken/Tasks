import { describe, it, expect } from 'bun:test'
import { createCallerFactory } from '@trpc/server/unstable-core-do-not-import'
import { randomUUID } from 'crypto'
import { appRouter } from '../src/router.js'
import { makeTestDb } from './helpers.js'
import { users } from '../src/db/schema.js'

const createCaller = createCallerFactory()(appRouter)

async function seedUser(db: ReturnType<typeof makeTestDb>) {
  const userId = randomUUID()
  await db.insert(users).values({ id: userId, username: 'u', email: 'u@u.com', passwordHash: 'h', publicKey: 'pk', kdfSalt: 's', encryptedPrivateKey: '{}', encryptedPersonalListKey: '{}', createdAt: Date.now() })
  return userId
}

import { createContext } from '../src/context.js'

describe('devices.revoke — token invalidation', () => {
  it('revoked device token is rejected by createContext', async () => {
    const db = makeTestDb()
    const userId = await seedUser(db)
    const anonCaller = createCaller({ db, userId: null })
    const authedCaller = createCaller({ db, userId })

    const { deviceId, pendingToken } = await anonCaller.devices.requestApproval({ username: 'u', name: 'Test', devicePublicKey: 'pk' })
    await authedCaller.devices.approve({ deviceId, sealedUserPrivateKey: 'sealed' })
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
  it('rejects when user already has 5 pending device requests', async () => {
    const db = makeTestDb()
    await seedUser(db)
    const caller = createCaller({ db, userId: null })

    // Submit 5 pending requests
    for (let i = 0; i < 5; i++) {
      await caller.devices.requestApproval({ username: 'u', name: `device-${i}`, devicePublicKey: `pk${i}` })
    }

    // 6th request should fail
    await expect(
      caller.devices.requestApproval({ username: 'u', name: 'overflow', devicePublicKey: 'pkX' })
    ).rejects.toThrow()
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
    await authedCaller.devices.approve({ deviceId, sealedUserPrivateKey: 'sealed' })

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

    await authedCaller.devices.approve({ deviceId, sealedUserPrivateKey: 'sealed-key' })

    const approval = await anonCaller.devices.checkApproval({ deviceId, pendingToken })
    expect(approval?.sealedUserPrivateKey).toBe('sealed-key')
    expect(approval?.token).toBeString()
  })
})
