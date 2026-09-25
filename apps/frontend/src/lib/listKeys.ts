import { decryptSymmetric, openSeal, toBase64, type EncryptedBlob } from '@tasks/shared'
import { session } from './session.js'

/** The creator has a symmetric wrapper; invitees receive a sealed box. */
function asSymmetricBlob(value: string): EncryptedBlob | null {
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed.ciphertext === 'string' && typeof parsed.nonce === 'string') return parsed
  } catch { /* sealed-box base64 */ }
  return null
}

export function resolveListKey(encryptedListKey: string): string | null {
  const symmetric = asSymmetricBlob(encryptedListKey)
  if (symmetric) {
    const stretchKey = session.getStretchKey()
    if (!stretchKey) return null
    try { return decryptSymmetric(symmetric, stretchKey) } catch { return null }
  }

  const privateKey = session.getPrivateKey()
  const publicKey = session.getPublicKey()
  if (!privateKey || !publicKey) return null
  try { return toBase64(openSeal(encryptedListKey, publicKey, privateKey)) } catch { return null }
}
