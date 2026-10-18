import { beforeAll, beforeEach, expect, it } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { initCrypto, generateKdfSalt, deriveStretchKey } from '@tasks/shared'
import { session } from '../src/lib/session.js'
import { rememberOfflineAccount, unlockOfflineAccount, persistOfflineData, restoreOfflineData, watchOfflineData, offlineStorageStatus } from '../src/lib/offlineVault.js'
import { applyQueuedChanges, offlineQueue } from '../src/lib/offlineQueue.js'

const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value) },
  removeItem: (key: string) => storage.delete(key),
} })
beforeAll(initCrypto)
beforeEach(() => { storage.clear(); session.clear(); offlineStorageStatus.report(null) })

async function prepare() {
  const salt = generateKdfSalt()
  const key = await deriveStretchKey('passphrase', salt)
  rememberOfflineAccount('alice', salt, key, { userId: 'alice-id', privateKey: 'secret-private-key', publicKey: 'public-key' })
  session.setUserId('alice-id')
  session.setStretchKey(key)
  return { key, salt }
}

it('unlocks after a cold restart without persisting a token or unwrapped key', async () => {
  await prepare()
  session.setToken('secret-bearer-token')
  session.clear()
  const saved = await unlockOfflineAccount('alice', 'passphrase')
  expect(saved.userId).toBe('alice-id')
  expect(saved.privateKey).toBe('secret-private-key')
  expect(session.getToken()).toBeNull()
  const serialized = [...storage.values()].join('')
  expect(serialized).not.toContain('secret-private-key')
  expect(serialized).not.toContain('secret-bearer-token')
  await expect(unlockOfflineAccount('alice', 'wrong passphrase')).rejects.toThrow('Could not unlock')
  await expect(unlockOfflineAccount('bob', 'passphrase')).rejects.toThrow('Connect and sign in')
})

it('restores visited data and overlays unsynced edits after closing the app', async () => {
  await prepare()
  const client = new QueryClient()
  const taskKey = [['tasks', 'list'], { input: { listId: 'list' }, type: 'query' }]
  const rows = [{ id: 'task', listId: 'list', encryptedPayload: 'old', createdAt: 1, updatedAt: 1 }]
  client.setQueryData(taskKey, rows)
  client.setQueryData([['lists', 'list'], { type: 'query' }], [{ id: 'list', encryptedName: 'encrypted-name' }])
  client.setQueryData(['notes', 'list'], { notes: [], tags: [], cursor: 42 })
  client.setQueryData([['users', 'me']], { email: 'do-not-save@example.com' })
  client.setQueryData(['unrelated'], 'do-not-save')
  persistOfflineData(client)
  offlineQueue.add({ type: 'update', taskId: 'task', listId: 'list', encryptedPayload: 'new' })
  session.clear()
  const saved = await unlockOfflineAccount('alice', 'passphrase')
  session.setUserId(saved.userId)
  session.setStretchKey(saved.key)
  const restarted = new QueryClient()
  restoreOfflineData(restarted)
  expect(restarted.getQueryData(['notes', 'list'])).toEqual({ notes: [], tags: [], cursor: 42 })
  expect(restarted.getQueryData(['unrelated'])).toBeUndefined()
  expect(restarted.getQueryData([['users', 'me']])).toBeUndefined()
  expect(applyQueuedChanges(restarted.getQueryData(taskKey)!, 'list', offlineQueue.getAll())[0].encryptedPayload).toBe('new')
  expect([...storage.values()].join('')).not.toContain('encrypted-name')
  session.setUserId('bob')
  const other = new QueryClient()
  restoreOfflineData(other)
  expect(other.getQueryData(taskKey)).toBeUndefined()
  client.clear(); restarted.clear(); other.clear()
})

it('reports snapshot storage failures without disrupting live data or overwriting the last copy', async () => {
  await prepare()
  const client = new QueryClient()
  client.setQueryData(['notes', 'list'], { notes: [], tags: [], cursor: 1 })
  persistOfflineData(client)
  const lastCopy = storage.get('tasks:offline_data:alice-id')
  const unsubscribe = watchOfflineData(client)
  const original = localStorage.setItem
  localStorage.setItem = () => { throw new Error('QuotaExceededError') }
  try {
    client.setQueryData(['notes', 'list'], { notes: [], tags: [], cursor: 2 })
    expect(offlineStorageStatus.getSnapshot()).toContain('storage is unavailable or full')
    expect(storage.get('tasks:offline_data:alice-id')).toBe(lastCopy)
  } finally { localStorage.setItem = original; unsubscribe(); client.clear() }
})

it('keeps offline data unlocked when the server token expires', async () => {
  await prepare()
  session.setToken(`header.${btoa(JSON.stringify({ exp: 1 }))}.signature`)
  expect(session.getToken()).toBeNull()
  expect(session.getUserId()).toBe('alice-id')
  expect(session.getStretchKey()).not.toBeNull()
})
