// packages/shared/src/crypto.ts
import sodium from 'libsodium-wrappers-sumo'
import type { EncryptedBlob } from './types.js'

export async function initCrypto(): Promise<void> {
  await sodium.ready
}

export function toBase64(bytes: Uint8Array): string {
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL)
}

export function fromBase64(b64: string): Uint8Array {
  return sodium.from_base64(b64, sodium.base64_variants.ORIGINAL)
}

/** Generate a random Argon2id KDF salt (16 bytes = crypto_pwhash_SALTBYTES), returned as base64. */
export function generateKdfSalt(): string {
  return toBase64(sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES))
}

/**
 * Derive a 32-byte stretch key from a passphrase + base64 salt using Argon2id.
 * The result is NEVER sent to the server — used only to wrap/unwrap local keys.
 */
export async function deriveStretchKey(passphrase: string, saltB64: string): Promise<Uint8Array> {
  await sodium.ready
  return sodium.crypto_pwhash(
    32,
    passphrase,
    fromBase64(saltB64),
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  )
}

/**
 * Derive a server authentication token from the stretch key.
 * This is sent to the server as `passwordHash` instead of the raw passphrase.
 * The passphrase itself never leaves the browser.
 * Uses BLAKE2b with a "server-auth" context key.
 */
export function deriveServerPassword(stretchKey: Uint8Array): string {
  const context = sodium.from_string('server-auth')
  const token = sodium.crypto_generichash(32, stretchKey, context)
  return toBase64(token)
}

/** Generate a curve25519 keypair. Returns base64 strings for storage. */
export function generateKeypair(): { publicKey: string; privateKey: string } {
  const kp = sodium.crypto_box_keypair()
  return { publicKey: toBase64(kp.publicKey), privateKey: toBase64(kp.privateKey) }
}

/** Generate a random 32-byte symmetric list key, returned as base64. */
export function generateListKey(): string {
  return toBase64(sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES))
}

/** Encrypt a UTF-8 string with XChaCha20-Poly1305 (libsodium SecretBox). */
export function encryptSymmetric(plaintext: string, key: Uint8Array): EncryptedBlob {
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
  const ciphertext = sodium.crypto_secretbox_easy(sodium.from_string(plaintext), nonce, key)
  return { ciphertext: toBase64(ciphertext), nonce: toBase64(nonce) }
}

/** Decrypt a SecretBox-encrypted blob. Throws if authentication fails. */
export function decryptSymmetric(blob: EncryptedBlob, key: Uint8Array): string {
  const plaintext = sodium.crypto_secretbox_open_easy(
    fromBase64(blob.ciphertext),
    fromBase64(blob.nonce),
    key,
  )
  return sodium.to_string(plaintext)
}

/**
 * Seal data to a recipient's curve25519 public key (no sender identity).
 * Used to transfer key material to a new device.
 */
export function sealToPublicKey(data: Uint8Array, recipientPublicKeyB64: string): string {
  return toBase64(sodium.crypto_box_seal(data, fromBase64(recipientPublicKeyB64)))
}

/** Open a sealed box using the recipient's keypair. */
export function openSeal(
  ciphertextB64: string,
  publicKeyB64: string,
  privateKeyB64: string,
): Uint8Array {
  return sodium.crypto_box_seal_open(
    fromBase64(ciphertextB64),
    fromBase64(publicKeyB64),
    fromBase64(privateKeyB64),
  )
}
