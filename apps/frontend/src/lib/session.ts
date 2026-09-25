// Sensitive session material is memory-only. A reload requires login again, but
// bearer tokens and plaintext keys are never written to Web Storage.

const KEYS = {
  token: 'tasks:token',
  stretchKey: 'tasks:stretchKey',   // base64 Uint8Array
  privateKey: 'tasks:privateKey',   // base64 curve25519 private key (from keypair)
  publicKey: 'tasks:publicKey',     // base64 curve25519 public key
  isAdmin: 'tasks:isAdmin',
} as const

let token: string | null = null
let stretchKey: Uint8Array | null = null
let privateKey: string | null = null
let publicKey: string | null = null
let isAdmin = false

// One-time cleanup for versions that persisted plaintext keys and year-long tokens.
if (typeof localStorage !== 'undefined') {
  Object.values(KEYS).forEach(k => localStorage.removeItem(k))
}

export const session = {
  setToken: (t: string) => { token = t },
  getToken: () => {
    if (!token) return null
    try {
      const payload = JSON.parse(atob(token.split('.')[1]))
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        session.clear()
        return null
      }
    } catch { /* malformed token */ }
    return token
  },

  setStretchKey: (k: Uint8Array) => { stretchKey = new Uint8Array(k) },
  getStretchKey: (): Uint8Array | null => stretchKey,

  setPrivateKey: (k: string) => { privateKey = k },
  getPrivateKey: () => privateKey,

  setPublicKey: (k: string) => { publicKey = k },
  getPublicKey: () => publicKey,

  setIsAdmin: (v: boolean) => { isAdmin = v },
  getIsAdmin: () => isAdmin,

  clear: () => {
    stretchKey?.fill(0)
    token = null
    stretchKey = null
    privateKey = null
    publicKey = null
    isAdmin = false
  },
}
