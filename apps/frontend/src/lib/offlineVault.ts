import { decryptSymmetric, deriveStretchKey, encryptSymmetric } from '@tasks/shared'
import { dehydrate, hydrate, type QueryClient } from '@tanstack/react-query'
import { session } from './session.js'

const accountKey = (username: string) => `tasks:offline_account:${username}`
const dataKey = (userId: string) => `tasks:offline_data:${userId}`
type Identity = { userId: string; privateKey: string; publicKey: string }

// Only a salt and authenticated ciphertext survive a lock. Neither the bearer
// token nor an unlocked encryption key is ever written to storage.
export function rememberOfflineAccount(username: string, salt: string, key: Uint8Array, identity: Identity) {
  localStorage.setItem(accountKey(username), JSON.stringify({ salt, identity: encryptSymmetric(JSON.stringify(identity), key) }))
}

export async function unlockOfflineAccount(username: string, passphrase: string) {
  const saved = localStorage.getItem(accountKey(username))
  if (!saved) throw new Error('Connect and sign in once on this device before unlocking offline.')
  const record = JSON.parse(saved)
  const key = await deriveStretchKey(passphrase, record.salt)
  try {
    const identity: Identity = JSON.parse(decryptSymmetric(record.identity, key))
    if (!identity.userId || !identity.privateKey || !identity.publicKey) throw new Error('Invalid offline account')
    return { ...identity, key }
  } catch {
    key.fill(0)
    throw new Error('Could not unlock the saved vault. Check your passphrase or reconnect and sign in.')
  }
}

function isOfflineQuery(queryKey: readonly unknown[]) {
  if (queryKey[0] === 'notes' && typeof queryKey[1] === 'string') return true
  const path = queryKey[0]
  return Array.isArray(path) && path.length === 2 && path[1] === 'list' && (path[0] === 'lists' || path[0] === 'tasks')
}

export function restoreOfflineData(client: QueryClient) {
  const userId = session.getUserId()
  const key = session.getStretchKey()
  if (!userId || !key) return
  const saved = localStorage.getItem(dataKey(userId))
  if (saved) hydrate(client, JSON.parse(decryptSymmetric(JSON.parse(saved), key)))
}

export function persistOfflineData(client: QueryClient) {
  const userId = session.getUserId()
  const key = session.getStretchKey()
  if (!userId || !key) return
  const state = dehydrate(client, {
    shouldDehydrateMutation: () => false,
    shouldDehydrateQuery: query => isOfflineQuery(query.queryKey) && query.state.data !== undefined,
  })
  localStorage.setItem(dataKey(userId), JSON.stringify(encryptSymmetric(JSON.stringify(state), key)))
}

let storageError: string | null = null
const failures = new Set<string>()
const listeners = new Set<() => void>()
export const offlineStorageStatus = {
  getSnapshot: () => storageError,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  report(error: unknown, source = 'data') {
    if (error) failures.add(source)
    else failures.delete(source)
    storageError = failures.size ? 'Offline storage is unavailable or full. Keep the app open and reconnect before closing it.' : null
    listeners.forEach(listener => listener())
  },
}

export function watchOfflineData(client: QueryClient) {
  return client.getQueryCache().subscribe(event => {
    if (event.type !== 'updated' || event.action.type !== 'success' || !isOfflineQuery(event.query.queryKey)) return
    try { persistOfflineData(client); offlineStorageStatus.report(null) }
    catch (error) { offlineStorageStatus.report(error) }
  })
}
