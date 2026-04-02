const QUEUE_KEY = 'tasks:offline_queue'

export type QueuedMutationInput =
  | { type: 'create'; listId: string; encryptedPayload: string }
  | { type: 'update'; listId: string; taskId: string; encryptedPayload: string }
  | { type: 'delete'; listId: string; taskId: string }
  | { type: 'clearDone'; listId: string; taskIds: string[] }

export type QueuedMutation = QueuedMutationInput & { id: string; timestamp: number }

function load(): QueuedMutation[] {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') } catch { return [] }
}

function save(queue: QueuedMutation[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
}

export const offlineQueue = {
  getAll: load,

  add(mutation: QueuedMutationInput) {
    const queue = load()
    queue.push({ ...mutation, id: crypto.randomUUID(), timestamp: Date.now() })
    save(queue)
  },

  remove(id: string) {
    save(load().filter(m => m.id !== id))
  },

  count(): number {
    return load().length
  },
}
