import { deriveStretchKey, secretsEqual } from '@tasks/shared'
import { session } from './session.js'

/** How long one passphrase entry keeps protected notes open, like StandardNotes. */
export const UNLOCK_MS = 5 * 60 * 1000

let unlockedUntil = 0
let unlockedFor: string | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(l => l())

/**
 * Protected notes are an access gate over already-decrypted data, not an extra
 * encryption layer: they stop a shoulder-surfer or someone at an unlocked
 * device, not someone who holds the vault keys.
 */
export const protection = {
  isUnlocked() {
    return unlockedFor !== null && unlockedFor === session.getUserId() && Date.now() < unlockedUntil
  },
  /** Re-derive the stretch key and compare it with the unlocked vault's own. */
  async verify(passphrase: string, kdfSalt: string) {
    const current = session.getStretchKey()
    if (!current || !passphrase) return false
    const derived = await deriveStretchKey(passphrase, kdfSalt)
    const ok = secretsEqual(derived, current)
    derived.fill(0)
    if (ok) {
      unlockedFor = session.getUserId()
      unlockedUntil = Date.now() + UNLOCK_MS
      notify()
    }
    return ok
  },
  lock() { unlockedUntil = 0; unlockedFor = null; notify() },
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  remainingMs() { return protection.isUnlocked() ? unlockedUntil - Date.now() : 0 },
}
