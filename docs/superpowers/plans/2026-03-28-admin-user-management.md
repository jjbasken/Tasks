# Admin User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins mark new users as admin at creation time, view all users, and toggle admin role post-creation.

**Architecture:** Three backend changes (register mutation, list query, setAdmin mutation) + two frontend changes (useAuth hook, RegisterPage). All backend changes land in existing files; no new files needed.

**Tech Stack:** Bun, tRPC, Drizzle ORM (SQLite), React, React Query

---

### Task 1: Add `makeAdminCtx` test helper and fix existing auth tests

The `auth.register` procedure uses `adminProcedure`, which requires `ctx.userId` to be set and belong to an admin user. The existing tests pass `makeCtx()` (userId = null) and are currently failing. This task fixes them.

**Files:**
- Modify: `apps/backend/tests/helpers.ts`
- Modify: `apps/backend/tests/auth.test.ts`

- [ ] **Step 1: Add `makeAdminCtx` to helpers**

Replace the contents of `apps/backend/tests/helpers.ts` with:

```ts
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { randomUUID } from 'crypto'
import * as schema from '../src/db/schema.js'
import { migrate } from '../src/db/migrate.js'
import type { AppContext } from '../src/context.js'

export function makeTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.run('PRAGMA foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db)
  return db
}

export function makeCtx(userId: string | null = null): AppContext {
  return { db: makeTestDb(), userId }
}

export async function makeAdminCtx(): Promise<AppContext> {
  const db = makeTestDb()
  const userId = randomUUID()
  await db.insert(schema.users).values({
    id: userId,
    username: 'admin',
    email: 'admin@example.com',
    passwordHash: 'hash',
    publicKey: 'pk',
    kdfSalt: 'salt',
    encryptedPrivateKey: '{}',
    encryptedPersonalListKey: '{}',
    isAdmin: true,
    createdAt: Date.now(),
  })
  return { db, userId }
}
```

- [ ] **Step 2: Update auth tests to use `makeAdminCtx`**

Replace the contents of `apps/backend/tests/auth.test.ts` with:

```ts
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

  it('throws UNAUTHORIZED when called without admin context', async () => {
    const ctx = makeCtx()
    const caller = createCaller(ctx)
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
  it('returns kdfSalt and encrypted keys for a registered user', async () => {
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
```

- [ ] **Step 3: Run tests**

```bash
cd apps/backend && bun test tests/auth.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/tests/helpers.ts apps/backend/tests/auth.test.ts
git commit -m "fix: update auth tests to use admin context"
```

---

### Task 2: Add `isAdmin` to `auth.register`

**Files:**
- Modify: `apps/backend/src/routers/auth.ts`
- Modify: `apps/backend/tests/auth.test.ts`

- [ ] **Step 1: Write the failing test**

Add this `describe` block to the end of `apps/backend/tests/auth.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/backend && bun test tests/auth.test.ts --test-name-pattern "isAdmin"
```

Expected: FAIL — `isAdmin` field not accepted by schema yet.

- [ ] **Step 3: Add `isAdmin` to the register mutation**

In `apps/backend/src/routers/auth.ts`, add `isAdmin` to the input schema and insert:

```ts
register: adminProcedure
  .input(z.object({
    username: z.string().min(2).max(40),
    email: z.string().email(),
    passwordHash: z.string(),
    publicKey: z.string(),
    kdfSalt: z.string(),
    encryptedPrivateKey: z.string(),
    encryptedPersonalListKey: z.string(),
    encryptedPersonalListName: z.string(),
    isAdmin: z.boolean().optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    const existing = await ctx.db.select().from(users).where(eq(users.username, input.username))
    if (existing.length > 0) throw new TRPCError({ code: 'CONFLICT', message: 'Username taken' })
    const passwordHash = await Bun.password.hash(input.passwordHash, { algorithm: 'argon2id' })
    const userId = randomUUID()
    const now = Date.now()
    await ctx.db.insert(users).values({
      id: userId,
      username: input.username,
      email: input.email,
      passwordHash,
      publicKey: input.publicKey,
      kdfSalt: input.kdfSalt,
      encryptedPrivateKey: input.encryptedPrivateKey,
      encryptedPersonalListKey: input.encryptedPersonalListKey,
      isAdmin: input.isAdmin ?? false,
      createdAt: now,
    })
    const listId = randomUUID()
    await ctx.db.insert(lists).values({ id: listId, ownerId: userId, encryptedName: input.encryptedPersonalListName, isShared: false, createdAt: now })
    await ctx.db.insert(listMemberships).values({ id: randomUUID(), listId, userId, encryptedListKey: input.encryptedPersonalListKey, invitedBy: null, createdAt: now })
    return { userId }
  }),
```

- [ ] **Step 4: Run tests**

```bash
cd apps/backend && bun test tests/auth.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/routers/auth.ts apps/backend/tests/auth.test.ts
git commit -m "feat: add isAdmin flag to auth.register"
```

---

### Task 3: Add `users.list` and `users.setAdmin` to backend

**Files:**
- Modify: `apps/backend/src/routers/users.ts`
- Create: `apps/backend/tests/users.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/backend/tests/users.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/backend && bun test tests/users.test.ts
```

Expected: FAIL — `users.list` and `users.setAdmin` not defined yet.

- [ ] **Step 3: Implement `users.list` and `users.setAdmin`**

Replace the contents of `apps/backend/src/routers/users.ts` with:

```ts
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, protectedProcedure, adminProcedure } from '../trpc.js'
import { users } from '../db/schema.js'

export const usersRouter = router({
  search: protectedProcedure
    .input(z.object({ username: z.string() }))
    .query(async ({ ctx, input }) => {
      const [user] = await ctx.db.select({ userId: users.id, username: users.username, publicKey: users.publicKey }).from(users).where(eq(users.username, input.username))
      return user ?? null
    }),

  me: protectedProcedure.query(async ({ ctx }) => {
    const [user] = await ctx.db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, ctx.userId))
    return { isAdmin: user?.isAdmin ?? false }
  }),

  list: adminProcedure.query(async ({ ctx }) => {
    return ctx.db.select({
      id: users.id,
      username: users.username,
      email: users.email,
      isAdmin: users.isAdmin,
      createdAt: users.createdAt,
    }).from(users).orderBy(users.createdAt)
  }),

  setAdmin: adminProcedure
    .input(z.object({ userId: z.string(), isAdmin: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.userId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot change your own admin status' })
      }
      await ctx.db.update(users).set({ isAdmin: input.isAdmin }).where(eq(users.id, input.userId))
      return { ok: true }
    }),
})
```

- [ ] **Step 4: Run tests**

```bash
cd apps/backend && bun test tests/users.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Run full backend test suite**

```bash
cd apps/backend && bun test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/routers/users.ts apps/backend/tests/users.test.ts
git commit -m "feat: add users.list and users.setAdmin endpoints"
```

---

### Task 4: Update `useAuth` to forward `isAdmin` to register

**Files:**
- Modify: `apps/frontend/src/hooks/useAuth.tsx`

- [ ] **Step 1: Update `AuthContextType` and `register` signature**

In `apps/frontend/src/hooks/useAuth.tsx`, make two edits:

1. Update the type:
```ts
type AuthContextType = {
  isLoggedIn: boolean
  isAdmin: boolean
  login: (username: string, passphrase: string) => Promise<void>
  register: (username: string, email: string, passphrase: string, isAdmin?: boolean) => Promise<void>
  logout: () => void
}
```

2. Update the `register` function signature and mutation call:
```ts
async function register(username: string, email: string, passphrase: string, isAdmin = false) {
  await initCrypto()
  const kdfSalt = generateKdfSalt()
  const stretchKey = await deriveStretchKey(passphrase, kdfSalt)
  const { publicKey, privateKey } = generateKeypair()
  const listKey = generateListKey()
  const encPrivKey = encryptSymmetric(privateKey, stretchKey)
  const encListKey = encryptSymmetric(listKey, stretchKey)
  const encListName = encryptSymmetric('Personal', stretchKey)
  await utils.client.auth.register.mutate({
    username, email,
    passwordHash: passphrase,
    publicKey,
    kdfSalt,
    encryptedPrivateKey: JSON.stringify(encPrivKey),
    encryptedPersonalListKey: JSON.stringify(encListKey),
    encryptedPersonalListName: JSON.stringify(encListName),
    isAdmin,
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/hooks/useAuth.tsx
git commit -m "feat: forward isAdmin param through useAuth.register"
```

---

### Task 5: Update `RegisterPage` — isAdmin checkbox + user list

**Files:**
- Modify: `apps/frontend/src/routes/RegisterPage.tsx`

- [ ] **Step 1: Replace `RegisterPage` with the full updated version**

Replace the contents of `apps/frontend/src/routes/RegisterPage.tsx` with:

```tsx
import { useState } from 'react'
import { useAuth } from '../hooks/useAuth.js'
import { trpc } from '../lib/trpc.js'

export function RegisterPage() {
  const { register } = useAuth()
  const utils = trpc.useUtils()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const { data: userList } = trpc.users.list.useQuery()
  const meQuery = trpc.users.me.useQuery()
  const setAdminMutation = trpc.users.setAdmin.useMutation({
    onSettled: () => utils.users.list.invalidate(),
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (passphrase !== confirm) { setError('Passphrases do not match'); return }
    setError(null)
    setSuccess(null)
    setLoading(true)
    try {
      await register(username, email, passphrase, isAdmin)
      setSuccess(`Account created for ${username}`)
      setUsername('')
      setEmail('')
      setPassphrase('')
      setConfirm('')
      setIsAdmin(false)
      utils.users.list.invalidate()
    } catch (err: any) {
      setError(err?.message ?? 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page" style={{ maxWidth: 700 }}>
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-icon">⚡</div>
          <span className="auth-logo-name">Tasks</span>
        </div>
        <h1 className="auth-heading">Create account</h1>
        <p className="auth-sub">Admin: create a new user account</p>
        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label className="form-label">Username</label>
            <input className="form-input" value={username} onChange={e => setUsername(e.target.value)} required autoFocus />
          </div>
          <div className="form-field">
            <label className="form-label">Email</label>
            <input className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div className="form-field">
            <label className="form-label">Passphrase</label>
            <input className="form-input" type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)} required />
          </div>
          <div className="form-field">
            <label className="form-label">Confirm passphrase</label>
            <input className="form-input" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required />
          </div>
          <div className="form-field" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              id="is-admin-checkbox"
              type="checkbox"
              checked={isAdmin}
              onChange={e => setIsAdmin(e.target.checked)}
              style={{ width: 16, height: 16, cursor: 'pointer' }}
            />
            <label htmlFor="is-admin-checkbox" className="form-label" style={{ margin: 0, cursor: 'pointer' }}>
              Admin user
            </label>
          </div>
          {error && <div className="form-error">{error}</div>}
          {success && <div className="form-success">{success}</div>}
          <button className="btn-primary" type="submit" disabled={loading}>{loading ? 'Creating account…' : 'Create account'}</button>
        </form>
      </div>

      {userList && userList.length > 0 && (
        <div className="auth-card" style={{ marginTop: 24 }}>
          <h2 className="auth-heading" style={{ fontSize: 18 }}>All Users</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '8px 4px', color: 'var(--text-muted)', fontWeight: 500 }}>Username</th>
                <th style={{ textAlign: 'left', padding: '8px 4px', color: 'var(--text-muted)', fontWeight: 500 }}>Email</th>
                <th style={{ textAlign: 'left', padding: '8px 4px', color: 'var(--text-muted)', fontWeight: 500 }}>Role</th>
                <th style={{ textAlign: 'left', padding: '8px 4px', color: 'var(--text-muted)', fontWeight: 500 }}>Joined</th>
              </tr>
            </thead>
            <tbody>
              {userList.map(user => {
                const isSelf = user.id === (meQuery.data as any)?.id
                return (
                  <tr key={user.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 4px' }}>{user.username}</td>
                    <td style={{ padding: '8px 4px', color: 'var(--text-muted)' }}>{user.email}</td>
                    <td style={{ padding: '8px 4px' }}>
                      <button
                        onClick={() => setAdminMutation.mutate({ userId: user.id, isAdmin: !user.isAdmin })}
                        disabled={isSelf || setAdminMutation.isPending}
                        style={{
                          padding: '2px 10px',
                          borderRadius: 4,
                          border: '1px solid var(--border)',
                          background: user.isAdmin ? 'var(--primary)' : 'transparent',
                          color: user.isAdmin ? '#fff' : 'var(--text-muted)',
                          cursor: isSelf ? 'not-allowed' : 'pointer',
                          fontSize: 12,
                          opacity: isSelf ? 0.5 : 1,
                        }}
                        title={isSelf ? 'Cannot change your own role' : undefined}
                      >
                        {user.isAdmin ? 'Admin' : 'User'}
                      </button>
                    </td>
                    <td style={{ padding: '8px 4px', color: 'var(--text-muted)' }}>
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Check that `users.me` returns the user's `id`**

Open `apps/backend/src/routers/users.ts` and check the `me` query. It currently returns only `{ isAdmin }`. To identify the current user's row in the list (to disable their toggle), it needs to also return `id`.

Update the `me` query in `apps/backend/src/routers/users.ts`:

```ts
me: protectedProcedure.query(async ({ ctx }) => {
  const [user] = await ctx.db.select({ id: users.id, isAdmin: users.isAdmin }).from(users).where(eq(users.id, ctx.userId))
  return { id: user?.id ?? null, isAdmin: user?.isAdmin ?? false }
}),
```

- [ ] **Step 3: Fix the `RegisterPage` cast**

Now that `me` returns `id`, remove the `as any` cast in `RegisterPage`. In `apps/frontend/src/routes/RegisterPage.tsx`, change:

```tsx
const isSelf = user.id === (meQuery.data as any)?.id
```

to:

```tsx
const isSelf = user.id === meQuery.data?.id
```

- [ ] **Step 4: Run backend tests to confirm `me` change doesn't break anything**

```bash
cd apps/backend && bun test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/routes/RegisterPage.tsx apps/backend/src/routers/users.ts
git commit -m "feat: add isAdmin checkbox and user list to RegisterPage"
```
