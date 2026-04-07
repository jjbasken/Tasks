// Key material lives in localStorage — survives tab/app closes.
// Explicitly cleared on logout.

const KEYS = {
  token: 'tasks:token',
  stretchKey: 'tasks:stretchKey',   // base64 Uint8Array
  privateKey: 'tasks:privateKey',   // base64 curve25519 private key (from keypair)
  publicKey: 'tasks:publicKey',     // base64 curve25519 public key
  isAdmin: 'tasks:isAdmin',
} as const

export const session = {
  setToken: (t: string) => localStorage.setItem(KEYS.token, t),
  getToken: () => {
    const token = localStorage.getItem(KEYS.token)
    if (!token) return null
    try {
      const payload = JSON.parse(atob(token.split('.')[1]))
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        Object.values(KEYS).forEach(k => localStorage.removeItem(k))
        return null
      }
    } catch { /* malformed token */ }
    return token
  },

  setStretchKey: (k: Uint8Array) => localStorage.setItem(KEYS.stretchKey, btoa(String.fromCharCode(...k))),
  getStretchKey: (): Uint8Array | null => {
    const v = localStorage.getItem(KEYS.stretchKey)
    if (!v) return null
    return Uint8Array.from(atob(v), c => c.charCodeAt(0))
  },

  setPrivateKey: (k: string) => localStorage.setItem(KEYS.privateKey, k),
  getPrivateKey: () => localStorage.getItem(KEYS.privateKey),

  setPublicKey: (k: string) => localStorage.setItem(KEYS.publicKey, k),
  getPublicKey: () => localStorage.getItem(KEYS.publicKey),

  setIsAdmin: (v: boolean) => localStorage.setItem(KEYS.isAdmin, v ? '1' : '0'),
  getIsAdmin: () => localStorage.getItem(KEYS.isAdmin) === '1',

  clear: () => Object.values(KEYS).forEach(k => localStorage.removeItem(k)),
}
