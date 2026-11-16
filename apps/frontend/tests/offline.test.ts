import { beforeEach, describe, expect, it } from 'bun:test'
import { session } from '../src/lib/session.js'
import { offlineQueue, applyQueuedChanges } from '../src/lib/offlineQueue.js'
import { drainQueue, sendQueuedMutation } from '../src/lib/syncQueue.js'

const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value) },
  removeItem: (key: string) => storage.delete(key),
} })
beforeEach(() => { storage.clear(); session.clear(); session.setUserId('alice') })

const replay = (send: (mutation: any) => Promise<void>) => drainQueue({
  next: () => offlineQueue.getAll()[0], send,
  acknowledge: mutation => offlineQueue.remove(mutation.id), canContinue: () => true,
})

describe('durable task changes', () => {
  it('keeps a failed operation and subsequent changes until a successful retry', async () => {
    offlineQueue.add({ type: 'create', taskId: 'stable-id', listId: 'list', encryptedPayload: 'original' })
    offlineQueue.add({ type: 'update', taskId: 'stable-id', listId: 'list', encryptedPayload: 'edited' })
    await expect(replay(async () => { throw new Error('server unavailable') })).rejects.toThrow()
    expect(offlineQueue.count()).toBe(2)
    const sent: string[] = []
    await replay(async mutation => { sent.push(mutation.type) })
    expect(sent).toEqual(['create', 'update'])
    expect(offlineQueue.count()).toBe(0)
  })

  it('keeps create/edit/delete references stable and reconstructs pending edits after a fetch', async () => {
    offlineQueue.add({ type: 'create', taskId: 'stable-id', listId: 'list', encryptedPayload: 'original' })
    offlineQueue.add({ type: 'update', taskId: 'stable-id', listId: 'list', encryptedPayload: 'edited' })
    expect(applyQueuedChanges([], 'list', offlineQueue.getAll())[0].encryptedPayload).toBe('edited')
    offlineQueue.add({ type: 'delete', taskId: 'stable-id', listId: 'list' })
    expect(applyQueuedChanges([], 'list', offlineQueue.getAll())).toHaveLength(0)
    const sent: any[] = []
    const capture = { mutate: async (input: unknown) => { sent.push(input) } }
    const api = { create: capture, update: capture, delete: capture, clearDone: capture }
    await replay(mutation => sendQueuedMutation(api, mutation))
    expect(sent.map(input => input.taskId)).toEqual(['stable-id', 'stable-id', 'stable-id'])
  })

  it('separates work by account and preserves it while locked', () => {
    offlineQueue.add({ type: 'delete', taskId: 'alice-task', listId: 'list' })
    session.clear()
    expect(offlineQueue.count()).toBe(0)
    session.setUserId('bob')
    expect(offlineQueue.count()).toBe(0)
    session.setUserId('alice')
    expect(offlineQueue.count()).toBe(1)
  })

  it('only acknowledges already-deleted tasks, not authentication or server failures', async () => {
    const unused = { mutate: async () => {} }
    const api = { create: unused, update: unused, clearDone: unused, delete: { mutate: async () => { throw { data: { code: 'NOT_FOUND' } } } } }
    offlineQueue.add({ type: 'delete', taskId: 'id', listId: 'list' })
    await replay(mutation => sendQueuedMutation(api, mutation))
    expect(offlineQueue.count()).toBe(0)
    api.delete.mutate = async () => { throw { data: { code: 'UNAUTHORIZED' } } }
    offlineQueue.add({ type: 'delete', taskId: 'id', listId: 'list' })
    await expect(replay(mutation => sendQueuedMutation(api, mutation))).rejects.toBeDefined()
    expect(offlineQueue.count()).toBe(1)
  })

  it('does not replace unreadable saved work with an empty queue', () => {
    storage.set('tasks:offline_queue:alice', '{broken')
    expect(() => offlineQueue.add({ type: 'delete', taskId: 'id', listId: 'list' })).toThrow()
    expect(storage.get('tasks:offline_queue:alice')).toBe('{broken')
  })
})

it('never persists unlocked credentials and clears them on lock', () => {
  const key = new Uint8Array(32).fill(42)
  session.setToken('bearer-token')
  session.setStretchKey(key)
  const storedKey = session.getStretchKey()!
  session.setPrivateKey('private-key')
  session.setPublicKey('public-key')
  expect([...storage.keys()]).toHaveLength(0)
  expect(session.getPrivateKey()).toBe('private-key')
  session.clear()
  expect(session.getToken()).toBeNull()
  expect(session.getStretchKey()).toBeNull()
  expect(session.getPrivateKey()).toBeNull()
  expect(storedKey.every(byte => byte === 0)).toBe(true)
})

it('keeps the failed tail of a partially replayed queue', async () => {
  offlineQueue.add({ type: 'create', taskId: 'stable-id', listId: 'list', encryptedPayload: 'original' })
  offlineQueue.add({ type: 'update', taskId: 'stable-id', listId: 'list', encryptedPayload: 'edited' })
  offlineQueue.add({ type: 'delete', taskId: 'stable-id', listId: 'list' })
  await expect(replay(async mutation => {
    if (mutation.type === 'update') throw new Error('connection interrupted')
  })).rejects.toThrow()
  expect(offlineQueue.getAll().map(mutation => mutation.type)).toEqual(['update', 'delete'])
})
