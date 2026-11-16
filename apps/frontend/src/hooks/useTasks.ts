import { useMemo, useSyncExternalStore } from 'react'
import { trpc } from '../lib/trpc.js'
import { encryptSymmetric, decryptSymmetric, fromBase64 } from '@tasks/shared'
import type { TaskPayload } from '@tasks/shared'
import { applyQueuedChanges, offlineQueue } from '../lib/offlineQueue.js'

export type DecryptedTask = TaskPayload & { id: string; createdAt: number; updatedAt: number }

export function useTaskList(listId: string, listKeyB64: string | null) {
  const revision = useSyncExternalStore(offlineQueue.subscribe, offlineQueue.getRevision)
  const query = trpc.tasks.list.useQuery({ listId }, { enabled: !!listId && !!listKeyB64 })
  const data = useMemo(() => {
    if (!listKeyB64) return []
    const key = fromBase64(listKeyB64)
    return applyQueuedChanges(query.data ?? [], listId, offlineQueue.getAll()).flatMap(row => {
      try {
        const payload: TaskPayload = JSON.parse(decryptSymmetric(JSON.parse(row.encryptedPayload), key))
        return [{ ...payload, id: row.id, createdAt: row.createdAt, updatedAt: row.updatedAt }]
      } catch { return [] }
    })
  }, [query.data, listId, listKeyB64, revision])
  return { ...query, data }
}

function encryptTask(payload: TaskPayload, listKey: string) {
  const encrypted = JSON.stringify(encryptSymmetric(JSON.stringify(payload), fromBase64(listKey)))
  if (encrypted.length > 64 * 1024) throw new Error('This task is too large. Shorten the title or notes before saving.')
  return encrypted
}

// Persist the encrypted operation before presenting it as saved. One ordered
// outbox handles online writes and retries as well as disconnected edits.
export function useCreateTask(listId: string) {
  return {
    mutateAsync: async (payload: TaskPayload, listKeyB64: string) => {
      const taskId = crypto.randomUUID()
      offlineQueue.add({ type: 'create', listId, taskId, encryptedPayload: encryptTask(payload, listKeyB64) })
      return { id: taskId }
    },
  }
}
export function useUpdateTask(listId: string) {
  return {
    mutateAsync: async (taskId: string, payload: TaskPayload, listKeyB64: string) => {
      offlineQueue.add({ type: 'update', listId, taskId, encryptedPayload: encryptTask(payload, listKeyB64) })
    },
  }
}
export function useDeleteTask(listId: string) {
  return { mutate: ({ taskId }: { taskId: string }) => offlineQueue.add({ type: 'delete', listId, taskId }) }
}
export function useClearDone(listId: string) {
  const mutate = (vars: { listId: string; taskIds: string[] }) => {
    // Respect the server batch bound even for a list with thousands of tasks.
    for (let i = 0; i < vars.taskIds.length; i += 1000) {
      offlineQueue.add({ type: 'clearDone', listId, taskIds: vars.taskIds.slice(i, i + 1000) })
    }
  }
  return { mutate, mutateAsync: async (vars: { listId: string; taskIds: string[] }) => { mutate(vars) } }
}
