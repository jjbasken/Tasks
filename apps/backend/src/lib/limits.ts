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
