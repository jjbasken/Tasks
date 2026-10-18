import { decryptSymmetric, deriveStretchKey, encryptSymmetric } from '@tasks/shared'
import { dehydrate, hydrate, type QueryClient } from '@tanstack/react-query'
import { offlineQueue } from './offlineQueue.js'
import { session } from './session.js'

const ACCOUNT_PREFIX = 'tasks:offline_account:'
const accountKey = (username: string) => `${ACCOUNT_PREFIX}${username}`
// Snapshots were briefly saved as one localStorage entry; free that space.
const legacyDataKey = (userId: string) => `tasks:offline_data:${userId}`
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

/**
 * One encrypted record per cached query. Snapshots live in IndexedDB, which has
 * a far larger quota than localStorage, so they can never take the space the
 * outbox of unsynced edits needs there.
 */
export type SnapshotRecord = { userId: string; hash: string; listId: string | null; blob: string }
export type SnapshotStore = {
  all(userId: string): Promise<SnapshotRecord[]>
  put(records: SnapshotRecord[]): Promise<void>
  remove(userId: string, hashes: string[]): Promise<void>
  clear(userId: string): Promise<void>
}

const DB_NAME = 'tasks-offline'
const STORE = 'snapshots'
let database: Promise<IDBDatabase> | null = null

function openDatabase() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: ['userId', 'hash'] }).createIndex('userId', 'userId')
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => { db.close(); database = null }
      resolve(db)
    }
    request.onerror = () => { database = null; reject(request.error) }
  })
}

async function transact(mode: IDBTransactionMode, run: (store: IDBObjectStore) => void) {
  const db = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    run(tx.objectStore(STORE))
    tx.oncomplete = () => resolve()
    tx.onerror = tx.onabort = () => reject(tx.error)
  })
}

const indexedDbStore: SnapshotStore = {
  async all(userId) {
    let records: SnapshotRecord[] = []
    await transact('readonly', store => {
      const request = store.index('userId').getAll(userId)
      request.onsuccess = () => { records = request.result }
    })
    return records
  },
  put: records => transact('readwrite', store => { records.forEach(record => store.put(record)) }),
  remove: (userId, hashes) => transact('readwrite', store => { hashes.forEach(hash => store.delete([userId, hash])) }),
  clear: userId => transact('readwrite', store => {
    const request = store.index('userId').openCursor(IDBKeyRange.only(userId))
    request.onsuccess = () => {
      const cursor = request.result
      if (cursor) { cursor.delete(); cursor.continue() }
    }
  }),
}

let snapshots: SnapshotStore = indexedDbStore
/** Tests run without IndexedDB. */
export function setSnapshotStore(store: SnapshotStore) { snapshots = store }

/** The list a saved query belongs to: null for the list index, undefined if it is never saved. */
function offlineListId(queryKey: readonly unknown[]): string | null | undefined {
  if (queryKey[0] === 'notes' && typeof queryKey[1] === 'string') return queryKey[1]
  const path = queryKey[0]
  if (!Array.isArray(path) || path.length !== 2 || path[1] !== 'list') return undefined
  if (path[0] === 'lists') return null
  const listId = (queryKey[1] as { input?: { listId?: unknown } } | undefined)?.input?.listId
  return path[0] === 'tasks' && typeof listId === 'string' ? listId : undefined
}

export async function restoreOfflineData(client: QueryClient) {
  const userId = session.getUserId()
  const key = session.getStretchKey()
  if (!userId || !key) return
  forgotten = null
  localStorage.removeItem(legacyDataKey(userId))
  const records = await snapshots.all(userId)
  // The vault may have locked or switched accounts while storage was read.
  if (session.getUserId() !== userId || session.getStretchKey() !== key) return
  for (const record of records) {
    try { hydrate(client, JSON.parse(decryptSymmetric(JSON.parse(record.blob), key))) }
    catch { /* An unreadable record is replaced by the next successful fetch. */ }
  }
}

// Writes are batched: refetch intervals, focus refetches and sync acknowledgements
// would otherwise re-encrypt the same data many times a minute on a phone.
const FLUSH_DELAY_MS = 2_000
const dirty = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | undefined
// Set while an account removes its offline data, so a late fetch cannot save it again.
let forgotten: string | null = null

/** Write every changed query now. Resolves once storage has accepted it. */
export async function flushOfflineData(client: QueryClient) {
  clearTimeout(flushTimer)
  flushTimer = undefined
  const userId = session.getUserId()
  const key = session.getStretchKey()
  const hashes = [...dirty]
  dirty.clear()
  if (!userId || !key || hashes.length === 0 || userId === forgotten) return
  const writes: SnapshotRecord[] = []
  const removed: string[] = []
  for (const hash of hashes) {
    const query = client.getQueryCache().get(hash)
    const listId = query && offlineListId(query.queryKey)
    if (!query || listId === undefined || query.state.data === undefined) { removed.push(hash); continue }
    const state = dehydrate(client, { shouldDehydrateMutation: () => false, shouldDehydrateQuery: q => q.queryHash === hash })
    writes.push({ userId, hash, listId, blob: JSON.stringify(encryptSymmetric(JSON.stringify(state), key)) })
  }
  try {
    if (writes.length) await snapshots.put(writes)
    if (removed.length) await snapshots.remove(userId, removed)
    offlineStorageStatus.report(null)
  } catch (error) {
    if (session.getUserId() === userId) hashes.forEach(hash => dirty.add(hash))
    offlineStorageStatus.report(error)
  }
}

/** Drop saved data for lists this account can no longer open. */
function pruneRemovedLists(client: QueryClient, lists: unknown) {
  if (!Array.isArray(lists)) return
  const current = new Set(lists.map(list => (list as { id?: unknown })?.id))
  for (const query of client.getQueryCache().getAll()) {
    const listId = offlineListId(query.queryKey)
    if (typeof listId !== 'string' || current.has(listId)) continue
    dirty.add(query.queryHash)
    client.removeQueries({ queryKey: query.queryKey, exact: true })
  }
}

export function watchOfflineData(client: QueryClient) {
  const unsubscribe = client.getQueryCache().subscribe(event => {
    if (event.type !== 'updated' || event.action.type !== 'success') return
    const listId = offlineListId(event.query.queryKey)
    if (listId === undefined) return
    dirty.add(event.query.queryHash)
    if (listId === null && !event.action.manual) pruneRemovedLists(client, event.query.state.data)
    flushTimer ??= setTimeout(() => { void flushOfflineData(client) }, FLUSH_DELAY_MS)
  })
  // A backgrounded phone app may be killed without another chance to save.
  const onHide = () => { if (document.visibilityState === 'hidden') void flushOfflineData(client) }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onHide)
  return () => {
    unsubscribe()
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onHide)
  }
}

/**
 * Remove this account's offline unlock record, saved data and unsynced changes
 * from this device. Signing in online again turns offline unlocking back on.
 */
export async function forgetOfflineDevice() {
  const userId = session.getUserId()
  const key = session.getStretchKey()
  if (!userId || !key) return
  forgotten = userId
  dirty.clear()
  clearTimeout(flushTimer)
  flushTimer = undefined
  const accounts: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const name = localStorage.key(i)
    if (name?.startsWith(ACCOUNT_PREFIX)) accounts.push(name)
  }
  for (const name of accounts) {
    try {
      // Records are only readable with this account's key, so other accounts on the device stay.
      const identity: Identity = JSON.parse(decryptSymmetric(JSON.parse(localStorage.getItem(name)!).identity, key))
      if (identity.userId === userId) localStorage.removeItem(name)
    } catch { /* Another account's record. */ }
  }
  localStorage.removeItem(legacyDataKey(userId))
  offlineQueue.discard(userId)
  await snapshots.clear(userId)
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
    storageError = failures.size ? 'This device could not save an offline copy. Reconnect before closing the app, or free up storage.' : null
    listeners.forEach(listener => listener())
  },
}
