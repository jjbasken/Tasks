// packages/shared/src/types.ts

export type TaskPayload = {
  spawned_by?: string       // exact completed task that spawned this occurrence
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

/** Versioned account material transferred only between an approved device pair. */
export type DeviceKeyBundle = {
  version: 1
  privateKey: string
  stretchKey: string
  publicKey: string
  isAdmin: boolean
}

export type NotePayload = {
  title: string
  text: string
  editor: 'markdown' | 'plain'
  tag_ids: string[]
  attachment_ids: string[]
  pinned: boolean
  archived: boolean
  trashed_at: string | null   // ISO timestamp; null when not in the trash
  locked: boolean             // read-only until unlocked
  protected: boolean          // requires passphrase re-entry to view
  created_at: string          // ISO; client-side so imports keep their dates
  edited_at: string           // ISO; last content edit
}

export type TagPayload = {
  title: string
  parent_id: string | null
}

/** Encrypted with the list key; the attachment bytes use their own file key. */
export type FileMetadata = {
  name: string
  mime: string
  size: number
  file_key: string  // base64
}
