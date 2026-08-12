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
  deviceVerificationCode,
  publicKeyFingerprint,
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

describe('deviceVerificationCode', () => {
  it('is a 6-digit string', async () => {
    const code = await deviceVerificationCode(generateKeypair().publicKey)
    expect(code).toMatch(/^\d{6}$/)
  })
  it('is deterministic for a given key, so both devices derive the same code', async () => {
    const { publicKey } = generateKeypair()
    expect(await deviceVerificationCode(publicKey)).toBe(await deviceVerificationCode(publicKey))
  })
  it('differs between keys', async () => {
    const a = await deviceVerificationCode(generateKeypair().publicKey)
    const b = await deviceVerificationCode(generateKeypair().publicKey)
    expect(a).not.toBe(b)
  })
  it('does not throw on non-base64 input', async () => {
    expect(await deviceVerificationCode('not-base64!!')).toMatch(/^\d{6}$/)
  })
})

describe('publicKeyFingerprint', () => {
  it('is stable for a key and different across keys', async () => {
    const { publicKey } = generateKeypair()
    expect(await publicKeyFingerprint(publicKey)).toBe(await publicKeyFingerprint(publicKey))
    expect(await publicKeyFingerprint(publicKey)).not.toBe(await publicKeyFingerprint(generateKeypair().publicKey))
  })
  it('formats as 5 space-separated hex groups', async () => {
    expect(await publicKeyFingerprint(generateKeypair().publicKey)).toMatch(/^([0-9a-f]{4} ){4}[0-9a-f]{4}$/)
  })
})
