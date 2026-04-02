import { trpc } from '../lib/trpc.js'
import { encryptSymmetric, decryptSymmetric, fromBase64 } from '@tasks/shared'
import type { TaskPayload } from '@tasks/shared'
import { offlineQueue } from '../lib/offlineQueue.js'

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
            return [{ ...payload, id: row.id, createdAt: row.createdAt, updatedAt: row.updatedAt }]
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
  const mutation = trpc.tasks.create.useMutation()

  return {
    ...mutation,
    mutateAsync: async (payload: TaskPayload, listKeyB64: string) => {
      const key = fromBase64(listKeyB64)
      const blob = encryptSymmetric(JSON.stringify(payload), key)
      const encryptedPayload = JSON.stringify(blob)
      const tempId = `temp-${crypto.randomUUID()}`
      const now = Date.now()

      // Optimistic update — add encrypted row so the select transform can decrypt and show it
      utils.tasks.list.setData({ listId }, (old) => [
        ...(old ?? []),
        { id: tempId, listId, encryptedPayload, createdAt: now, updatedAt: now },
      ])

      try {
        const result = await mutation.mutateAsync({ listId, encryptedPayload })
        await utils.tasks.list.invalidate({ listId })
        return result
      } catch {
        // Roll back optimistic entry
        utils.tasks.list.setData({ listId }, (old) => old?.filter(t => t.id !== tempId))

        if (!navigator.onLine) {
          offlineQueue.add({ type: 'create', listId, encryptedPayload })
          // Re-add the temp task so the user can see it while offline
          utils.tasks.list.setData({ listId }, (old) => [
            ...(old ?? []),
            { id: tempId, listId, encryptedPayload, createdAt: now, updatedAt: now },
          ])
          return { id: tempId }
        }
        throw new Error('Failed to create task')
      }
    },
  }
}

export function useUpdateTask(listId: string) {
  const utils = trpc.useUtils()
  const mutation = trpc.tasks.update.useMutation()

  return {
    ...mutation,
    mutateAsync: async (taskId: string, payload: TaskPayload, listKeyB64: string) => {
      const key = fromBase64(listKeyB64)
      const blob = encryptSymmetric(JSON.stringify(payload), key)
      const encryptedPayload = JSON.stringify(blob)

      // Optimistic update — replace the encrypted payload for this row
      const prev = utils.tasks.list.getData({ listId })
      utils.tasks.list.setData({ listId }, (old) =>
        old?.map(t => t.id === taskId ? { ...t, encryptedPayload, updatedAt: Date.now() } : t)
      )

      try {
        await mutation.mutateAsync({ taskId, encryptedPayload })
        utils.tasks.list.invalidate({ listId })
      } catch {
        // Roll back
        utils.tasks.list.setData({ listId }, () => prev)

        if (!navigator.onLine) {
          offlineQueue.add({ type: 'update', listId, taskId, encryptedPayload })
          // Re-apply the optimistic update so the user sees their change
          utils.tasks.list.setData({ listId }, (old) =>
            old?.map(t => t.id === taskId ? { ...t, encryptedPayload, updatedAt: Date.now() } : t)
          )
          return
        }
        throw new Error('Failed to update task')
      }
    },
  }
}

export function useDeleteTask(listId: string) {
  const utils = trpc.useUtils()
  const mutation = trpc.tasks.delete.useMutation()

  return {
    ...mutation,
    mutate: ({ taskId }: { taskId: string }) => {
      const prev = utils.tasks.list.getData({ listId })
      utils.tasks.list.setData({ listId }, (old) => old?.filter(t => t.id !== taskId))

      mutation.mutate({ taskId }, {
        onSuccess: () => utils.tasks.list.invalidate({ listId }),
        onError: () => {
          utils.tasks.list.setData({ listId }, () => prev)
          if (!navigator.onLine) {
            offlineQueue.add({ type: 'delete', listId, taskId })
            utils.tasks.list.setData({ listId }, (old) => old?.filter(t => t.id !== taskId))
          }
        },
      })
    },
  }
}

export function useClearDone(listId: string) {
  const utils = trpc.useUtils()
  const mutation = trpc.tasks.clearDone.useMutation()

  return {
    ...mutation,
    mutate: (vars: { listId: string; taskIds: string[] }) => {
      const prev = utils.tasks.list.getData({ listId })
      utils.tasks.list.setData({ listId }, (old) => old?.filter(t => !vars.taskIds.includes(t.id)))

      mutation.mutate(vars, {
        onSuccess: () => utils.tasks.list.invalidate({ listId }),
        onError: () => {
          utils.tasks.list.setData({ listId }, () => prev)
          if (!navigator.onLine) {
            offlineQueue.add({ type: 'clearDone', listId, taskIds: vars.taskIds })
            utils.tasks.list.setData({ listId }, (old) => old?.filter(t => !vars.taskIds.includes(t.id)))
          }
        },
      })
    },
    mutateAsync: async (vars: { listId: string; taskIds: string[] }) => {
      const prev = utils.tasks.list.getData({ listId })
      utils.tasks.list.setData({ listId }, (old) => old?.filter(t => !vars.taskIds.includes(t.id)))

      try {
        await mutation.mutateAsync(vars)
        utils.tasks.list.invalidate({ listId })
      } catch {
        utils.tasks.list.setData({ listId }, () => prev)
        if (!navigator.onLine) {
          offlineQueue.add({ type: 'clearDone', listId, taskIds: vars.taskIds })
          utils.tasks.list.setData({ listId }, (old) => old?.filter(t => !vars.taskIds.includes(t.id)))
          return
        }
        throw new Error('Failed to clear done tasks')
      }
    },
  }
}
