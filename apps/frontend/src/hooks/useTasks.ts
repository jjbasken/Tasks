import { trpc } from '../lib/trpc.js'
import { encryptSymmetric, decryptSymmetric, fromBase64 } from '@tasks/shared'
import type { TaskPayload } from '@tasks/shared'

export type DecryptedTask = TaskPayload & { id: string; createdAt: number; updatedAt: number }

/** Returns decrypted tasks for a list. listKeyB64 is a base64 raw list key (already decrypted from membership). */
export function useTaskList(listId: string, listKeyB64: string | null) {
  return trpc.tasks.list.useQuery(
    { listId },
    {
      enabled: !!listId && !!listKeyB64,
      select: (rows) => {
        if (!listKeyB64) return []
        const key = fromBase64(listKeyB64)
        return rows.flatMap(row => {
          try {
            const blob = JSON.parse(row.encryptedPayload)
            const payload: TaskPayload = JSON.parse(decryptSymmetric(blob, key))
            return [{ id: row.id, createdAt: row.createdAt, updatedAt: row.updatedAt, ...payload }]
          } catch {
            return []  // skip rows that fail to decrypt (e.g. wrong key)
          }
        })
      },
    }
  )
}

/** Returns a function to create an encrypted task. Caller is responsible for providing the raw list key. */
export function useCreateTask(listId: string) {
  const utils = trpc.useUtils()
  const mutation = trpc.tasks.create.useMutation({
    onSuccess: () => utils.tasks.list.invalidate({ listId }),
  })
  return {
    ...mutation,
    mutateAsync: async (payload: TaskPayload, listKeyB64: string) => {
      const key = fromBase64(listKeyB64)
      const blob = encryptSymmetric(JSON.stringify(payload), key)
      return mutation.mutateAsync({ listId, encryptedPayload: JSON.stringify(blob) })
    },
  }
}

export function useUpdateTask(listId: string) {
  const utils = trpc.useUtils()
  const mutation = trpc.tasks.update.useMutation({
    onSuccess: () => utils.tasks.list.invalidate({ listId }),
  })
  return {
    ...mutation,
    mutateAsync: async (taskId: string, payload: TaskPayload, listKeyB64: string) => {
      const key = fromBase64(listKeyB64)
      const blob = encryptSymmetric(JSON.stringify(payload), key)
      return mutation.mutateAsync({ taskId, encryptedPayload: JSON.stringify(blob) })
    },
  }
}

export function useDeleteTask(listId: string) {
  const utils = trpc.useUtils()
  return trpc.tasks.delete.useMutation({
    onSuccess: () => utils.tasks.list.invalidate({ listId }),
  })
}
