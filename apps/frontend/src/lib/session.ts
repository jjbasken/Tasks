// Key material lives in localStorage so it survives page reloads and mobile
// back-navigation. Explicitly cleared on logout.

const KEYS = {
  token: 'tasks:token',
  stretchKey: 'tasks:stretchKey',   // base64 Uint8Array
  privateKey: 'tasks:privateKey',   // base64 curve25519 private key (from keypair)
  publicKey: 'tasks:publicKey',     // base64 curve25519 public key
} as const

export const session = {
  setToken: (t: string) => localStorage.setItem(KEYS.token, t),
  getToken: () => localStorage.getItem(KEYS.token),

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

  clear: () => Object.values(KEYS).forEach(k => localStorage.removeItem(k)),
}
