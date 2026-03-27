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
