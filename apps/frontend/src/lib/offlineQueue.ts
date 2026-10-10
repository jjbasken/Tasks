import { session } from './session.js'

export type QueuedMutationInput =
  | { type: 'create'; listId: string; taskId: string; encryptedPayload: string }
  | { type: 'update'; listId: string; taskId: string; encryptedPayload: string }
  | { type: 'delete'; listId: string; taskId: string }
  | { type: 'clearDone'; listId: string; taskIds: string[] }
export type QueuedMutation = QueuedMutationInput & { id: string; timestamp: number }

const listeners = new Set<() => void>()
let revision = 0
function changed() { revision++; listeners.forEach(listener => listener()) }
function storageKey(userId: string) { return `tasks:offline_queue:${userId}` }
function load(userId = session.getUserId()): QueuedMutation[] {
  if (!userId) return []
  const queue = JSON.parse(localStorage.getItem(storageKey(userId)) ?? '[]')
  if (!Array.isArray(queue)) throw new Error('Saved changes could not be read. Your local data has been preserved.')
  return queue
}
function save(queue: QueuedMutation[], userId: string) {
  localStorage.setItem(storageKey(userId), JSON.stringify(queue))
  changed()
}

export const offlineQueue = {
  getAll: load,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  getRevision: () => revision,
  add(mutation: QueuedMutationInput) {
    const userId = session.getUserId()
    if (!userId) throw new Error('Unlock your account before saving changes')
    save([...load(userId), { ...mutation, id: crypto.randomUUID(), timestamp: Date.now() }], userId)
  },
  remove(id: string, userId = session.getUserId()) {
    if (userId) save(load(userId).filter(m => m.id !== id), userId)
  },
  count: () => load().length,
}

export type TaskRow = { id: string; listId: string; encryptedPayload: string; createdAt: number; updatedAt: number }
export function applyQueuedChanges(rows: TaskRow[], listId: string, queue: QueuedMutation[]): TaskRow[] {
  const result = new Map(rows.map(row => [row.id, row]))
  for (const m of queue.filter(m => m.listId === listId)) {
    if (m.type === 'create') {
      if (!result.has(m.taskId)) result.set(m.taskId, { id: m.taskId, listId, encryptedPayload: m.encryptedPayload, createdAt: m.timestamp, updatedAt: m.timestamp })
    } else if (m.type === 'update') {
      const previous = result.get(m.taskId)
      if (previous) result.set(m.taskId, { ...previous, encryptedPayload: m.encryptedPayload, updatedAt: m.timestamp })
    } else if (m.type === 'delete') {
      result.delete(m.taskId)
    } else {
      m.taskIds.forEach(id => result.delete(id))
    }
  }
  return [...result.values()]
}
