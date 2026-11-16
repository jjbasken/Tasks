import { decryptSymmetric, encryptSymmetric, fromBase64, openSeal, toBase64 } from '@tasks/shared'

export type VaultKeys = { stretchKey: Uint8Array; privateKey: string; publicKey: string }

export function unwrapListKey(encryptedListKey: string, keys: VaultKeys): string {
  let parsed: any
  try { parsed = JSON.parse(encryptedListKey) } catch { /* sealed box */ }
  if (parsed && typeof parsed.ciphertext === 'string' && typeof parsed.nonce === 'string') {
    return decryptSymmetric(parsed, keys.stretchKey)
  }
  return toBase64(openSeal(encryptedListKey, keys.publicKey, keys.privateKey))
}

export function readListName(encryptedName: string, listKey: string, keys: VaultKeys, isOwner: boolean) {
  const parsed = JSON.parse(encryptedName)
  try {
    return { name: decryptSymmetric(parsed, fromBase64(listKey)), needsMigration: false }
  } catch {
    // Only the owner can read the old passphrase-wrapped name. Recipients can
    // still open the list and tasks until the owner upgrades the name.
    if (!isOwner) return { name: 'Shared list', needsMigration: false }
    const name = typeof parsed === 'string' ? parsed : decryptSymmetric(parsed, keys.stretchKey)
    return { name, needsMigration: true }
  }
}

export function encryptListName(name: string, listKey: string) {
  return JSON.stringify(encryptSymmetric(name, fromBase64(listKey)))
}
