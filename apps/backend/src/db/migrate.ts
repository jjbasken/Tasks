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
  try { sqlite.run(`ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0`) } catch {}
  try {
    sqlite.run(`ALTER TABLE lists ADD COLUMN is_personal INTEGER NOT NULL DEFAULT 0`)
    // Backfill: each user's oldest owned list is their personal list. Runs only on the
    // migration that adds the column, so later user changes are never overwritten.
    sqlite.run(`
      UPDATE lists SET is_personal = 1 WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY owner_id ORDER BY created_at, id) AS rn
          FROM lists
        ) WHERE rn = 1
      )
    `)
  } catch {}
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS revoked_tokens (
      jti TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    )
  `)
  // One membership per (list, user). Duplicates let anyone who could invite push a
  // second row with an attacker-chosen encrypted_list_key onto a user who was
  // already a member, which shows up as a duplicate list they cannot decrypt.
  // Collapse any existing duplicates onto the oldest row — that is the one whose
  // key material was sealed by the legitimate invite — before adding the index.
  sqlite.run(`
    DELETE FROM list_memberships WHERE id NOT IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY list_id, user_id ORDER BY created_at, id) AS rn
        FROM list_memberships
      ) WHERE rn = 1
    )
  `)
  sqlite.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS list_memberships_list_user_idx
      ON list_memberships (list_id, user_id)
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
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL REFERENCES lists(id),
      encrypted_payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  sqlite.run(`CREATE INDEX IF NOT EXISTS notes_list_updated_idx ON notes (list_id, updated_at)`)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS note_tags (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL REFERENCES lists(id),
      encrypted_payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  sqlite.run(`CREATE INDEX IF NOT EXISTS note_tags_list_updated_idx ON note_tags (list_id, updated_at)`)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS note_revisions (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL REFERENCES notes(id),
      list_id TEXT NOT NULL REFERENCES lists(id),
      encrypted_payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
  sqlite.run(`CREATE INDEX IF NOT EXISTS note_revisions_note_created_idx ON note_revisions (note_id, created_at)`)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS sync_tombstones (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL REFERENCES lists(id),
      kind TEXT NOT NULL,
      deleted_at INTEGER NOT NULL
    )
  `)
  // Upgrade the initial notes schema without losing existing deletion records.
  const tombstoneColumns = sqlite.query('PRAGMA table_info(sync_tombstones)').all() as { name: string; pk: number }[]
  if (tombstoneColumns.filter(c => c.pk > 0).length === 1) {
    sqlite.transaction(() => {
      sqlite.run(`ALTER TABLE sync_tombstones RENAME TO sync_tombstones_old`)
      sqlite.run(`CREATE TABLE sync_tombstones (
        id TEXT NOT NULL,
        list_id TEXT NOT NULL REFERENCES lists(id),
        kind TEXT NOT NULL,
        deleted_at INTEGER NOT NULL,
        PRIMARY KEY (list_id, kind, id)
      )`)
      sqlite.run(`INSERT INTO sync_tombstones SELECT id, list_id, kind, deleted_at FROM sync_tombstones_old`)
      sqlite.run(`DROP TABLE sync_tombstones_old`)
    })()
  }
  sqlite.run(`CREATE INDEX IF NOT EXISTS sync_tombstones_list_deleted_idx ON sync_tombstones (list_id, deleted_at)`)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL REFERENCES lists(id),
      note_id TEXT NOT NULL,
      uploader_id TEXT NOT NULL REFERENCES users(id),
      size INTEGER NOT NULL,
      encrypted_metadata TEXT NOT NULL,
      uploaded INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `)
  sqlite.run(`CREATE INDEX IF NOT EXISTS files_note_idx ON files (note_id)`)
  sqlite.run(`CREATE INDEX IF NOT EXISTS files_list_idx ON files (list_id)`)
}
