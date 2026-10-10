import type { QueuedMutation } from './offlineQueue.js'

type TaskApi = {
  create: { mutate: (input: { taskId: string; listId: string; encryptedPayload: string }) => Promise<unknown> }
  update: { mutate: (input: { taskId: string; encryptedPayload: string }) => Promise<unknown> }
  delete: { mutate: (input: { taskId: string }) => Promise<unknown> }
  clearDone: { mutate: (input: { listId: string; taskIds: string[] }) => Promise<unknown> }
}

export async function sendQueuedMutation(api: TaskApi, mutation: QueuedMutation) {
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
