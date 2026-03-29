import { describe, it, expect } from 'bun:test'
import { createCallerFactory } from '@trpc/server/unstable-core-do-not-import'
import { randomUUID } from 'crypto'
import { eq } from 'drizzle-orm'
import { appRouter } from '../src/router.js'
import { makeCtx, makeAdminCtx } from './helpers.js'
import { users } from '../src/db/schema.js'

const createCaller = createCallerFactory()(appRouter)

async function registerUser(adminCtx: Awaited<ReturnType<typeof makeAdminCtx>>, username: string, isAdmin = false) {
  const caller = createCaller(adminCtx)
  return caller.auth.register({
    username,
    email: `${username}@example.com`,
    passwordHash: 'h',
    publicKey: 'pk',
    kdfSalt: 's',
    encryptedPrivateKey: '{}',
    encryptedPersonalListKey: '{}',
    encryptedPersonalListName: '{}',
    isAdmin,
  })
}

describe('users.list', () => {
  it('returns all users with id, username, email, isAdmin, createdAt', async () => {
    const ctx = await makeAdminCtx()
    await registerUser(ctx, 'alice')
    await registerUser(ctx, 'bob', true)
    const caller = createCaller(ctx)
    const list = await caller.users.list()
    // includes the seed admin + alice + bob
    expect(list.length).toBe(3)
    const alice = list.find(u => u.username === 'alice')
    expect(alice?.isAdmin).toBe(false)
    const bob = list.find(u => u.username === 'bob')
    expect(bob?.isAdmin).toBe(true)
    expect(alice?.id).toBeString()
    expect(alice?.email).toBe('alice@example.com')
    expect(alice?.createdAt).toBeNumber()
  })

  it('throws FORBIDDEN for non-admin', async () => {
    const adminCtx = await makeAdminCtx()
    const { userId } = await registerUser(adminCtx, 'carol')
    const caller = createCaller({ db: adminCtx.db, userId })
    await expect(caller.users.list()).rejects.toThrow()
  })
})

describe('users.setAdmin', () => {
  it('promotes a user to admin', async () => {
    const ctx = await makeAdminCtx()
    const { userId } = await registerUser(ctx, 'dave')
    const caller = createCaller(ctx)
    await caller.users.setAdmin({ userId, isAdmin: true })
    const [row] = await ctx.db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, userId))
    expect(row.isAdmin).toBe(true)
  })

  it('demotes an admin to regular user', async () => {
    const ctx = await makeAdminCtx()
    const { userId } = await registerUser(ctx, 'eve', true)
    const caller = createCaller(ctx)
    await caller.users.setAdmin({ userId, isAdmin: false })
    const [row] = await ctx.db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, userId))
    expect(row.isAdmin).toBe(false)
  })

  it('throws FORBIDDEN when admin tries to change their own role', async () => {
    const ctx = await makeAdminCtx()
    const caller = createCaller(ctx)
    await expect(caller.users.setAdmin({ userId: ctx.userId!, isAdmin: false })).rejects.toThrow()
  })

  it('throws FORBIDDEN for non-admin', async () => {
    const adminCtx = await makeAdminCtx()
    const { userId } = await registerUser(adminCtx, 'frank')
    const caller = createCaller({ db: adminCtx.db, userId })
    await expect(caller.users.setAdmin({ userId, isAdmin: true })).rejects.toThrow()
  })
})
