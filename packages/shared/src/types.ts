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
