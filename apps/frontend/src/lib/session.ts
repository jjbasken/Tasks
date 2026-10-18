import { revokeAttachmentUrls } from './attachments.js'
import { protection } from './protection.js'

// An unlocked vault lives only in this tab's memory. Reloading or closing the
// tab requires a passphrase login or another device approval.
let token: string | null = null
let stretchKey: Uint8Array | null = null
let privateKey: string | null = null
let publicKey: string | null = null
let isAdmin = false
let userId: string | null = null

// Remove credentials saved by older versions. Preserve any encrypted queued
// work under the previous account before removing its persisted token.
if (typeof localStorage !== 'undefined') {
  try {
    const previous = localStorage.getItem('tasks:token')
    const queue = localStorage.getItem('tasks:offline_queue')
    if (previous && queue) {
      const payload = JSON.parse(atob(previous.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
      if (typeof payload.sub === 'string') {
        const key = `tasks:offline_queue:${payload.sub}`
        const old = JSON.parse(localStorage.getItem(key) ?? '[]')
        const migrated = JSON.parse(queue).map((m: any) =>
          m.type === 'create' ? { ...m, taskId: m.taskId ?? crypto.randomUUID() } : m)
        localStorage.setItem(key, JSON.stringify([...old, ...migrated]))
        localStorage.removeItem('tasks:offline_queue')
      }
    }
  } catch { /* Keep an unassignable legacy queue intact for recovery. */ }
  for (const key of ['token', 'stretchKey', 'privateKey', 'publicKey', 'isAdmin']) {
    localStorage.removeItem(`tasks:${key}`)
  }
}

export const session = {
  setToken: (value: string) => { token = value },
  getToken: () => {
    if (!token) return null
    try {
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
      if (payload.exp && payload.exp * 1000 <= Date.now()) {
        session.clear()
        return null
      }
    } catch { session.clear(); return null }
    return token
  },
  setStretchKey: (value: Uint8Array) => { stretchKey = new Uint8Array(value) },
  getStretchKey: () => stretchKey,
  setPrivateKey: (value: string) => { privateKey = value },
  getPrivateKey: () => privateKey,
  setPublicKey: (value: string) => { publicKey = value },
  getPublicKey: () => publicKey,
  setIsAdmin: (value: boolean) => { isAdmin = value },
  getIsAdmin: () => isAdmin,
  setUserId: (value: string) => { userId = value },
  getUserId: () => userId,
  clear: () => {
    revokeAttachmentUrls()
    protection.lock()
    stretchKey?.fill(0)
    token = privateKey = publicKey = userId = null
    stretchKey = null
    isAdmin = false
  },
}
