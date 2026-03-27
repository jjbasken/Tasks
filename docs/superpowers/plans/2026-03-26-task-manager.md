# E2E Encrypted Task Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-hosted, end-to-end encrypted task manager with multi-user accounts, shared lists, and recurring tasks.

**Architecture:** pnpm monorepo — React+Vite frontend, Bun+Hono backend, shared TypeScript package for crypto and types. All task content is encrypted client-side with libsodium before reaching the server. tRPC provides type-safe API communication across the stack.

**Tech Stack:** React 19, Vite, TypeScript, tRPC v11, TanStack Query v5, React Router v7, libsodium-wrappers, rrule.js (frontend) / Bun, Hono, Drizzle ORM, SQLite (bun:sqlite), jose (backend) / pnpm workspaces

---

## File Map

```
tasks/
  package.json                          # pnpm workspace root
  tsconfig.base.json                    # shared TS config

  packages/shared/
    package.json
    tsconfig.json
    src/
      types.ts                          # TaskPayload, EncryptedBlob, shared types
      crypto.ts                         # libsodium wrappers: keygen, encrypt, decrypt
      rrule-helpers.ts                  # rrule.js: parse, generate, next occurrence
      index.ts                          # re-exports
    tests/
      crypto.test.ts
      rrule-helpers.test.ts

  apps/backend/
    package.json
    tsconfig.json
    src/
      index.ts                          # Hono app: CORS, tRPC mount, health check
      context.ts                        # tRPC context type + createContext fn
      router.ts                         # root tRPC router
      lib/
        jwt.ts                          # signToken, verifyToken (jose)
      db/
        schema.ts                       # Drizzle table definitions
        index.ts                        # SQLite connection + drizzle instance
        migrate.ts                      # run migrations on startup
      routers/
        auth.ts                         # getLoginChallenge, register, login, logout
        tasks.ts                        # list, create, update, delete
        lists.ts                        # list, create, invite, removeMember
        devices.ts                      # requestApproval, listPending, approve, checkApproval, revoke, list
        users.ts                        # search
    tests/
      helpers.ts                        # makeTestDb(), makeTestContext()
      auth.test.ts
      tasks.test.ts
      lists.test.ts
      devices.test.ts

  apps/frontend/
    package.json
    tsconfig.json
    vite.config.ts
    index.html
    src/
      main.tsx
      App.tsx
      lib/
        trpc.ts                         # tRPC client + httpBatchLink
        queryClient.ts                  # TanStack QueryClient instance
        session.ts                      # sessionStorage: store/load/clear key material
      hooks/
        useAuth.tsx                     # AuthContext, AuthProvider, useAuth
        useTasks.ts                     # useTaskList, useCreateTask, useUpdateTask, useDeleteTask
        useLists.ts                     # useListsList, useCreateList, useInvite
        useDevices.ts                   # useDeviceList, usePendingDevices, useApproveDevice
      routes/
        LoginPage.tsx
        RegisterPage.tsx
        TasksPage.tsx
        ListsPage.tsx
        DevicesPage.tsx
        SettingsPage.tsx
      components/
        Sidebar.tsx                     # list switcher + nav
        TaskList.tsx                    # renders TaskRow list for a bucket
        TaskRow.tsx                     # single task row: toggle, title, recurrence badge
        TaskDetail.tsx                  # slide-in panel: edit title/notes/bucket/rrule
        RecurrencePicker.tsx            # rrule builder UI
        ProtectedRoute.tsx              # redirect to /login if no session

  docker-compose.yml
  apps/frontend/Dockerfile
  apps/backend/Dockerfile
```

---

## Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `apps/backend/package.json`
- Create: `apps/backend/tsconfig.json`
- Create: `apps/frontend/package.json`
- Create: `apps/frontend/tsconfig.json`

- [ ] **Step 1: Create workspace root**

```json
// package.json
{
  "name": "tasks-monorepo",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev:backend": "pnpm --filter backend dev",
    "dev:frontend": "pnpm --filter frontend dev",
    "test": "pnpm --filter shared test && pnpm --filter backend test"
  }
}
```

- [ ] **Step 2: Shared TS base config**

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  }
}
```

- [ ] **Step 3: Shared package scaffold**

```json
// packages/shared/package.json
{
  "name": "@tasks/shared",
  "version": "0.0.1",
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "test": "bun test"
  },
  "dependencies": {
    "libsodium-wrappers": "^0.7.15",
    "rrule": "^2.8.1"
  },
  "devDependencies": {
    "@types/libsodium-wrappers": "^0.7.14",
    "typescript": "^5.5.0"
  }
}
```

```json
// packages/shared/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "./dist" },
  "include": ["src", "tests"]
}
```

- [ ] **Step 4: Backend package scaffold**

```json
// apps/backend/package.json
{
  "name": "backend",
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "start": "bun run src/index.ts",
    "test": "bun test"
  },
  "dependencies": {
    "@tasks/shared": "workspace:*",
    "@trpc/server": "^11.0.0",
    "drizzle-orm": "^0.38.0",
    "hono": "^4.6.0",
    "jose": "^5.9.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "drizzle-kit": "^0.29.0",
    "typescript": "^5.5.0"
  }
}
```

```json
// apps/backend/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "./dist" },
  "include": ["src", "tests"]
}
```

- [ ] **Step 5: Frontend package scaffold**

```json
// apps/frontend/package.json
{
  "name": "frontend",
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@tasks/shared": "workspace:*",
    "@tanstack/react-query": "^5.56.0",
    "@trpc/client": "^11.0.0",
    "@trpc/react-query": "^11.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router": "^7.0.0",
    "rrule": "^2.8.1"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0"
  }
}
```

```json
// apps/frontend/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["src"]
}
```

- [ ] **Step 6: Install dependencies**

Run: `pnpm install`
Expected: lockfile created, node_modules symlinked across workspace packages

- [ ] **Step 7: Commit**

```bash
git init
git add .
git commit -m "feat: monorepo scaffold with pnpm workspaces"
```

---

## Task 2: Shared types

**Files:**
- Create: `packages/shared/src/types.ts`
- Create: `packages/shared/src/index.ts`

- [ ] **Step 1: Write types**

```typescript
// packages/shared/src/types.ts

export type TaskPayload = {
  title: string
  notes: string | null
  bucket: 'now' | 'later'
  status: 'active' | 'done'
  rrule: string | null        // iCal RRULE string e.g. "FREQ=WEEKLY;BYDAY=MO,WE"
  due_date: string | null     // ISO date string
  completed_at: string | null // ISO date string
}

// Serialised form of an encrypted symmetric secretbox
export type EncryptedBlob = {
  ciphertext: string  // base64
  nonce: string       // base64
}

export type UserPublicInfo = {
  userId: string
  username: string
  publicKey: string  // base64 curve25519
}
```

- [ ] **Step 2: Write index re-exports**

```typescript
// packages/shared/src/index.ts
export * from './types.js'
export * from './crypto.js'
export * from './rrule-helpers.js'
```

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/index.ts
git commit -m "feat(shared): add shared types"
```

---

## Task 3: Crypto utilities

**Files:**
- Create: `packages/shared/src/crypto.ts`
- Create: `packages/shared/tests/crypto.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/shared/tests/crypto.test.ts
import { describe, it, expect, beforeAll } from 'bun:test'
import {
  initCrypto,
  generateKdfSalt,
  deriveStretchKey,
  generateKeypair,
  generateListKey,
  encryptSymmetric,
  decryptSymmetric,
  sealToPublicKey,
  openSeal,
  toBase64,
  fromBase64,
} from '../src/crypto.js'

beforeAll(async () => { await initCrypto() })

describe('generateKdfSalt', () => {
  it('returns a base64 string of correct byte length (32 bytes)', () => {
    const salt = generateKdfSalt()
    expect(fromBase64(salt).length).toBe(32)
  })
  it('returns a different value each call', () => {
    expect(generateKdfSalt()).not.toBe(generateKdfSalt())
  })
})

describe('deriveStretchKey', () => {
  it('returns 32 bytes', async () => {
    const salt = generateKdfSalt()
    const key = await deriveStretchKey('my-passphrase', salt)
    expect(key.length).toBe(32)
  })
  it('is deterministic for same passphrase + salt', async () => {
    const salt = generateKdfSalt()
    const a = await deriveStretchKey('pass', salt)
    const b = await deriveStretchKey('pass', salt)
    expect(toBase64(a)).toBe(toBase64(b))
  })
  it('differs for different passphrases', async () => {
    const salt = generateKdfSalt()
    const a = await deriveStretchKey('pass1', salt)
    const b = await deriveStretchKey('pass2', salt)
    expect(toBase64(a)).not.toBe(toBase64(b))
  })
})

describe('encryptSymmetric / decryptSymmetric', () => {
  it('round-trips plaintext', async () => {
    const salt = generateKdfSalt()
    const key = await deriveStretchKey('pass', salt)
    const blob = encryptSymmetric('hello world', key)
    expect(decryptSymmetric(blob, key)).toBe('hello world')
  })
  it('produces different ciphertexts each call (random nonce)', async () => {
    const salt = generateKdfSalt()
    const key = await deriveStretchKey('pass', salt)
    const a = encryptSymmetric('hello', key)
    const b = encryptSymmetric('hello', key)
    expect(a.ciphertext).not.toBe(b.ciphertext)
  })
})

describe('sealToPublicKey / openSeal', () => {
  it('round-trips a Uint8Array', () => {
    const kp = generateKeypair()
    const data = new TextEncoder().encode('secret key material')
    const sealed = sealToPublicKey(data, kp.publicKey)
    const opened = openSeal(sealed, kp.publicKey, kp.privateKey)
    expect(new TextDecoder().decode(opened)).toBe('secret key material')
  })
})

describe('generateListKey', () => {
  it('returns 32 bytes as base64', () => {
    const key = generateListKey()
    expect(fromBase64(key).length).toBe(32)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `cd packages/shared && bun test`
Expected: error — module not found for `../src/crypto.js`

- [ ] **Step 3: Implement crypto.ts**

```typescript
// packages/shared/src/crypto.ts
import sodium from 'libsodium-wrappers'
import type { EncryptedBlob } from './types.js'

export async function initCrypto(): Promise<void> {
  await sodium.ready
}

export function toBase64(bytes: Uint8Array): string {
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL)
}

export function fromBase64(b64: string): Uint8Array {
  return sodium.from_base64(b64, sodium.base64_variants.ORIGINAL)
}

/** Generate a random Argon2id KDF salt (32 bytes), returned as base64. */
export function generateKdfSalt(): string {
  return toBase64(sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES))
}

/**
 * Derive a 32-byte stretch key from a passphrase + base64 salt using Argon2id.
 * The result is NEVER sent to the server — used only to wrap/unwrap local keys.
 */
export async function deriveStretchKey(passphrase: string, saltB64: string): Promise<Uint8Array> {
  await sodium.ready
  return sodium.crypto_pwhash(
    32,
    passphrase,
    fromBase64(saltB64),
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  )
}

/** Generate a curve25519 keypair. Returns base64 strings for storage. */
export function generateKeypair(): { publicKey: string; privateKey: string } {
  const kp = sodium.crypto_box_keypair()
  return { publicKey: toBase64(kp.publicKey), privateKey: toBase64(kp.privateKey) }
}

/** Generate a random 32-byte symmetric list key, returned as base64. */
export function generateListKey(): string {
  return toBase64(sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES))
}

/** Encrypt a UTF-8 string with XChaCha20-Poly1305 (libsodium SecretBox). */
export function encryptSymmetric(plaintext: string, key: Uint8Array): EncryptedBlob {
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
  const ciphertext = sodium.crypto_secretbox_easy(sodium.from_string(plaintext), nonce, key)
  return { ciphertext: toBase64(ciphertext), nonce: toBase64(nonce) }
}

/** Decrypt a SecretBox-encrypted blob. Throws if authentication fails. */
export function decryptSymmetric(blob: EncryptedBlob, key: Uint8Array): string {
  const plaintext = sodium.crypto_secretbox_open_easy(
    fromBase64(blob.ciphertext),
    fromBase64(blob.nonce),
    key,
  )
  return sodium.to_string(plaintext)
}

/**
 * Seal data to a recipient's curve25519 public key (no sender identity).
 * Used to transfer key material to a new device.
 */
export function sealToPublicKey(data: Uint8Array, recipientPublicKeyB64: string): string {
  return toBase64(sodium.crypto_box_seal(data, fromBase64(recipientPublicKeyB64)))
}

/** Open a sealed box using the recipient's keypair. */
export function openSeal(
  ciphertextB64: string,
  publicKeyB64: string,
  privateKeyB64: string,
): Uint8Array {
  return sodium.crypto_box_seal_open(
    fromBase64(ciphertextB64),
    fromBase64(publicKeyB64),
    fromBase64(privateKeyB64),
  )
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `cd packages/shared && bun test`
Expected: all 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/crypto.ts packages/shared/tests/crypto.test.ts
git commit -m "feat(shared): crypto utilities with Argon2id + libsodium"
```

---

## Task 4: rrule helpers

**Files:**
- Create: `packages/shared/src/rrule-helpers.ts`
- Create: `packages/shared/tests/rrule-helpers.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/shared/tests/rrule-helpers.test.ts
import { describe, it, expect } from 'bun:test'
import { nextOccurrence, describeRrule } from '../src/rrule-helpers.js'

describe('nextOccurrence', () => {
  it('returns the next weekly occurrence after the given date', () => {
    const rule = 'FREQ=WEEKLY;BYDAY=MO'
    // 2026-03-26 is a Thursday — next Monday is 2026-03-30
    const after = new Date('2026-03-26T00:00:00Z')
    const next = nextOccurrence(rule, after)
    expect(next?.toISOString().startsWith('2026-03-30')).toBe(true)
  })
  it('returns the next daily occurrence', () => {
    const rule = 'FREQ=DAILY'
    const after = new Date('2026-03-26T12:00:00Z')
    const next = nextOccurrence(rule, after)
    expect(next?.toISOString().startsWith('2026-03-27')).toBe(true)
  })
  it('returns null for an invalid rule', () => {
    expect(nextOccurrence('NOTARRULE', new Date())).toBeNull()
  })
})

describe('describeRrule', () => {
  it('describes a weekly rule', () => {
    expect(describeRrule('FREQ=WEEKLY;BYDAY=MO,WE')).toMatch(/week/i)
  })
  it('returns null for invalid input', () => {
    expect(describeRrule('')).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests — confirm fail**

Run: `cd packages/shared && bun test tests/rrule-helpers.test.ts`
Expected: module not found

- [ ] **Step 3: Implement rrule-helpers.ts**

```typescript
// packages/shared/src/rrule-helpers.ts
import { RRule } from 'rrule'

/**
 * Given an RRULE string and a reference date, return the next occurrence after that date.
 * Returns null if the rule is invalid or has no future occurrences.
 */
export function nextOccurrence(rruleStr: string, after: Date): Date | null {
  try {
    const rule = RRule.fromString(rruleStr)
    return rule.after(after, false)
  } catch {
    return null
  }
}

/**
 * Return a human-readable description of an RRULE string (e.g. "every week on Monday").
 * Returns null for empty or invalid input.
 */
export function describeRrule(rruleStr: string): string | null {
  if (!rruleStr) return null
  try {
    const rule = RRule.fromString(rruleStr)
    return rule.toText()
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `cd packages/shared && bun test`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/rrule-helpers.ts packages/shared/tests/rrule-helpers.test.ts
git commit -m "feat(shared): rrule helpers for recurrence"
```

---

## Task 5: Backend DB schema

**Files:**
- Create: `apps/backend/src/db/schema.ts`
- Create: `apps/backend/src/db/index.ts`
- Create: `apps/backend/src/db/migrate.ts`

- [ ] **Step 1: Write schema**

```typescript
// apps/backend/src/db/schema.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  publicKey: text('public_key').notNull(),
  kdfSalt: text('kdf_salt').notNull(),
  encryptedPrivateKey: text('encrypted_private_key').notNull(),  // JSON EncryptedBlob
  encryptedPersonalListKey: text('encrypted_personal_list_key').notNull(), // JSON EncryptedBlob
  createdAt: integer('created_at').notNull(),
})

export const lists = sqliteTable('lists', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull().references(() => users.id),
  encryptedName: text('encrypted_name').notNull(),  // JSON EncryptedBlob
  isShared: integer('is_shared', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
})

export const listMemberships = sqliteTable('list_memberships', {
  id: text('id').primaryKey(),
  listId: text('list_id').notNull().references(() => lists.id),
  userId: text('user_id').notNull().references(() => users.id),
  encryptedListKey: text('encrypted_list_key').notNull(), // list key sealed to this user's public key
  invitedBy: text('invited_by').references(() => users.id),
  createdAt: integer('created_at').notNull(),
})

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  listId: text('list_id').notNull().references(() => lists.id),
  encryptedPayload: text('encrypted_payload').notNull(), // JSON EncryptedBlob
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const devices = sqliteTable('devices', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  publicKey: text('public_key').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull().default('pending'), // 'pending' | 'approved' | 'revoked'
  sealedUserPrivateKey: text('sealed_user_private_key'),  // set on approval
  pendingToken: text('pending_token'),                    // temporary token for new device polling
  approvedBy: text('approved_by'),
  createdAt: integer('created_at').notNull(),
  approvedAt: integer('approved_at'),
})
```

- [ ] **Step 2: Write DB connection**

```typescript
// apps/backend/src/db/index.ts
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as schema from './schema.js'

export function createDb(url: string) {
  const sqlite = new Database(url)
  sqlite.run('PRAGMA journal_mode = WAL')
  sqlite.run('PRAGMA foreign_keys = ON')
  return drizzle(sqlite, { schema })
}

export type Db = ReturnType<typeof createDb>

// Singleton for production use
export const db = createDb(process.env.DATABASE_URL ?? ':memory:')
```

- [ ] **Step 3: Write migrate.ts**

```typescript
// apps/backend/src/db/migrate.ts
import type { Db } from './index.js'

/** Create all tables if they don't exist. Simple inline migration — no migration files needed. */
export function migrate(db: Db) {
  const sqlite = (db as any).session.client as import('bun:sqlite').Database
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      public_key TEXT NOT NULL,
      kdf_salt TEXT NOT NULL,
      encrypted_private_key TEXT NOT NULL,
      encrypted_personal_list_key TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS lists (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id),
      encrypted_name TEXT NOT NULL,
      is_shared INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS list_memberships (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL REFERENCES lists(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      encrypted_list_key TEXT NOT NULL,
      invited_by TEXT REFERENCES users(id),
      created_at INTEGER NOT NULL
    )
  `)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL REFERENCES lists(id),
      encrypted_payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      public_key TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      sealed_user_private_key TEXT,
      pending_token TEXT,
      approved_by TEXT,
      created_at INTEGER NOT NULL,
      approved_at INTEGER
    )
  `)
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/db/
git commit -m "feat(backend): DB schema with Drizzle + SQLite"
```

---

## Task 6: Backend JWT + context

**Files:**
- Create: `apps/backend/src/lib/jwt.ts`
- Create: `apps/backend/src/context.ts`
- Create: `apps/backend/tests/helpers.ts`

- [ ] **Step 1: Write JWT helpers**

```typescript
// apps/backend/src/lib/jwt.ts
import { SignJWT, jwtVerify } from 'jose'

function getSecret() {
  const s = process.env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET env var not set')
  return new TextEncoder().encode(s)
}

export async function signToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(getSecret())
}

export async function verifyToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret())
    return payload.sub ?? null
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Write tRPC context**

```typescript
// apps/backend/src/context.ts
import type { Context as HonoContext } from 'hono'
import { verifyToken } from './lib/jwt.js'
import { db as defaultDb, type Db } from './db/index.js'

export type AppContext = {
  db: Db
  userId: string | null
}

export async function createContext(c: HonoContext, dbOverride?: Db): Promise<AppContext> {
  const db = dbOverride ?? defaultDb
  const auth = c.req.header('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  const userId = token ? await verifyToken(token) : null
  return { db, userId }
}
```

- [ ] **Step 3: Write test helpers**

```typescript
// apps/backend/tests/helpers.ts
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
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
```

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/lib/jwt.ts apps/backend/src/context.ts apps/backend/tests/helpers.ts
git commit -m "feat(backend): JWT helpers + tRPC context"
```

---

## Task 7: Backend auth router

**Files:**
- Create: `apps/backend/src/router.ts`
- Create: `apps/backend/src/routers/auth.ts`
- Create: `apps/backend/tests/auth.test.ts`

- [ ] **Step 1: Write failing auth tests**

```typescript
// apps/backend/tests/auth.test.ts
import { describe, it, expect, beforeEach } from 'bun:test'
import { createCallerFactory } from '@trpc/server'
import { appRouter } from '../src/router.js'
import { makeCtx } from './helpers.js'

const createCaller = createCallerFactory(appRouter)

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
```

- [ ] **Step 2: Run tests — confirm fail**

Run: `cd apps/backend && bun test tests/auth.test.ts`
Expected: error — module not found for `../src/router.js`

- [ ] **Step 3: Write root router**

```typescript
// apps/backend/src/router.ts
import { initTRPC, TRPCError } from '@trpc/server'
import type { AppContext } from './context.js'
import { authRouter } from './routers/auth.js'
import { tasksRouter } from './routers/tasks.js'
import { listsRouter } from './routers/lists.js'
import { devicesRouter } from './routers/devices.js'
import { usersRouter } from './routers/users.js'

const t = initTRPC.context<AppContext>().create()

export const router = t.router
export const publicProcedure = t.procedure
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: 'UNAUTHORIZED' })
  return next({ ctx: { ...ctx, userId: ctx.userId } })
})

export const appRouter = router({
  auth: authRouter,
  tasks: tasksRouter,
  lists: listsRouter,
  devices: devicesRouter,
  users: usersRouter,
})

export type AppRouter = typeof appRouter
```

- [ ] **Step 4: Write auth router**

```typescript
// apps/backend/src/routers/auth.ts
import { TRPCError } from '@trpc/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { router, publicProcedure, protectedProcedure } from '../router.js'
import { users, lists, listMemberships } from '../db/schema.js'
import { signToken } from '../lib/jwt.js'

export const authRouter = router({
  getLoginChallenge: publicProcedure
    .input(z.object({ username: z.string() }))
    .query(async ({ ctx, input }) => {
      const [user] = await ctx.db.select().from(users).where(eq(users.username, input.username))
      if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' })
      return {
        kdfSalt: user.kdfSalt,
        encryptedPrivateKey: user.encryptedPrivateKey,
        encryptedPersonalListKey: user.encryptedPersonalListKey,
      }
    }),

  register: publicProcedure
    .input(z.object({
      username: z.string().min(2).max(40),
      email: z.string().email(),
      passwordHash: z.string(),
      publicKey: z.string(),
      kdfSalt: z.string(),
      encryptedPrivateKey: z.string(),
      encryptedPersonalListKey: z.string(),
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
        createdAt: now,
      })
      // Create the user's personal list + membership so lists.list() returns it immediately
      const listId = randomUUID()
      await ctx.db.insert(lists).values({ id: listId, ownerId: userId, encryptedName: '"Personal"', isShared: false, createdAt: now })
      await ctx.db.insert(listMemberships).values({ id: randomUUID(), listId, userId, encryptedListKey: input.encryptedPersonalListKey, invitedBy: null, createdAt: now })
      return { userId }
    }),

  login: publicProcedure
    .input(z.object({ username: z.string(), passwordHash: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [user] = await ctx.db.select().from(users).where(eq(users.username, input.username))
      if (!user) throw new TRPCError({ code: 'UNAUTHORIZED' })
      const valid = await Bun.password.verify(input.passwordHash, user.passwordHash)
      if (!valid) throw new TRPCError({ code: 'UNAUTHORIZED' })
      const token = await signToken(user.id)
      return { token }
    }),

  // NOTE: register also creates the user's personal list + membership so lists.list() works immediately after login

  logout: protectedProcedure.mutation(() => {
    // JWT is stateless — client discards token. Server-side revocation out of scope.
    return { ok: true }
  }),
})
```

- [ ] **Step 5: Add stub routers so root router compiles**

```typescript
// apps/backend/src/routers/tasks.ts
import { router } from '../router.js'
export const tasksRouter = router({})

// apps/backend/src/routers/lists.ts
import { router } from '../router.js'
export const listsRouter = router({})

// apps/backend/src/routers/devices.ts
import { router } from '../router.js'
export const devicesRouter = router({})

// apps/backend/src/routers/users.ts
import { router } from '../router.js'
export const usersRouter = router({})
```

- [ ] **Step 6: Run auth tests — expect pass**

Run: `cd apps/backend && bun test tests/auth.test.ts`
Expected: all 6 tests PASS

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/router.ts apps/backend/src/routers/
git commit -m "feat(backend): auth router (register, login, challenge)"
```

---

## Task 8: Backend tasks router

**Files:**
- Modify: `apps/backend/src/routers/tasks.ts`
- Create: `apps/backend/tests/tasks.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/backend/tests/tasks.test.ts
import { describe, it, expect, beforeEach } from 'bun:test'
import { createCallerFactory } from '@trpc/server'
import { randomUUID } from 'crypto'
import { appRouter } from '../src/router.js'
import { makeTestDb } from './helpers.js'
import { users, lists, listMemberships } from '../src/db/schema.js'

const createCaller = createCallerFactory(appRouter)

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
    const tasks = await caller.tasks.list({ listId })
    expect(tasks).toHaveLength(1)
    expect(tasks[0].encryptedPayload).toBe('{"ciphertext":"c","nonce":"n"}')
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
```

- [ ] **Step 2: Run tests — confirm fail**

Run: `cd apps/backend && bun test tests/tasks.test.ts`
Expected: FAIL — procedures missing on tasksRouter stub

- [ ] **Step 3: Implement tasks router**

```typescript
// apps/backend/src/routers/tasks.ts
import { TRPCError } from '@trpc/server'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { router, protectedProcedure } from '../router.js'
import { tasks, listMemberships } from '../db/schema.js'

async function assertListAccess(db: any, listId: string, userId: string) {
  const [membership] = await db
    .select()
    .from(listMemberships)
    .where(and(eq(listMemberships.listId, listId), eq(listMemberships.userId, userId)))
  if (!membership) throw new TRPCError({ code: 'FORBIDDEN' })
}

export const tasksRouter = router({
  list: protectedProcedure
    .input(z.object({ listId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertListAccess(ctx.db, input.listId, ctx.userId)
      return ctx.db.select().from(tasks).where(eq(tasks.listId, input.listId))
    }),

  create: protectedProcedure
    .input(z.object({ listId: z.string(), encryptedPayload: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertListAccess(ctx.db, input.listId, ctx.userId)
      const id = randomUUID()
      const now = Date.now()
      await ctx.db.insert(tasks).values({ id, listId: input.listId, encryptedPayload: input.encryptedPayload, createdAt: now, updatedAt: now })
      return { id }
    }),

  update: protectedProcedure
    .input(z.object({ taskId: z.string(), encryptedPayload: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [task] = await ctx.db.select().from(tasks).where(eq(tasks.id, input.taskId))
      if (!task) throw new TRPCError({ code: 'NOT_FOUND' })
      await assertListAccess(ctx.db, task.listId, ctx.userId)
      await ctx.db.update(tasks).set({ encryptedPayload: input.encryptedPayload, updatedAt: Date.now() }).where(eq(tasks.id, input.taskId))
    }),

  delete: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [task] = await ctx.db.select().from(tasks).where(eq(tasks.id, input.taskId))
      if (!task) throw new TRPCError({ code: 'NOT_FOUND' })
      await assertListAccess(ctx.db, task.listId, ctx.userId)
      await ctx.db.delete(tasks).where(eq(tasks.id, input.taskId))
    }),
})
```

- [ ] **Step 4: Run tests — expect pass**

Run: `cd apps/backend && bun test tests/tasks.test.ts`
Expected: all 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/routers/tasks.ts apps/backend/tests/tasks.test.ts
git commit -m "feat(backend): tasks router with list-membership auth guard"
```

---

## Task 9: Backend lists router

**Files:**
- Modify: `apps/backend/src/routers/lists.ts`
- Create: `apps/backend/tests/lists.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/backend/tests/lists.test.ts
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
    const list = (await (async () => {
      await caller.lists.create({ encryptedName: '{}', encryptedListKey: 'alice-key' })
      return (await caller.lists.list())[0]
    })())
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
```

- [ ] **Step 2: Run tests — confirm fail**

Run: `cd apps/backend && bun test tests/lists.test.ts`
Expected: FAIL — procedures missing

- [ ] **Step 3: Implement lists router**

```typescript
// apps/backend/src/routers/lists.ts
import { TRPCError } from '@trpc/server'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { router, protectedProcedure } from '../router.js'
import { lists, listMemberships, users } from '../db/schema.js'

export const listsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const memberships = await ctx.db
      .select({ list: lists, encryptedListKey: listMemberships.encryptedListKey })
      .from(listMemberships)
      .innerJoin(lists, eq(listMemberships.listId, lists.id))
      .where(eq(listMemberships.userId, ctx.userId))
    return memberships.map(m => ({
      id: m.list.id,
      encryptedName: m.list.encryptedName,
      isShared: m.list.isShared,
      encryptedListKey: m.encryptedListKey,
    }))
  }),

  create: protectedProcedure
    .input(z.object({ encryptedName: z.string(), encryptedListKey: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const listId = randomUUID()
      const now = Date.now()
      await ctx.db.insert(lists).values({ id: listId, ownerId: ctx.userId, encryptedName: input.encryptedName, isShared: false, createdAt: now })
      await ctx.db.insert(listMemberships).values({ id: randomUUID(), listId, userId: ctx.userId, encryptedListKey: input.encryptedListKey, invitedBy: null, createdAt: now })
      return { id: listId }
    }),

  invite: protectedProcedure
    .input(z.object({ listId: z.string(), inviteeUsername: z.string(), encryptedListKey: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Verify caller is a member
      const [membership] = await ctx.db.select().from(listMemberships).where(and(eq(listMemberships.listId, input.listId), eq(listMemberships.userId, ctx.userId)))
      if (!membership) throw new TRPCError({ code: 'FORBIDDEN' })
      const [invitee] = await ctx.db.select().from(users).where(eq(users.username, input.inviteeUsername))
      if (!invitee) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' })
      await ctx.db.insert(listMemberships).values({ id: randomUUID(), listId: input.listId, userId: invitee.id, encryptedListKey: input.encryptedListKey, invitedBy: ctx.userId, createdAt: Date.now() })
      // Mark list as shared
      await ctx.db.update(lists).set({ isShared: true }).where(eq(lists.id, input.listId))
    }),

  removeMember: protectedProcedure
    .input(z.object({ listId: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Only list owner can remove members
      const [list] = await ctx.db.select().from(lists).where(eq(lists.id, input.listId))
      if (!list || list.ownerId !== ctx.userId) throw new TRPCError({ code: 'FORBIDDEN' })
      await ctx.db.delete(listMemberships).where(and(eq(listMemberships.listId, input.listId), eq(listMemberships.userId, input.userId)))
    }),
})
```

- [ ] **Step 4: Run tests — expect pass**

Run: `cd apps/backend && bun test tests/lists.test.ts`
Expected: all 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/routers/lists.ts apps/backend/tests/lists.test.ts
git commit -m "feat(backend): lists router with invite + membership"
```

---

## Task 10: Backend devices + users routers + server entry

**Files:**
- Modify: `apps/backend/src/routers/devices.ts`
- Modify: `apps/backend/src/routers/users.ts`
- Create: `apps/backend/src/index.ts`
- Create: `apps/backend/tests/devices.test.ts`

- [ ] **Step 1: Write failing device tests**

```typescript
// apps/backend/tests/devices.test.ts
import { describe, it, expect } from 'bun:test'
import { createCallerFactory } from '@trpc/server'
import { randomUUID } from 'crypto'
import { appRouter } from '../src/router.js'
import { makeTestDb } from './helpers.js'
import { users } from '../src/db/schema.js'

const createCaller = createCallerFactory(appRouter)

async function seedUser(db: ReturnType<typeof makeTestDb>) {
  const userId = randomUUID()
  await db.insert(users).values({ id: userId, username: 'u', email: 'u@u.com', passwordHash: 'h', publicKey: 'pk', kdfSalt: 's', encryptedPrivateKey: '{}', encryptedPersonalListKey: '{}', createdAt: Date.now() })
  return userId
}

describe('devices.requestApproval', () => {
  it('creates a pending device and returns pendingToken', async () => {
    const db = makeTestDb()
    const ctx = { db, userId: null as null | string }
    const caller = createCaller(ctx)
    const result = await caller.devices.requestApproval({ username: 'u', name: 'iPhone', devicePublicKey: 'devpk' })
    expect(result.deviceId).toBeString()
    expect(result.pendingToken).toBeString()
  })
})

describe('devices.listPending + approve + checkApproval', () => {
  it('full device approval flow', async () => {
    const db = makeTestDb()
    const userId = await seedUser(db)

    // New device requests approval
    const anonCaller = createCaller({ db, userId: null })
    const { deviceId, pendingToken } = await anonCaller.devices.requestApproval({ username: 'u', name: 'iPad', devicePublicKey: 'devpk2' })

    // Existing device (userId) sees pending
    const authedCaller = createCaller({ db, userId })
    const pending = await authedCaller.devices.listPending()
    expect(pending).toHaveLength(1)
    expect(pending[0].id).toBe(deviceId)

    // Existing device approves
    await authedCaller.devices.approve({ deviceId, sealedUserPrivateKey: 'sealed-key' })

    // New device polls — gets token + sealed key
    const approval = await anonCaller.devices.checkApproval({ deviceId, pendingToken })
    expect(approval?.sealedUserPrivateKey).toBe('sealed-key')
    expect(approval?.token).toBeString()
  })
})
```

- [ ] **Step 2: Run tests — confirm fail**

Run: `cd apps/backend && bun test tests/devices.test.ts`

- [ ] **Step 3: Implement devices router**

```typescript
// apps/backend/src/routers/devices.ts
import { TRPCError } from '@trpc/server'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { router, publicProcedure, protectedProcedure } from '../router.js'
import { devices, users } from '../db/schema.js'
import { signToken } from '../lib/jwt.js'

export const devicesRouter = router({
  requestApproval: publicProcedure
    .input(z.object({ username: z.string(), name: z.string(), devicePublicKey: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [user] = await ctx.db.select().from(users).where(eq(users.username, input.username))
      if (!user) throw new TRPCError({ code: 'NOT_FOUND' })
      const id = randomUUID()
      const pendingToken = randomUUID()
      await ctx.db.insert(devices).values({ id, userId: user.id, publicKey: input.devicePublicKey, name: input.name, status: 'pending', pendingToken, createdAt: Date.now() })
      return { deviceId: id, pendingToken }
    }),

  listPending: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.select({ id: devices.id, name: devices.name, publicKey: devices.publicKey, createdAt: devices.createdAt })
      .from(devices)
      .where(and(eq(devices.userId, ctx.userId), eq(devices.status, 'pending')))
  }),

  approve: protectedProcedure
    .input(z.object({ deviceId: z.string(), sealedUserPrivateKey: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [device] = await ctx.db.select().from(devices).where(and(eq(devices.id, input.deviceId), eq(devices.userId, ctx.userId)))
      if (!device) throw new TRPCError({ code: 'NOT_FOUND' })
      await ctx.db.update(devices).set({ status: 'approved', sealedUserPrivateKey: input.sealedUserPrivateKey, approvedBy: ctx.userId, approvedAt: Date.now() }).where(eq(devices.id, input.deviceId))
    }),

  checkApproval: publicProcedure
    .input(z.object({ deviceId: z.string(), pendingToken: z.string() }))
    .query(async ({ ctx, input }) => {
      const [device] = await ctx.db.select().from(devices).where(and(eq(devices.id, input.deviceId), eq(devices.pendingToken, input.pendingToken)))
      if (!device || device.status !== 'approved' || !device.sealedUserPrivateKey) return null
      const token = await signToken(device.userId)
      return { token, sealedUserPrivateKey: device.sealedUserPrivateKey }
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.select({ id: devices.id, name: devices.name, approvedAt: devices.approvedAt })
      .from(devices)
      .where(and(eq(devices.userId, ctx.userId), eq(devices.status, 'approved')))
  }),

  revoke: protectedProcedure
    .input(z.object({ deviceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [device] = await ctx.db.select().from(devices).where(and(eq(devices.id, input.deviceId), eq(devices.userId, ctx.userId)))
      if (!device) throw new TRPCError({ code: 'NOT_FOUND' })
      await ctx.db.update(devices).set({ status: 'revoked' }).where(eq(devices.id, input.deviceId))
    }),
})
```

- [ ] **Step 4: Implement users router**

```typescript
// apps/backend/src/routers/users.ts
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { router, protectedProcedure } from '../router.js'
import { users } from '../db/schema.js'

export const usersRouter = router({
  search: protectedProcedure
    .input(z.object({ username: z.string() }))
    .query(async ({ ctx, input }) => {
      const [user] = await ctx.db.select({ userId: users.id, username: users.username, publicKey: users.publicKey }).from(users).where(eq(users.username, input.username))
      return user ?? null
    }),
})
```

- [ ] **Step 5: Write server entry**

```typescript
// apps/backend/src/index.ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { appRouter } from './router.js'
import { createContext } from './context.js'
import { db } from './db/index.js'
import { migrate } from './db/migrate.js'

migrate(db)

const app = new Hono()

app.use('/api/*', cors({ origin: process.env.CORS_ORIGIN ?? '*', credentials: true }))

app.all('/api/trpc/*', c =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req: c.req.raw,
    router: appRouter,
    createContext: req => createContext(req as any),
  })
)

app.get('/health', c => c.json({ ok: true }))

export default { port: 3001, fetch: app.fetch }
```

- [ ] **Step 6: Run all backend tests**

Run: `cd apps/backend && bun test`
Expected: all tests PASS

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/ apps/backend/tests/
git commit -m "feat(backend): devices + users routers, Hono server entry"
```

---

## Task 11: Frontend scaffold

**Files:**
- Create: `apps/frontend/index.html`
- Create: `apps/frontend/vite.config.ts`
- Create: `apps/frontend/src/main.tsx`
- Create: `apps/frontend/src/App.tsx`
- Create: `apps/frontend/src/lib/trpc.ts`
- Create: `apps/frontend/src/lib/queryClient.ts`
- Create: `apps/frontend/src/lib/session.ts`

- [ ] **Step 1: Create index.html**

```html
<!-- apps/frontend/index.html -->
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Tasks</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Create vite.config.ts**

```typescript
// apps/frontend/vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
})
```

- [ ] **Step 3: Create tRPC client**

```typescript
// apps/frontend/src/lib/trpc.ts
import { createTRPCReact } from '@trpc/react-query'
import { httpBatchLink } from '@trpc/client'
import type { AppRouter } from '../../../apps/backend/src/router.js'

export const trpc = createTRPCReact<AppRouter>()

export function createTrpcClient(getToken: () => string | null) {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: '/api/trpc',
        headers: () => {
          const token = getToken()
          return token ? { authorization: `Bearer ${token}` } : {}
        },
      }),
    ],
  })
}
```

- [ ] **Step 4: Create QueryClient**

```typescript
// apps/frontend/src/lib/queryClient.ts
import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
})
```

- [ ] **Step 5: Create session storage helpers**

```typescript
// apps/frontend/src/lib/session.ts
// Key material lives in sessionStorage — cleared when the tab closes.

const KEYS = {
  token: 'tasks:token',
  stretchKey: 'tasks:stretchKey',   // base64 Uint8Array
  privateKey: 'tasks:privateKey',   // base64 curve25519 private key (from keypair)
  publicKey: 'tasks:publicKey',     // base64 curve25519 public key
} as const

export const session = {
  setToken: (t: string) => sessionStorage.setItem(KEYS.token, t),
  getToken: () => sessionStorage.getItem(KEYS.token),

  setStretchKey: (k: Uint8Array) => sessionStorage.setItem(KEYS.stretchKey, btoa(String.fromCharCode(...k))),
  getStretchKey: (): Uint8Array | null => {
    const v = sessionStorage.getItem(KEYS.stretchKey)
    if (!v) return null
    return Uint8Array.from(atob(v), c => c.charCodeAt(0))
  },

  setPrivateKey: (k: string) => sessionStorage.setItem(KEYS.privateKey, k),
  getPrivateKey: () => sessionStorage.getItem(KEYS.privateKey),

  setPublicKey: (k: string) => sessionStorage.setItem(KEYS.publicKey, k),
  getPublicKey: () => sessionStorage.getItem(KEYS.publicKey),

  clear: () => Object.values(KEYS).forEach(k => sessionStorage.removeItem(k)),
}
```

- [ ] **Step 6: Create App.tsx and main.tsx**

```typescript
// apps/frontend/src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { trpc, createTrpcClient } from './lib/trpc.js'
import { queryClient } from './lib/queryClient.js'
import { session } from './lib/session.js'
import { AuthProvider } from './hooks/useAuth.js'
import { ProtectedRoute } from './components/ProtectedRoute.js'
import { LoginPage } from './routes/LoginPage.js'
import { RegisterPage } from './routes/RegisterPage.js'
import { TasksPage } from './routes/TasksPage.js'
import { ListsPage } from './routes/ListsPage.js'
import { DevicesPage } from './routes/DevicesPage.js'
import { SettingsPage } from './routes/SettingsPage.js'

export function App() {
  const [trpcClient] = useState(() => createTrpcClient(() => session.getToken()))
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route element={<ProtectedRoute />}>
                <Route path="/tasks" element={<TasksPage />} />
                <Route path="/lists" element={<ListsPage />} />
                <Route path="/devices" element={<DevicesPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/tasks" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    </trpc.Provider>
  )
}
```

```typescript
// apps/frontend/src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>
)
```

- [ ] **Step 7: Create ProtectedRoute**

```typescript
// apps/frontend/src/components/ProtectedRoute.tsx
import { Navigate, Outlet } from 'react-router'
import { session } from '../lib/session.js'

export function ProtectedRoute() {
  return session.getToken() ? <Outlet /> : <Navigate to="/login" replace />
}
```

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/
git commit -m "feat(frontend): scaffold — Vite, React Router, tRPC client, session storage"
```

---

## Task 12: Auth context + hooks

**Files:**
- Create: `apps/frontend/src/hooks/useAuth.tsx`

- [ ] **Step 1: Create useAuth**

```typescript
// apps/frontend/src/hooks/useAuth.tsx
import { createContext, useContext, useState, type ReactNode } from 'react'
import { session } from '../lib/session.js'
import { trpc } from '../lib/trpc.js'
import {
  initCrypto, generateKdfSalt, deriveStretchKey, generateKeypair,
  generateListKey, encryptSymmetric, decryptSymmetric,
  type EncryptedBlob,
} from '@tasks/shared'

type AuthContextType = {
  isLoggedIn: boolean
  login: (username: string, passphrase: string) => Promise<void>
  register: (username: string, email: string, passphrase: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!session.getToken())
  const utils = trpc.useUtils()

  async function login(username: string, passphrase: string) {
    await initCrypto()
    const challenge = await utils.auth.getLoginChallenge.fetch({ username })
    const stretchKey = await deriveStretchKey(passphrase, challenge.kdfSalt)
    // Decrypt private key from encrypted_private_key stored on server
    const encPrivKey: EncryptedBlob = JSON.parse(challenge.encryptedPrivateKey)
    const privateKeyB64 = decryptSymmetric(encPrivKey, stretchKey)
    // Authenticate with server
    const result = await utils.auth.login.fetch({ username, passwordHash: passphrase })
    // Fetch public key to store in session (needed for sealed-box decryption of shared list keys)
    const userInfo = await utils.users.search.fetch({ username })
    session.setToken(result.token)
    session.setStretchKey(stretchKey)
    session.setPrivateKey(privateKeyB64)
    if (userInfo) session.setPublicKey(userInfo.publicKey)
    setIsLoggedIn(true)
  }

  async function register(username: string, email: string, passphrase: string) {
    await initCrypto()
    const kdfSalt = generateKdfSalt()
    const stretchKey = await deriveStretchKey(passphrase, kdfSalt)
    const { publicKey, privateKey } = generateKeypair()
    const listKey = generateListKey()
    const encPrivKey = encryptSymmetric(privateKey, stretchKey)
    // Personal list key stored symmetrically for login challenge + in list_memberships
    const encListKey = encryptSymmetric(listKey, stretchKey)
    await utils.auth.register.fetch({
      username, email,
      passwordHash: passphrase,
      publicKey,
      kdfSalt,
      encryptedPrivateKey: JSON.stringify(encPrivKey),
      encryptedPersonalListKey: JSON.stringify(encListKey),
    })
    await login(username, passphrase)
  }

  function logout() {
    session.clear()
    setIsLoggedIn(false)
  }

  return (
    <AuthContext.Provider value={{ isLoggedIn, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/hooks/useAuth.tsx
git commit -m "feat(frontend): auth context — login, register, key derivation"
```

---

## Task 13: Login + Register pages

**Files:**
- Create: `apps/frontend/src/routes/LoginPage.tsx`
- Create: `apps/frontend/src/routes/RegisterPage.tsx`

- [ ] **Step 1: Create LoginPage**

```typescript
// apps/frontend/src/routes/LoginPage.tsx
import { useState } from 'react'
import { useNavigate, Link } from 'react-router'
import { useAuth } from '../hooks/useAuth.js'

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(username, passphrase)
      navigate('/tasks')
    } catch (err: any) {
      setError(err?.message ?? 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 400, margin: '80px auto', padding: 24 }}>
      <h1>Tasks</h1>
      <form onSubmit={handleSubmit}>
        <div>
          <label>Username</label>
          <input value={username} onChange={e => setUsername(e.target.value)} required autoFocus />
        </div>
        <div>
          <label>Passphrase</label>
          <input type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)} required />
        </div>
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <button type="submit" disabled={loading}>{loading ? 'Unlocking…' : 'Login'}</button>
      </form>
      <p><Link to="/register">Create account</Link></p>
    </div>
  )
}
```

- [ ] **Step 2: Create RegisterPage**

```typescript
// apps/frontend/src/routes/RegisterPage.tsx
import { useState } from 'react'
import { useNavigate, Link } from 'react-router'
import { useAuth } from '../hooks/useAuth.js'

export function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (passphrase !== confirm) { setError('Passphrases do not match'); return }
    setError(null)
    setLoading(true)
    try {
      await register(username, email, passphrase)
      navigate('/tasks')
    } catch (err: any) {
      setError(err?.message ?? 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 400, margin: '80px auto', padding: 24 }}>
      <h1>Create Account</h1>
      <form onSubmit={handleSubmit}>
        <div><label>Username</label><input value={username} onChange={e => setUsername(e.target.value)} required autoFocus /></div>
        <div><label>Email</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></div>
        <div><label>Passphrase</label><input type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)} required /></div>
        <div><label>Confirm passphrase</label><input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required /></div>
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <button type="submit" disabled={loading}>{loading ? 'Creating…' : 'Create account'}</button>
      </form>
      <p><Link to="/login">Back to login</Link></p>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/routes/LoginPage.tsx apps/frontend/src/routes/RegisterPage.tsx
git commit -m "feat(frontend): login + register pages"
```

---

## Task 14: Task data hooks

**Files:**
- Create: `apps/frontend/src/hooks/useTasks.ts`
- Create: `apps/frontend/src/hooks/useLists.ts`

- [ ] **Step 1: Create useTasks**

```typescript
// apps/frontend/src/hooks/useTasks.ts
import { trpc } from '../lib/trpc.js'
import { encryptSymmetric, decryptSymmetric, fromBase64 } from '@tasks/shared'
import type { TaskPayload } from '@tasks/shared'

export type DecryptedTask = TaskPayload & { id: string; createdAt: number; updatedAt: number }

/** Returns decrypted tasks for a list. listKeyB64 is a base64 raw list key (already decrypted from membership). */
export function useTaskList(listId: string, listKeyB64: string | null) {
  return trpc.tasks.list.useQuery(
    { listId },
    {
      enabled: !!listId && !!listKeyB64,
      select: (rows) => {
        if (!listKeyB64) return []
        const key = fromBase64(listKeyB64)
        return rows.flatMap(row => {
          try {
            const blob = JSON.parse(row.encryptedPayload)
            const payload: TaskPayload = JSON.parse(decryptSymmetric(blob, key))
            return [{ id: row.id, createdAt: row.createdAt, updatedAt: row.updatedAt, ...payload }]
          } catch {
            return []  // skip rows that fail to decrypt (e.g. wrong key)
          }
        })
      },
    }
  )
}

/** Returns a function to create an encrypted task. Caller is responsible for providing the raw list key. */
export function useCreateTask(listId: string) {
  const utils = trpc.useUtils()
  const mutation = trpc.tasks.create.useMutation({
    onSuccess: () => utils.tasks.list.invalidate({ listId }),
  })
  return {
    ...mutation,
    mutateAsync: async (payload: TaskPayload, listKeyB64: string) => {
      const key = fromBase64(listKeyB64)
      const blob = encryptSymmetric(JSON.stringify(payload), key)
      return mutation.mutateAsync({ listId, encryptedPayload: JSON.stringify(blob) })
    },
  }
}

export function useUpdateTask(listId: string) {
  const utils = trpc.useUtils()
  const mutation = trpc.tasks.update.useMutation({
    onSuccess: () => utils.tasks.list.invalidate({ listId }),
  })
  return {
    ...mutation,
    mutateAsync: async (taskId: string, payload: TaskPayload, listKeyB64: string) => {
      const key = fromBase64(listKeyB64)
      const blob = encryptSymmetric(JSON.stringify(payload), key)
      return mutation.mutateAsync({ taskId, encryptedPayload: JSON.stringify(blob) })
    },
  }
}

export function useDeleteTask(listId: string) {
  const utils = trpc.useUtils()
  return trpc.tasks.delete.useMutation({
    onSuccess: () => utils.tasks.list.invalidate({ listId }),
  })
}
```

- [ ] **Step 2: Create useLists**

```typescript
// apps/frontend/src/hooks/useLists.ts
import { trpc } from '../lib/trpc.js'
import { session } from '../lib/session.js'
import { encryptSymmetric, fromBase64 } from '@tasks/shared'

export function useListsList() {
  return trpc.lists.list.useQuery()
}

export function useCreateList() {
  const utils = trpc.useUtils()
  return trpc.lists.create.useMutation({
    onSuccess: () => utils.lists.list.invalidate(),
  })
}

export function useInviteToList() {
  const utils = trpc.useUtils()
  return trpc.lists.invite.useMutation({
    onSuccess: () => utils.lists.list.invalidate(),
  })
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/hooks/useTasks.ts apps/frontend/src/hooks/useLists.ts
git commit -m "feat(frontend): task + list data hooks"
```

---

## Task 15: Task UI components

**Files:**
- Create: `apps/frontend/src/components/Sidebar.tsx`
- Create: `apps/frontend/src/components/TaskList.tsx`
- Create: `apps/frontend/src/components/TaskRow.tsx`
- Create: `apps/frontend/src/routes/TasksPage.tsx`

- [ ] **Step 1: Create Sidebar**

```typescript
// apps/frontend/src/components/Sidebar.tsx
import { NavLink } from 'react-router'
import { useListsList } from '../hooks/useLists.js'

type Props = { activeListId: string; onSelectList: (id: string) => void }

export function Sidebar({ activeListId, onSelectList }: Props) {
  const { data: lists } = useListsList()

  return (
    <nav style={{ width: 200, borderRight: '1px solid #ddd', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontWeight: 'bold', marginBottom: 8 }}>Lists</div>
      {lists?.map(list => (
        <button
          key={list.id}
          onClick={() => onSelectList(list.id)}
          style={{ textAlign: 'left', background: list.id === activeListId ? '#e8e8ff' : 'transparent', border: 'none', cursor: 'pointer', padding: '6px 8px', borderRadius: 4 }}
        >
          {list.isShared ? '🤝' : '📋'} {list.id.slice(0, 8)}…
        </button>
      ))}
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <NavLink to="/lists">Manage lists</NavLink>
        <NavLink to="/devices">Devices</NavLink>
        <NavLink to="/settings">Settings</NavLink>
      </div>
    </nav>
  )
}
```

- [ ] **Step 2: Create TaskRow**

```typescript
// apps/frontend/src/components/TaskRow.tsx
import type { TaskPayload } from '@tasks/shared'
import { describeRrule } from '@tasks/shared'

type Task = TaskPayload & { id: string }
type Props = { task: Task; onToggle: (task: Task) => void; onClick: (task: Task) => void }

export function TaskRow({ task, onToggle, onClick }: Props) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}
      onClick={() => onClick(task)}
    >
      <button
        style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid #aaa', background: 'transparent', cursor: 'pointer', flexShrink: 0 }}
        onClick={e => { e.stopPropagation(); onToggle(task) }}
        aria-label="Complete task"
      />
      <span style={{ flex: 1, textDecoration: task.status === 'done' ? 'line-through' : 'none', color: task.status === 'done' ? '#aaa' : 'inherit' }}>
        {task.title}
      </span>
      {task.rrule && (
        <span style={{ fontSize: 11, color: '#888', flexShrink: 0 }} title={describeRrule(task.rrule) ?? ''}>🔁</span>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Create TaskList**

```typescript
// apps/frontend/src/components/TaskList.tsx
import type { TaskPayload } from '@tasks/shared'
import { TaskRow } from './TaskRow.js'

type Task = TaskPayload & { id: string }
type Props = {
  tasks: Task[]
  bucket: 'now' | 'later' | 'done'
  onToggle: (task: Task) => void
  onClickTask: (task: Task) => void
}

export function TaskList({ tasks, bucket, onToggle, onClickTask }: Props) {
  const filtered = tasks.filter(t =>
    bucket === 'done' ? t.status === 'done' : t.status === 'active' && t.bucket === bucket
  )
  if (filtered.length === 0) return <p style={{ color: '#aaa', fontStyle: 'italic' }}>No tasks here</p>
  return (
    <div>
      {filtered.map(task => (
        <TaskRow key={task.id} task={task} onToggle={onToggle} onClick={onClickTask} />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Create TasksPage**

```typescript
// apps/frontend/src/routes/TasksPage.tsx
import { useState, useMemo } from 'react'
import { Sidebar } from '../components/Sidebar.js'
import { TaskList } from '../components/TaskList.js'
import { TaskDetail } from '../components/TaskDetail.js'
import { useListsList } from '../hooks/useLists.js'
import { useTaskList, useUpdateTask, useCreateTask, type DecryptedTask } from '../hooks/useTasks.js'
import { session } from '../lib/session.js'
import type { TaskPayload } from '@tasks/shared'
import { nextOccurrence, decryptSymmetric, openSeal, fromBase64 } from '@tasks/shared'

type Tab = 'now' | 'later' | 'done'

/** Decrypt a list's encryptedListKey into a raw base64 list key.
 *  Personal lists are encrypted symmetrically (EncryptedBlob) with the stretch key.
 *  Shared lists are sealed asymmetrically to the user's public key.
 */
function resolveListKey(encryptedListKey: string, isShared: boolean): string | null {
  if (!isShared) {
    const stretchKey = session.getStretchKey()
    if (!stretchKey) return null
    try { return decryptSymmetric(JSON.parse(encryptedListKey), stretchKey) } catch { return null }
  } else {
    const privateKey = session.getPrivateKey()
    const publicKey = session.getPublicKey()
    if (!privateKey || !publicKey) return null
    try {
      const raw = openSeal(encryptedListKey, publicKey, privateKey)
      return btoa(String.fromCharCode(...raw))
    } catch { return null }
  }
}

export function TasksPage() {
  const [tab, setTab] = useState<Tab>('now')
  const [selectedTask, setSelectedTask] = useState<DecryptedTask | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const { data: lists } = useListsList()
  const [activeListId, setActiveListId] = useState<string | null>(null)

  const personalList = lists?.[0] ?? null
  const currentListId = activeListId ?? personalList?.id ?? ''
  const currentList = lists?.find(l => l.id === currentListId)

  const listKeyB64 = useMemo(() => {
    if (!currentList) return null
    return resolveListKey(currentList.encryptedListKey, currentList.isShared)
  }, [currentList?.id, currentList?.encryptedListKey])

  const { data: tasks = [] } = useTaskList(currentListId, listKeyB64)
  const updateTask = useUpdateTask(currentListId)
  const createTask = useCreateTask(currentListId)

  async function handleToggle(task: DecryptedTask) {
    if (!listKeyB64) return
    const isDone = task.status === 'active'
    const updated: TaskPayload = { ...task, status: isDone ? 'done' : 'active', completed_at: isDone ? new Date().toISOString() : null }
    await updateTask.mutateAsync(task.id, updated, listKeyB64)
    if (isDone && task.rrule) {
      const next = nextOccurrence(task.rrule, new Date())
      if (next) {
        const nextPayload: TaskPayload = { ...task, status: 'active', completed_at: null, due_date: next.toISOString().split('T')[0] }
        await createTask.mutateAsync(nextPayload, listKeyB64)
      }
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <Sidebar activeListId={currentListId} onSelectList={setActiveListId} />
      <div style={{ flex: 1, padding: 24 }}>
        <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
          {(['now', 'later', 'done'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ fontWeight: tab === t ? 'bold' : 'normal', textTransform: 'capitalize', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, borderBottom: tab === t ? '2px solid #4444ff' : '2px solid transparent', paddingBottom: 4 }}>{t}</button>
          ))}
          <button onClick={() => setShowCreate(true)} style={{ marginLeft: 'auto' }}>+ Add task</button>
        </div>
        <TaskList tasks={tasks} bucket={tab} onToggle={handleToggle} onClickTask={setSelectedTask} />
      </div>
      {(selectedTask || showCreate) && (
        <TaskDetail
          task={selectedTask ?? null}
          listId={currentListId}
          listKeyB64={listKeyB64 ?? ''}
          onClose={() => { setSelectedTask(null); setShowCreate(false) }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/ apps/frontend/src/routes/TasksPage.tsx
git commit -m "feat(frontend): task list UI — Sidebar, TaskRow, TaskList, TasksPage"
```

---

## Task 16: TaskDetail + RecurrencePicker

**Files:**
- Create: `apps/frontend/src/components/RecurrencePicker.tsx`
- Create: `apps/frontend/src/components/TaskDetail.tsx`

- [ ] **Step 1: Create RecurrencePicker**

```typescript
// apps/frontend/src/components/RecurrencePicker.tsx
import { useState } from 'react'
import { RRule } from 'rrule'

type Props = { value: string | null; onChange: (rrule: string | null) => void }

const PRESETS = [
  { label: 'Daily', rule: 'FREQ=DAILY' },
  { label: 'Weekly', rule: 'FREQ=WEEKLY' },
  { label: 'Monthly', rule: 'FREQ=MONTHLY' },
  { label: 'Weekdays (Mon–Fri)', rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  { label: 'Every Monday & Wednesday', rule: 'FREQ=WEEKLY;BYDAY=MO,WE' },
  { label: 'First Monday of month', rule: 'FREQ=MONTHLY;BYDAY=+1MO' },
  { label: 'Last weekday of month', rule: 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1' },
]

export function RecurrencePicker({ value, onChange }: Props) {
  const [custom, setCustom] = useState('')

  function applyCustom() {
    try {
      RRule.fromString(custom)
      onChange(custom)
    } catch {
      alert('Invalid RRULE string')
    }
  }

  return (
    <div>
      <label style={{ fontWeight: 'bold', display: 'block', marginBottom: 8 }}>Recurrence</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label><input type="radio" checked={value === null} onChange={() => onChange(null)} /> None (one-time)</label>
        {PRESETS.map(p => (
          <label key={p.rule}><input type="radio" checked={value === p.rule} onChange={() => onChange(p.rule)} /> {p.label}</label>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <input placeholder="Custom RRULE…" value={custom} onChange={e => setCustom(e.target.value)} style={{ flex: 1 }} />
          <button type="button" onClick={applyCustom}>Apply</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create TaskDetail**

```typescript
// apps/frontend/src/components/TaskDetail.tsx
import { useState } from 'react'
import { RecurrencePicker } from './RecurrencePicker.js'
import { useCreateTask, useUpdateTask, useDeleteTask } from '../hooks/useTasks.js'
import type { TaskPayload } from '@tasks/shared'

type Task = TaskPayload & { id: string }
type Props = { task: Task | null; listId: string; listKeyB64: string; onClose: () => void }

export function TaskDetail({ task, listId, listKeyB64, onClose }: Props) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [notes, setNotes] = useState(task?.notes ?? '')
  const [bucket, setBucket] = useState<'now' | 'later'>(task?.bucket ?? 'now')
  const [rrule, setRrule] = useState<string | null>(task?.rrule ?? null)
  const [dueDate, setDueDate] = useState(task?.due_date ?? '')

  const createTask = useCreateTask(listId)
  const updateTask = useUpdateTask(listId)
  const deleteTask = useDeleteTask(listId)

  async function handleSave() {
    const payload: TaskPayload = { title, notes: notes || null, bucket, status: task?.status ?? 'active', rrule, due_date: dueDate || null, completed_at: task?.completed_at ?? null }
    if (task) {
      await updateTask.mutateAsync(task.id, payload, listKeyB64)
    } else {
      await createTask.mutateAsync(payload, listKeyB64)
    }
    onClose()
  }

  async function handleDelete() {
    if (!task) return
    if (!confirm('Delete this task?')) return
    await deleteTask.mutateAsync({ taskId: task.id })
    onClose()
  }

  return (
    <div style={{ position: 'fixed', right: 0, top: 0, width: 360, height: '100vh', background: '#fff', boxShadow: '-2px 0 8px rgba(0,0,0,0.15)', padding: 24, display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>{task ? 'Edit task' : 'New task'}</h2>
        <button onClick={onClose}>✕</button>
      </div>
      <div><label>Title</label><input value={title} onChange={e => setTitle(e.target.value)} style={{ display: 'block', width: '100%' }} autoFocus /></div>
      <div><label>Notes</label><textarea value={notes} onChange={e => setNotes(e.target.value)} style={{ display: 'block', width: '100%', height: 80 }} /></div>
      <div>
        <label>Bucket</label>
        <select value={bucket} onChange={e => setBucket(e.target.value as 'now' | 'later')} style={{ display: 'block', width: '100%' }}>
          <option value="now">Now</option>
          <option value="later">Later</option>
        </select>
      </div>
      <div><label>Due date</label><input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={{ display: 'block', width: '100%' }} /></div>
      <RecurrencePicker value={rrule} onChange={setRrule} />
      <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
        <button onClick={handleSave} style={{ flex: 1 }}>Save</button>
        {task && <button onClick={handleDelete} style={{ color: 'red' }}>Delete</button>}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/components/RecurrencePicker.tsx apps/frontend/src/components/TaskDetail.tsx
git commit -m "feat(frontend): TaskDetail slide-in panel + RecurrencePicker"
```

---

## Task 17: Lists management UI

**Files:**
- Create: `apps/frontend/src/routes/ListsPage.tsx`

- [ ] **Step 1: Create ListsPage**

```typescript
// apps/frontend/src/routes/ListsPage.tsx
import { useState } from 'react'
import { trpc } from '../lib/trpc.js'
import { session } from '../lib/session.js'
import { encryptSymmetric, generateListKey, fromBase64, sealToPublicKey } from '@tasks/shared'

export function ListsPage() {
  const { data: lists, refetch } = trpc.lists.list.useQuery()
  const createList = trpc.lists.create.useMutation({ onSuccess: () => refetch() })
  const inviteMutation = trpc.lists.invite.useMutation({ onSuccess: () => refetch() })
  const searchUser = trpc.users.search.useQuery

  const [newListName, setNewListName] = useState('')
  const [inviteListId, setInviteListId] = useState<string | null>(null)
  const [inviteUsername, setInviteUsername] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleCreateList(e: React.FormEvent) {
    e.preventDefault()
    const stretchKey = session.getStretchKey()
    if (!stretchKey) return
    const listKey = generateListKey()
    const encName = encryptSymmetric(newListName, stretchKey)
    const encKey = encryptSymmetric(listKey, stretchKey)
    await createList.mutateAsync({ encryptedName: JSON.stringify(encName), encryptedListKey: JSON.stringify(encKey) })
    setNewListName('')
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!inviteListId) return
    setError(null)
    try {
      // Find the current list's raw list key
      const list = lists?.find(l => l.id === inviteListId)
      if (!list) return
      const stretchKey = session.getStretchKey()
      if (!stretchKey) return
      const { decryptSymmetric, fromBase64 } = await import('@tasks/shared')
      const listKeyB64 = decryptSymmetric(JSON.parse(list.encryptedListKey), stretchKey)
      // Get invitee's public key
      const invitee = await trpc.users.search.fetch({ username: inviteUsername })
      if (!invitee) { setError('User not found'); return }
      // Seal the list key to the invitee's public key
      const sealedKey = sealToPublicKey(fromBase64(listKeyB64), invitee.publicKey)
      await inviteMutation.mutateAsync({ listId: inviteListId, inviteeUsername, encryptedListKey: sealedKey })
      setInviteUsername('')
      setInviteListId(null)
    } catch (err: any) {
      setError(err?.message ?? 'Invite failed')
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 600 }}>
      <h1>Lists</h1>
      <section>
        <h2>Create shared list</h2>
        <form onSubmit={handleCreateList} style={{ display: 'flex', gap: 8 }}>
          <input placeholder="List name" value={newListName} onChange={e => setNewListName(e.target.value)} required />
          <button type="submit">Create</button>
        </form>
      </section>
      <section style={{ marginTop: 32 }}>
        <h2>Your lists</h2>
        {lists?.map(list => (
          <div key={list.id} style={{ padding: '10px 0', borderBottom: '1px solid #eee' }}>
            <span>{list.isShared ? '🤝 Shared' : '📋 Personal'} — {list.id.slice(0, 12)}…</span>
            {list.isShared && (
              <button onClick={() => setInviteListId(list.id)} style={{ marginLeft: 12, fontSize: 12 }}>+ Invite</button>
            )}
          </div>
        ))}
      </section>
      {inviteListId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <form onSubmit={handleInvite} style={{ background: '#fff', padding: 24, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 300 }}>
            <h3>Invite to list</h3>
            <input placeholder="Username" value={inviteUsername} onChange={e => setInviteUsername(e.target.value)} required autoFocus />
            {error && <p style={{ color: 'red' }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit">Invite</button>
              <button type="button" onClick={() => setInviteListId(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/routes/ListsPage.tsx
git commit -m "feat(frontend): lists management UI with invite flow"
```

---

## Task 18: Device management UI

**Files:**
- Create: `apps/frontend/src/hooks/useDevices.ts`
- Create: `apps/frontend/src/routes/DevicesPage.tsx`

- [ ] **Step 1: Create useDevices hook**

```typescript
// apps/frontend/src/hooks/useDevices.ts
import { trpc } from '../lib/trpc.js'

export function useDeviceList() {
  return trpc.devices.list.useQuery()
}

export function usePendingDevices() {
  return trpc.devices.listPending.useQuery(undefined, { refetchInterval: 10_000 })
}

export function useApproveDevice() {
  const utils = trpc.useUtils()
  return trpc.devices.approve.useMutation({ onSuccess: () => { utils.devices.listPending.invalidate(); utils.devices.list.invalidate() } })
}

export function useRevokeDevice() {
  const utils = trpc.useUtils()
  return trpc.devices.revoke.useMutation({ onSuccess: () => utils.devices.list.invalidate() })
}
```

- [ ] **Step 2: Create DevicesPage**

```typescript
// apps/frontend/src/routes/DevicesPage.tsx
import { session } from '../lib/session.js'
import { sealToPublicKey } from '@tasks/shared'
import { useDeviceList, usePendingDevices, useApproveDevice, useRevokeDevice } from '../hooks/useDevices.js'

export function DevicesPage() {
  const { data: devices } = useDeviceList()
  const { data: pending } = usePendingDevices()
  const approve = useApproveDevice()
  const revoke = useRevokeDevice()

  async function handleApprove(deviceId: string, devicePublicKey: string) {
    const privateKey = session.getPrivateKey()
    if (!privateKey) { alert('Session expired — please log in again'); return }
    // Seal the user's private key to the new device's public key
    const privateKeyBytes = new TextEncoder().encode(privateKey)
    const sealed = sealToPublicKey(privateKeyBytes, devicePublicKey)
    await approve.mutateAsync({ deviceId, sealedUserPrivateKey: sealed })
  }

  async function handleRevoke(deviceId: string) {
    if (!confirm('Revoke this device? It will be logged out immediately.')) return
    await revoke.mutateAsync({ deviceId })
  }

  return (
    <div style={{ padding: 24, maxWidth: 600 }}>
      <h1>Devices</h1>
      {pending && pending.length > 0 && (
        <section style={{ marginBottom: 32, padding: 16, background: '#fff8e0', borderRadius: 8 }}>
          <h2 style={{ marginTop: 0 }}>Pending approvals</h2>
          {pending.map(d => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <span>{d.name}</span>
              <span style={{ color: '#888', fontSize: 12 }}>{new Date(d.createdAt).toLocaleString()}</span>
              <button onClick={() => handleApprove(d.id, d.publicKey)} style={{ marginLeft: 'auto', background: '#22c55e', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer' }}>
                Approve
              </button>
            </div>
          ))}
        </section>
      )}
      <section>
        <h2>Trusted devices</h2>
        {devices?.length === 0 && <p style={{ color: '#aaa' }}>No approved devices</p>}
        {devices?.map(d => (
          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #eee' }}>
            <span style={{ flex: 1 }}>{d.id.slice(0, 8)}…</span>
            <span style={{ color: '#888', fontSize: 12 }}>{d.approvedAt ? new Date(d.approvedAt).toLocaleDateString() : '—'}</span>
            <button onClick={() => handleRevoke(d.id)} style={{ color: 'red', background: 'none', border: 'none', cursor: 'pointer' }}>Revoke</button>
          </div>
        ))}
      </section>
      <section style={{ marginTop: 32 }}>
        <h2>Add this device</h2>
        <p style={{ color: '#666' }}>On a new device, go to the login page and choose "Approve via existing device". Then approve it here.</p>
      </section>
    </div>
  )
}
```

- [ ] **Step 3: Create SettingsPage stub**

```typescript
// apps/frontend/src/routes/SettingsPage.tsx
import { useAuth } from '../hooks/useAuth.js'

export function SettingsPage() {
  const { logout } = useAuth()
  return (
    <div style={{ padding: 24, maxWidth: 400 }}>
      <h1>Settings</h1>
      <button onClick={logout} style={{ color: 'red', background: 'none', border: '1px solid red', borderRadius: 4, padding: '8px 16px', cursor: 'pointer' }}>
        Log out
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/hooks/useDevices.ts apps/frontend/src/routes/DevicesPage.tsx apps/frontend/src/routes/SettingsPage.tsx
git commit -m "feat(frontend): device management UI + settings page"
```

---

## Task 19: Docker deployment

**Files:**
- Create: `apps/backend/Dockerfile`
- Create: `apps/frontend/Dockerfile`
- Create: `docker-compose.yml`
- Create: `.dockerignore`

- [ ] **Step 1: Backend Dockerfile**

```dockerfile
# apps/backend/Dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lockb ./
COPY apps/backend/package.json ./apps/backend/
COPY packages/shared/package.json ./packages/shared/
RUN bun install --frozen-lockfile

# Copy source
COPY apps/backend/ ./apps/backend/
COPY packages/shared/ ./packages/shared/

WORKDIR /app/apps/backend
EXPOSE 3001
CMD ["bun", "run", "src/index.ts"]
```

- [ ] **Step 2: Frontend Dockerfile**

```dockerfile
# apps/frontend/Dockerfile
FROM oven/bun:1 AS builder
WORKDIR /app

COPY package.json bun.lockb ./
COPY apps/frontend/package.json ./apps/frontend/
COPY packages/shared/package.json ./packages/shared/
RUN bun install --frozen-lockfile

COPY apps/frontend/ ./apps/frontend/
COPY packages/shared/ ./packages/shared/
COPY tsconfig.base.json ./

WORKDIR /app/apps/frontend
RUN bun run build

FROM nginx:alpine AS runner
COPY --from=builder /app/apps/frontend/dist /usr/share/nginx/html
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

- [ ] **Step 3: nginx.conf for frontend SPA routing**

```nginx
# apps/frontend/nginx.conf
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://backend:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }
}
```

- [ ] **Step 4: docker-compose.yml**

```yaml
# docker-compose.yml
services:
  frontend:
    build:
      context: .
      dockerfile: apps/frontend/Dockerfile
    ports:
      - "3000:80"
    depends_on:
      - backend

  backend:
    build:
      context: .
      dockerfile: apps/backend/Dockerfile
    ports:
      - "3001:3001"
    environment:
      DATABASE_URL: /data/db.sqlite
      JWT_SECRET: ${JWT_SECRET:?JWT_SECRET is required}
      CORS_ORIGIN: ${CORS_ORIGIN:-http://localhost:3000}
    volumes:
      - sqlite-data:/data

volumes:
  sqlite-data:
```

- [ ] **Step 5: .dockerignore**

```
node_modules
.git
dist
*.md
.superpowers
```

- [ ] **Step 6: Test the build**

Run: `docker compose build`
Expected: both images build successfully with no errors

- [ ] **Step 7: Test startup**

Run: `JWT_SECRET=test-secret docker compose up`
Expected: frontend available at http://localhost:3000, backend health check at http://localhost:3001/health returns `{"ok":true}`

- [ ] **Step 8: Commit**

```bash
git add apps/backend/Dockerfile apps/frontend/Dockerfile apps/frontend/nginx.conf docker-compose.yml .dockerignore
git commit -m "feat: Docker deployment — multi-stage builds + compose"
```

---

## Task 20: End-to-end smoke test

- [ ] **Step 1: Run all backend unit tests**

Run: `pnpm test`
Expected: all shared + backend tests PASS

- [ ] **Step 2: Start the dev stack**

Run in one terminal: `pnpm dev:backend`
Run in another: `pnpm dev:frontend`

- [ ] **Step 3: Smoke test registration**

1. Open http://localhost:5173
2. Navigate to /register
3. Create a user: `alice`, `alice@example.com`, passphrase `correct-horse-battery`
4. Expected: redirected to /tasks with empty Now list

- [ ] **Step 4: Smoke test task creation**

1. Click "+ Add task"
2. Enter title "Buy groceries", set bucket "Now", set recurrence "Weekly"
3. Save
4. Expected: task appears in Now tab with 🔁 indicator

- [ ] **Step 5: Smoke test task completion + recurrence**

1. Click the circle button on "Buy groceries"
2. Expected: task moves to Done tab; a new "Buy groceries" appears in Now tab (next weekly occurrence)

- [ ] **Step 6: Smoke test second user + shared list**

1. Register a second user `bob` in a new incognito tab
2. As alice: go to /lists, create "Family Shopping"
3. Invite `bob` to the list
4. As bob: navigate to /tasks, switch to "Family Shopping" list
5. Expected: bob can see the shared list and create tasks in it

- [ ] **Step 7: Final commit**

```bash
git add .
git commit -m "chore: final smoke test pass — E2E encrypted task manager complete"
```
