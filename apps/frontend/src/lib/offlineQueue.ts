import { session } from './session.js'

export type QueuedMutationInput =
  | { type: 'create'; listId: string; taskId: string; encryptedPayload: string }
  | { type: 'update'; listId: string; taskId: string; encryptedPayload: string }
  | { type: 'delete'; listId: string; taskId: string }
  | { type: 'clearDone'; listId: string; taskIds: string[] }
  | { type: 'note.create'; listId: string; noteId: string; encryptedPayload: string }
  | { type: 'note.update'; listId: string; noteId: string; encryptedPayload: string }
  | { type: 'note.delete'; listId: string; noteId: string }
  | { type: 'tag.create'; listId: string; tagId: string; encryptedPayload: string }
  | { type: 'tag.update'; listId: string; tagId: string; encryptedPayload: string }
  | { type: 'tag.delete'; listId: string; tagId: string }
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
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(queue))
  } catch (error) {
    if (error instanceof Error && /quota/i.test(error.name + error.message)) {
      throw new Error('This device is out of storage for unsynced changes. Reconnect to sync before making more edits.')
    }
    throw error
  }
  changed()
}

export type NoteMutation = Extract<QueuedMutation, { type: `note.${string}` | `tag.${string}` }>
export type TaskMutation = Exclude<QueuedMutation, NoteMutation>
export function isNoteMutation(m: QueuedMutation): m is NoteMutation {
  return m.type.startsWith('note.') || m.type.startsWith('tag.')
}

/**
 * Autosave writes a fresh ciphertext every few hundred milliseconds of typing.
 * Fold it into the latest pending write for the same note or tag rather than
 * growing the outbox, but never into the head entry: the sync loop may have it
 * in flight, and acknowledging it would discard the newer content.
 */
function coalesce(queue: QueuedMutation[], mutation: QueuedMutationInput): boolean {
  if (mutation.type !== 'note.update' && mutation.type !== 'tag.update') return false
  const kind = mutation.type === 'note.update' ? 'note' : 'tag'
  const entityId = mutation.type === 'note.update' ? mutation.noteId : mutation.tagId
  for (let i = queue.length - 1; i > 0; i--) {
    const m = queue[i]
    if (m.listId !== mutation.listId) continue
    const sameEntity = kind === 'note'
      ? 'noteId' in m && m.noteId === entityId
      : 'tagId' in m && m.tagId === entityId
    if (!sameEntity) continue
    if (m.type === `${kind}.create` || m.type === `${kind}.update`) {
      queue[i] = { ...m, encryptedPayload: mutation.encryptedPayload } as QueuedMutation
      return true
    }
    return false
  }
  return false
}

export const offlineQueue = {
  getAll: load,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  getRevision: () => revision,
  add(mutation: QueuedMutationInput) {
    const userId = session.getUserId()
    if (!userId) throw new Error('Unlock your account before saving changes')
    const queue = load(userId)
    if (!coalesce(queue, mutation)) queue.push({ ...mutation, id: crypto.randomUUID(), timestamp: Date.now() } as QueuedMutation)
    save(queue, userId)
  },
  remove(id: string, userId = session.getUserId()) {
    if (userId) save(load(userId).filter(m => m.id !== id), userId)
  },
  count: () => load().length,
}

export type TaskRow = { id: string; listId: string; encryptedPayload: string; createdAt: number; updatedAt: number }
export function applyQueuedChanges(rows: TaskRow[], listId: string, queue: QueuedMutation[]): TaskRow[] {
  const result = new Map(rows.map(row => [row.id, row]))
  for (const m of queue.filter((m): m is TaskMutation => m.listId === listId && !isNoteMutation(m))) {
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

export type NoteRow = { id: string; listId: string; encryptedPayload: string; createdAt: number; updatedAt: number }

/** Overlay pending note and tag writes on the last server state. */
export function applyQueuedNoteChanges(state: { notes: NoteRow[]; tags: NoteRow[] }, listId: string, queue: QueuedMutation[]) {
  const notes = new Map(state.notes.map(row => [row.id, row]))
  const tags = new Map(state.tags.map(row => [row.id, row]))
  for (const m of queue) {
    if (m.listId !== listId || !isNoteMutation(m)) continue
    const [target, id] = m.type.startsWith('note.') ? [notes, (m as { noteId: string }).noteId] : [tags, (m as { tagId: string }).tagId]
    if (m.type.endsWith('.create') && 'encryptedPayload' in m) {
      if (!target.has(id)) target.set(id, { id, listId, encryptedPayload: m.encryptedPayload, createdAt: m.timestamp, updatedAt: m.timestamp })
    } else if (m.type.endsWith('.update') && 'encryptedPayload' in m) {
      const previous = target.get(id)
      if (previous) target.set(id, { ...previous, encryptedPayload: m.encryptedPayload, updatedAt: m.timestamp })
    } else {
      target.delete(id)
    }
  }
  return { notes: [...notes.values()], tags: [...tags.values()] }
}
