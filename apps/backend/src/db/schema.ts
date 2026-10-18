import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  publicKey: text('public_key').notNull(),
  kdfSalt: text('kdf_salt').notNull(),
  encryptedPrivateKey: text('encrypted_private_key').notNull(),
  encryptedPersonalListKey: text('encrypted_personal_list_key').notNull(),
  isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
  // Bumped to invalidate all outstanding tokens for this user (logout-everywhere / admin revoke).
  tokenVersion: integer('token_version').notNull().default(0),
  createdAt: integer('created_at').notNull(),
})

export const lists = sqliteTable('lists', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull().references(() => users.id),
  encryptedName: text('encrypted_name').notNull(),
  isShared: integer('is_shared', { mode: 'boolean' }).notNull().default(false),
  isPersonal: integer('is_personal', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
})

export const listMemberships = sqliteTable('list_memberships', {
  id: text('id').primaryKey(),
  listId: text('list_id').notNull().references(() => lists.id),
  userId: text('user_id').notNull().references(() => users.id),
  encryptedListKey: text('encrypted_list_key').notNull(),
  invitedBy: text('invited_by').references(() => users.id),
  createdAt: integer('created_at').notNull(),
}, table => ({
  // A user belongs to a list at most once. Enforced in the database so a racing
  // pair of invites cannot slip a second row past the check in the router.
  listUser: uniqueIndex('list_memberships_list_user_idx').on(table.listId, table.userId),
}))

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  listId: text('list_id').notNull().references(() => lists.id),
  encryptedPayload: text('encrypted_payload').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const notes = sqliteTable('notes', {
  id: text('id').primaryKey(),
  listId: text('list_id').notNull().references(() => lists.id),
  encryptedPayload: text('encrypted_payload').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => ({
  listUpdated: index('notes_list_updated_idx').on(table.listId, table.updatedAt),
}))

export const noteTags = sqliteTable('note_tags', {
  id: text('id').primaryKey(),
  listId: text('list_id').notNull().references(() => lists.id),
  encryptedPayload: text('encrypted_payload').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => ({
  listUpdated: index('note_tags_list_updated_idx').on(table.listId, table.updatedAt),
}))

// Prior versions of a note, snapshotted by the server on update. The server only
// copies ciphertext; it never needs to read a revision.
export const noteRevisions = sqliteTable('note_revisions', {
  id: text('id').primaryKey(),
  noteId: text('note_id').notNull().references(() => notes.id),
  listId: text('list_id').notNull().references(() => lists.id),
  encryptedPayload: text('encrypted_payload').notNull(),
  createdAt: integer('created_at').notNull(),
}, table => ({
  noteCreated: index('note_revisions_note_created_idx').on(table.noteId, table.createdAt),
}))

// Permanent deletes of notes and tags, so incremental sync can tell clients what
// disappeared since their cursor.
export const syncTombstones = sqliteTable('sync_tombstones', {
  id: text('id').primaryKey(),
  listId: text('list_id').notNull().references(() => lists.id),
  kind: text('kind', { enum: ['note', 'tag'] }).notNull(),
  deletedAt: integer('deleted_at').notNull(),
}, table => ({
  listDeleted: index('sync_tombstones_list_deleted_idx').on(table.listId, table.deletedAt),
}))

// Encrypted attachment blobs live on disk; this row holds the access-control
// facts and the list-key-encrypted metadata (name, type, per-file key).
export const files = sqliteTable('files', {
  id: text('id').primaryKey(),
  listId: text('list_id').notNull().references(() => lists.id),
  noteId: text('note_id').notNull(),
  uploaderId: text('uploader_id').notNull().references(() => users.id),
  size: integer('size').notNull(),
  encryptedMetadata: text('encrypted_metadata').notNull(),
  uploaded: integer('uploaded', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
}, table => ({
  note: index('files_note_idx').on(table.noteId),
  list: index('files_list_idx').on(table.listId),
}))

// Individual tokens invalidated by an explicit logout. Bumping users.tokenVersion
// kills every session at once; this kills exactly the session that logged out.
// Rows are purged once past their token's own expiry.
export const revokedTokens = sqliteTable('revoked_tokens', {
  jti: text('jti').primaryKey(),
  expiresAt: integer('expires_at').notNull(),
})

export const devices = sqliteTable('devices', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  publicKey: text('public_key').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull().default('pending'),
  sealedUserPrivateKey: text('sealed_user_private_key'),
  pendingToken: text('pending_token'),
  approvedBy: text('approved_by'),
  createdAt: integer('created_at').notNull(),
  approvedAt: integer('approved_at'),
})
