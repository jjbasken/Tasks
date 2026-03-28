import type { Db } from './index.js'

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
  try { sqlite.run(`ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0`) } catch {}
  sqlite.run(`UPDATE users SET is_admin = 1 WHERE username = 'jeremy'`)
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
