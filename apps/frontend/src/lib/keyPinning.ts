// Trust-on-first-use pinning for other users' public keys.
//
// Key distribution goes through the server: `users.search` hands back whatever
// public key the server says belongs to a username, and the client seals list
// keys straight to it. A compromised server could substitute its own key and
// read every shared list. Pinning the key seen the first time turns that silent
// substitution into a visible, blocking error.
//
// Deliberately NOT cleared on logout — these are public keys, and their whole
// value is surviving across sessions so a later swap is still detected.

const PIN_KEY = 'tasks:pinnedKeys'

type Pins = Record<string, string>

function load(): Pins {
  try {
    const raw = JSON.parse(localStorage.getItem(PIN_KEY) ?? '{}')
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  } catch {
    return {}
  }
}

function save(pins: Pins) {
  localStorage.setItem(PIN_KEY, JSON.stringify(pins))
}

export type PinStatus = 'new' | 'match' | 'mismatch'

/** Compare a public key against the pinned one without recording anything. */
export function checkPublicKey(username: string, publicKey: string): PinStatus {
  const pinned = load()[username]
  if (!pinned) return 'new'
  return pinned === publicKey ? 'match' : 'mismatch'
}

/** Record a public key as trusted. Refuses to overwrite a conflicting pin. */
export function pinPublicKey(username: string, publicKey: string): PinStatus {
  const status = checkPublicKey(username, publicKey)
  if (status === 'new') {
    const pins = load()
    pins[username] = publicKey
    save(pins)
  }
  return status
}

/** Drop a pin so the next sighting is treated as first use. For deliberate key rotation. */
export function forgetPublicKey(username: string) {
  const pins = load()
  delete pins[username]
  save(pins)
}
