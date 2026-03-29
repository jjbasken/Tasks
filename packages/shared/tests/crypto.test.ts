import { describe, it, expect, beforeAll } from 'bun:test'
import {
  initCrypto,
  generateKdfSalt,
  deriveStretchKey,
  deriveServerPassword,
  generateKeypair,
  generateListKey,
  encryptSymmetric,
  decryptSymmetric,
  sealToPublicKey,
  openSeal,
  toBase64,
  fromBase64,
} from '../src/crypto.js'

beforeAll(async () => { await initCrypto() })

describe('generateKdfSalt', () => {
  it('returns a base64 string of correct byte length (16 bytes = crypto_pwhash_SALTBYTES)', () => {
    const salt = generateKdfSalt()
    expect(fromBase64(salt).length).toBe(16)
  })
  it('returns a different value each call', () => {
    expect(generateKdfSalt()).not.toBe(generateKdfSalt())
  })
})

describe('deriveStretchKey', () => {
  it('returns 32 bytes', async () => {
    const salt = generateKdfSalt()
    const key = await deriveStretchKey('my-passphrase', salt)
    expect(key.length).toBe(32)
  })
  it('is deterministic for same passphrase + salt', async () => {
    const salt = generateKdfSalt()
    const a = await deriveStretchKey('pass', salt)
    const b = await deriveStretchKey('pass', salt)
    expect(toBase64(a)).toBe(toBase64(b))
  })
  it('differs for different passphrases', async () => {
    const salt = generateKdfSalt()
    const a = await deriveStretchKey('pass1', salt)
    const b = await deriveStretchKey('pass2', salt)
    expect(toBase64(a)).not.toBe(toBase64(b))
  })
})

describe('encryptSymmetric / decryptSymmetric', () => {
  it('round-trips plaintext', async () => {
    const salt = generateKdfSalt()
    const key = await deriveStretchKey('pass', salt)
    const blob = encryptSymmetric('hello world', key)
    expect(decryptSymmetric(blob, key)).toBe('hello world')
  })
  it('produces different ciphertexts each call (random nonce)', async () => {
    const salt = generateKdfSalt()
    const key = await deriveStretchKey('pass', salt)
    const a = encryptSymmetric('hello', key)
    const b = encryptSymmetric('hello', key)
    expect(a.ciphertext).not.toBe(b.ciphertext)
  })
})

describe('sealToPublicKey / openSeal', () => {
  it('round-trips a Uint8Array', () => {
    const kp = generateKeypair()
    const data = new TextEncoder().encode('secret key material')
    const sealed = sealToPublicKey(data, kp.publicKey)
    const opened = openSeal(sealed, kp.publicKey, kp.privateKey)
    expect(new TextDecoder().decode(opened)).toBe('secret key material')
  })
})

describe('deriveServerPassword', () => {
  it('returns a base64 string of length > 0', async () => {
    const salt = generateKdfSalt()
    const stretchKey = await deriveStretchKey('mypassphrase', salt)
    const serverPassword = deriveServerPassword(stretchKey)
    expect(serverPassword).toBeString()
    expect(serverPassword.length).toBeGreaterThan(0)
  })

  it('is deterministic for the same stretchKey', async () => {
    const salt = generateKdfSalt()
    const stretchKey = await deriveStretchKey('mypassphrase', salt)
    const a = deriveServerPassword(stretchKey)
    const b = deriveServerPassword(stretchKey)
    expect(a).toBe(b)
  })

  it('differs from the stretchKey itself', async () => {
    const salt = generateKdfSalt()
    const stretchKey = await deriveStretchKey('mypassphrase', salt)
    const serverPassword = deriveServerPassword(stretchKey)
    const stretchKeyB64 = btoa(String.fromCharCode(...stretchKey))
    expect(serverPassword).not.toBe(stretchKeyB64)
  })
})

describe('generateListKey', () => {
  it('returns 32 bytes as base64', () => {
    const key = generateListKey()
    expect(fromBase64(key).length).toBe(32)
  })
})
