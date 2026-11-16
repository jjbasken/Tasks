// Upper bounds for user-supplied strings.
//
// Every field below is written straight into SQLite, so an unbounded `z.string()`
// lets any authenticated caller fill the volume, and unbounded input on the
// unauthenticated login path feeds an arbitrarily large string to Argon2id.
// The bounds are generous multiples of the real encoded sizes — they exist to
// cap abuse, not to validate format.

/** UUIDs are 36 chars; leave room without inviting anything interesting. */
export const MAX_ID = 64

export const MAX_USERNAME = 40
export const MAX_EMAIL = 254

/** base64 of a 32-byte BLAKE2b digest is 44 chars. */
export const MAX_PASSWORD_HASH = 256

/** base64 of a 32-byte curve25519 key is 44 chars; a 16-byte KDF salt is 24. */
export const MAX_KEY_MATERIAL = 256

/** JSON-wrapped sealed or secretbox blobs: a wrapped 32-byte key runs ~200 chars. */
export const MAX_KEY_BLOB = 4096

/** Encrypted list name — a short string plus nonce and base64 overhead. */
export const MAX_NAME_BLOB = 4096

/** Encrypted task payload: title, notes, recurrence rule. 64 KiB of ciphertext. */
export const MAX_TASK_PAYLOAD = 64 * 1024

/** Task ids accepted in one clearDone call. */
export const MAX_TASK_IDS = 1000

/** Encrypted note payload: title, Markdown body, flags. 2 MiB of ciphertext. */
export const MAX_NOTE_PAYLOAD = 2 * 1024 * 1024

/** Encrypted tag payload: a short title and a parent id. */
export const MAX_TAG_PAYLOAD = 4096

/** Encrypted attachment metadata: name, MIME type, size, wrapped per-file key. */
export const MAX_FILE_METADATA = 8192

/** Notes or tags accepted in one import batch. */
export const MAX_IMPORT_BATCH = 100

/** Revisions kept per note; older ones are pruned as new snapshots land. */
export const MAX_REVISIONS_PER_NOTE = 100

/** Minimum gap between revision snapshots of one note, so typing does not flood history. */
export const REVISION_INTERVAL_MS = 10 * 60 * 1000

function envBytes(name: string, fallback: number) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

/** Largest single attachment, in bytes of ciphertext. */
export const MAX_FILE_BYTES = envBytes('MAX_FILE_BYTES', 50 * 1024 * 1024)

/** Total attachment bytes one user may upload across all lists. */
export const FILES_QUOTA_BYTES = envBytes('FILES_QUOTA_BYTES', 2 * 1024 * 1024 * 1024)
