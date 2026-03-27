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

export const db = createDb(process.env.DATABASE_URL ?? ':memory:')
