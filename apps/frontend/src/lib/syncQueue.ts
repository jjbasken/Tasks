import type { NoteMutation, QueuedMutation, TaskMutation } from './offlineQueue.js'

type TaskApi = {
  create: { mutate: (input: { taskId: string; listId: string; encryptedPayload: string }) => Promise<unknown> }
  update: { mutate: (input: { taskId: string; encryptedPayload: string }) => Promise<unknown> }
  delete: { mutate: (input: { taskId: string }) => Promise<unknown> }
  clearDone: { mutate: (input: { listId: string; taskIds: string[] }) => Promise<unknown> }
}

export async function sendQueuedMutation(api: TaskApi, mutation: TaskMutation) {
  if (mutation.type === 'create') {
    await api.create.mutate({ taskId: mutation.taskId, listId: mutation.listId, encryptedPayload: mutation.encryptedPayload })
  } else if (mutation.type === 'update') {
    await api.update.mutate({ taskId: mutation.taskId, encryptedPayload: mutation.encryptedPayload })
  } else if (mutation.type === 'delete') {
    try {
      await api.delete.mutate({ taskId: mutation.taskId })
    } catch (error: any) {
      // A delete may have succeeded before its response was lost.
      if (error?.data?.code !== 'NOT_FOUND') throw error
    }
  } else {
    await api.clearDone.mutate({ listId: mutation.listId, taskIds: mutation.taskIds })
  }
}

type NoteApi = {
  notes: {
    create: { mutate: (input: { id: string; listId: string; encryptedPayload: string }) => Promise<unknown> }
    update: { mutate: (input: { noteId: string; listId: string; encryptedPayload: string }) => Promise<unknown> }
    delete: { mutate: (input: { noteId: string; listId: string }) => Promise<unknown> }
  }
  tags: {
    create: { mutate: (input: { id: string; listId: string; encryptedPayload: string }) => Promise<unknown> }
    update: { mutate: (input: { tagId: string; encryptedPayload: string }) => Promise<unknown> }
    delete: { mutate: (input: { tagId: string }) => Promise<unknown> }
  }
}

/** A note or tag another member deleted for good; the deletion wins over a stale write. */
async function ignoreMissing(send: Promise<unknown>) {
  try {
    await send
  } catch (error: any) {
    if (error?.data?.code !== 'NOT_FOUND') throw error
  }
}

export async function sendQueuedNoteMutation(api: NoteApi, m: NoteMutation) {
  switch (m.type) {
    case 'note.create': return void await api.notes.create.mutate({ id: m.noteId, listId: m.listId, encryptedPayload: m.encryptedPayload })
    case 'note.update': return ignoreMissing(api.notes.update.mutate({ noteId: m.noteId, listId: m.listId, encryptedPayload: m.encryptedPayload }))
    case 'note.delete': return ignoreMissing(api.notes.delete.mutate({ noteId: m.noteId, listId: m.listId }))
    case 'tag.create': return void await api.tags.create.mutate({ id: m.tagId, listId: m.listId, encryptedPayload: m.encryptedPayload })
    case 'tag.update': return ignoreMissing(api.tags.update.mutate({ tagId: m.tagId, encryptedPayload: m.encryptedPayload }))
    case 'tag.delete': return ignoreMissing(api.tags.delete.mutate({ tagId: m.tagId }))
  }
}

// Preserve ordering and all unsent work after any error. Online status alone
// says nothing about the API's availability or the session's validity.
export async function drainQueue(options: {
  next: () => QueuedMutation | undefined
  send: (mutation: QueuedMutation) => Promise<void>
  acknowledge: (mutation: QueuedMutation) => void
  canContinue: () => boolean
}) {
  while (options.canContinue()) {
    const mutation = options.next()
    if (!mutation) return
    await options.send(mutation)
    options.acknowledge(mutation)
  }
}
