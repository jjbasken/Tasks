import { beforeAll, beforeEach, expect, it } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { initCrypto, generateKdfSalt, deriveStretchKey } from '@tasks/shared'
import { session } from '../src/lib/session.js'
import {
  rememberOfflineAccount, unlockOfflineAccount, flushOfflineData, restoreOfflineData, watchOfflineData,
  forgetOfflineDevice, offlineStorageStatus, setSnapshotStore, type SnapshotRecord,
} from '../src/lib/offlineVault.js'
import { applyQueuedChanges, offlineQueue } from '../src/lib/offlineQueue.js'

const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value) },
  removeItem: (key: string) => storage.delete(key),
  key: (index: number) => [...storage.keys()][index] ?? null,
  get length() { return storage.size },
} })

// Stands in for IndexedDB, which the test runtime lacks.
const records = new Map<string, SnapshotRecord>()
let failWrites = false
setSnapshotStore({
  all: async userId => [...records.values()].filter(r => r.userId === userId),
  put: async rows => {
    if (failWrites) throw new Error('QuotaExceededError')
    rows.forEach(r => records.set(`${r.userId}/${r.hash}`, r))
  },
  remove: async (userId, hashes) => { hashes.forEach(h => records.delete(`${userId}/${h}`)) },
  clear: async userId => { for (const [k, r] of records) if (r.userId === userId) records.delete(k) },
})
const saved = () => [...records.values()].map(r => r.blob).join('') + [...storage.values()].join('')

beforeAll(initCrypto)
beforeEach(() => { storage.clear(); records.clear(); failWrites = false; session.clear(); offlineStorageStatus.report(null) })

async function prepare() {
  const salt = generateKdfSalt()
  const key = await deriveStretchKey('passphrase', salt)
  rememberOfflineAccount('alice', salt, key, { userId: 'alice-id', privateKey: 'secret-private-key', publicKey: 'public-key' })
  session.setUserId('alice-id')
  session.setStretchKey(key)
  return { key, salt }
}

const taskKey = (listId: string) => [['tasks', 'list'], { input: { listId }, type: 'query' }]
const listsKey = [['lists', 'list'], { type: 'query' }]

/** Simulate a fetch: a manual setQueryData does not count as the server's answer. */
function fetched(client: QueryClient, queryKey: readonly unknown[], data: unknown) {
  return client.fetchQuery({ queryKey, queryFn: async () => data, staleTime: 0 })
}

it('unlocks after a cold restart without persisting a token or unwrapped key', async () => {
  await prepare()
  session.setToken('secret-bearer-token')
  session.clear()
  const unlocked = await unlockOfflineAccount('alice', 'passphrase')
  expect(unlocked.userId).toBe('alice-id')
  expect(unlocked.privateKey).toBe('secret-private-key')
  expect(session.getToken()).toBeNull()
  expect(saved()).not.toContain('secret-private-key')
  expect(saved()).not.toContain('secret-bearer-token')
  await expect(unlockOfflineAccount('alice', 'wrong passphrase')).rejects.toThrow('Could not unlock')
  await expect(unlockOfflineAccount('bob', 'passphrase')).rejects.toThrow('Connect and sign in')
})

it('restores visited data and overlays unsynced edits after closing the app', async () => {
  await prepare()
  const client = new QueryClient()
  const unwatch = watchOfflineData(client)
  const rows = [{ id: 'task', listId: 'list', encryptedPayload: 'old', createdAt: 1, updatedAt: 1 }]
  client.setQueryData(taskKey('list'), rows)
  client.setQueryData(listsKey, [{ id: 'list', encryptedName: 'encrypted-name' }])
  client.setQueryData(['notes', 'list'], { notes: [], tags: [], cursor: 42 })
  client.setQueryData([['users', 'me']], { email: 'do-not-save@example.com' })
  client.setQueryData(['unrelated'], 'do-not-save')
  await flushOfflineData(client)
  expect(records.size).toBe(3)
  // The outbox keeps localStorage to itself.
  expect([...storage.keys()].some(k => k.startsWith('tasks:offline_data'))).toBe(false)
  offlineQueue.add({ type: 'update', taskId: 'task', listId: 'list', encryptedPayload: 'new' })
  session.clear()
  const unlocked = await unlockOfflineAccount('alice', 'passphrase')
  session.setUserId(unlocked.userId)
  session.setStretchKey(unlocked.key)
  const restarted = new QueryClient()
  await restoreOfflineData(restarted)
  expect(restarted.getQueryData(['notes', 'list'])).toEqual({ notes: [], tags: [], cursor: 42 })
  expect(restarted.getQueryData(['unrelated'])).toBeUndefined()
  expect(restarted.getQueryData([['users', 'me']])).toBeUndefined()
  expect(applyQueuedChanges(restarted.getQueryData(taskKey('list'))!, 'list', offlineQueue.getAll())[0].encryptedPayload).toBe('new')
  expect(saved()).not.toContain('encrypted-name')
  expect(saved()).not.toContain('do-not-save')
  session.setUserId('bob')
  const other = new QueryClient()
  await restoreOfflineData(other)
  expect(other.getQueryData(taskKey('list'))).toBeUndefined()
  unwatch(); client.clear(); restarted.clear(); other.clear()
})

it('batches writes and rewrites only the query that changed', async () => {
  await prepare()
  const client = new QueryClient()
  const unwatch = watchOfflineData(client)
  try {
    client.setQueryData(['notes', 'a'], { notes: [], tags: [], cursor: 1 })
    client.setQueryData(['notes', 'b'], { notes: [], tags: [], cursor: 1 })
    expect(records.size).toBe(0)
    await flushOfflineData(client)
    const before = new Map([...records].map(([k, r]) => [k, r.blob]))
    for (let cursor = 2; cursor < 20; cursor++) client.setQueryData(['notes', 'a'], { notes: [], tags: [], cursor })
    expect(records.size).toBe(2)
    await flushOfflineData(client)
    const changed = [...records].filter(([k, r]) => before.get(k) !== r.blob)
    expect(changed.length).toBe(1)
    expect(changed[0][1].listId).toBe('a')
  } finally { unwatch(); client.clear() }
})

it('forgets lists the account can no longer open', async () => {
  await prepare()
  const client = new QueryClient()
  const unwatch = watchOfflineData(client)
  try {
    client.setQueryData(taskKey('kept'), [])
    client.setQueryData(taskKey('left'), [])
    client.setQueryData(['notes', 'left'], { notes: [], tags: [], cursor: 1 })
    await fetched(client, listsKey, [{ id: 'kept' }, { id: 'left' }])
    await flushOfflineData(client)
    expect([...records.values()].map(r => String(r.listId)).sort()).toEqual(['kept', 'left', 'left', 'null'])
    await fetched(client, listsKey, [{ id: 'kept' }])
    await flushOfflineData(client)
    expect([...records.values()].map(r => String(r.listId)).sort()).toEqual(['kept', 'null'])
    expect(client.getQueryData(['notes', 'left'])).toBeUndefined()
  } finally { unwatch(); client.clear() }
})

it('reports snapshot storage failures, keeps the last copy, and retries', async () => {
  await prepare()
  const client = new QueryClient()
  const unwatch = watchOfflineData(client)
  try {
    client.setQueryData(['notes', 'list'], { notes: [], tags: [], cursor: 1 })
    await flushOfflineData(client)
    const lastCopy = [...records.values()][0].blob
    failWrites = true
    client.setQueryData(['notes', 'list'], { notes: [], tags: [], cursor: 2 })
    await flushOfflineData(client)
    expect(offlineStorageStatus.getSnapshot()).toContain('could not save an offline copy')
    expect([...records.values()][0].blob).toBe(lastCopy)
    // A full snapshot store never blocks queuing an edit.
    offlineQueue.add({ type: 'delete', taskId: 't', listId: 'list' })
    expect(offlineQueue.count()).toBe(1)
    failWrites = false
    await flushOfflineData(client)
    expect(offlineStorageStatus.getSnapshot()).toBeNull()
    expect([...records.values()][0].blob).not.toBe(lastCopy)
  } finally { unwatch(); client.clear() }
})

it('removes only this account\'s offline data from the device', async () => {
  const salt = generateKdfSalt()
  const bobKey = await deriveStretchKey('other', salt)
  rememberOfflineAccount('bob', salt, bobKey, { userId: 'bob-id', privateKey: 'p', publicKey: 'q' })
  records.set('bob-id/x', { userId: 'bob-id', hash: 'x', listId: null, blob: 'bob' })
  await prepare()
  const client = new QueryClient()
  const unwatch = watchOfflineData(client)
  try {
    client.setQueryData(['notes', 'list'], { notes: [], tags: [], cursor: 1 })
    await flushOfflineData(client)
    offlineQueue.add({ type: 'delete', taskId: 't', listId: 'list' })
    await forgetOfflineDevice()
    // A late refetch after forgetting must not save the data again.
    client.setQueryData(['notes', 'list'], { notes: [], tags: [], cursor: 2 })
    await flushOfflineData(client)
    expect([...records.keys()]).toEqual(['bob-id/x'])
    expect(storage.has('tasks:offline_account:alice')).toBe(false)
    expect(storage.has('tasks:offline_account:bob')).toBe(true)
    expect(offlineQueue.count()).toBe(0)
    await expect(unlockOfflineAccount('alice', 'passphrase')).rejects.toThrow('Connect and sign in')
  } finally { unwatch(); client.clear() }
})

it('keeps offline data unlocked when the server token expires', async () => {
  await prepare()
  session.setToken(`header.${btoa(JSON.stringify({ exp: 1 }))}.signature`)
  expect(session.getToken()).toBeNull()
  expect(session.getUserId()).toBe('alice-id')
  expect(session.getStretchKey()).not.toBeNull()
})
