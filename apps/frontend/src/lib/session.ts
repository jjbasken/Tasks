// Key material lives in sessionStorage — survives page reloads within the same tab,
// cleared when the tab closes. Explicitly cleared on logout.

const KEYS = {
  token: 'tasks:token',
  stretchKey: 'tasks:stretchKey',   // base64 Uint8Array
  privateKey: 'tasks:privateKey',   // base64 curve25519 private key (from keypair)
  publicKey: 'tasks:publicKey',     // base64 curve25519 public key
  isAdmin: 'tasks:isAdmin',
} as const

export const session = {
  setToken: (t: string) => sessionStorage.setItem(KEYS.token, t),
  getToken: () => sessionStorage.getItem(KEYS.token),

  setStretchKey: (k: Uint8Array) => sessionStorage.setItem(KEYS.stretchKey, btoa(String.fromCharCode(...k))),
  getStretchKey: (): Uint8Array | null => {
    const v = sessionStorage.getItem(KEYS.stretchKey)
    if (!v) return null
    return Uint8Array.from(atob(v), c => c.charCodeAt(0))
  },

  setPrivateKey: (k: string) => sessionStorage.setItem(KEYS.privateKey, k),
  getPrivateKey: () => sessionStorage.getItem(KEYS.privateKey),

  setPublicKey: (k: string) => sessionStorage.setItem(KEYS.publicKey, k),
  getPublicKey: () => sessionStorage.getItem(KEYS.publicKey),

  setIsAdmin: (v: boolean) => sessionStorage.setItem(KEYS.isAdmin, v ? '1' : '0'),
  getIsAdmin: () => sessionStorage.getItem(KEYS.isAdmin) === '1',

  clear: () => Object.values(KEYS).forEach(k => sessionStorage.removeItem(k)),
}
