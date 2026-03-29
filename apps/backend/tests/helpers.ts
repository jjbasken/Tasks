// Ensure JWT_SECRET is set for tests
process.env.JWT_SECRET ??= 'test-secret-do-not-use-in-production'

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
