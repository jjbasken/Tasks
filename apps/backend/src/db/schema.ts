import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

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
  createdAt: integer('created_at').notNull(),
})

export const lists = sqliteTable('lists', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull().references(() => users.id),
  encryptedName: text('encrypted_name').notNull(),
  isShared: integer('is_shared', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
})

export const listMemberships = sqliteTable('list_memberships', {
  id: text('id').primaryKey(),
  listId: text('list_id').notNull().references(() => lists.id),
  userId: text('user_id').notNull().references(() => users.id),
  encryptedListKey: text('encrypted_list_key').notNull(),
  invitedBy: text('invited_by').references(() => users.id),
  createdAt: integer('created_at').notNull(),
})

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  listId: text('list_id').notNull().references(() => lists.id),
  encryptedPayload: text('encrypted_payload').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
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
