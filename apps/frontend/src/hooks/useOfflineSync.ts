import { useEffect, useRef, useState } from 'react'
import { trpc } from '../lib/trpc.js'
import { offlineQueue } from '../lib/offlineQueue.js'

export function useOfflineSync() {
  const utils = trpc.useUtils()
  const syncing = useRef(false)
  const [pendingCount, setPendingCount] = useState(() => offlineQueue.count())

  async function sync() {
    if (syncing.current || !navigator.onLine) return
    const queue = offlineQueue.getAll()
    if (queue.length === 0) return

    syncing.current = true
    const affectedListIds = new Set<string>()

    try {
      for (const m of queue) {
        if (!navigator.onLine) break
        try {
          if (m.type === 'create') {
            await utils.client.tasks.create.mutate({ listId: m.listId, encryptedPayload: m.encryptedPayload })
          } else if (m.type === 'update') {
            await utils.client.tasks.update.mutate({ taskId: m.taskId, encryptedPayload: m.encryptedPayload })
          } else if (m.type === 'delete') {
            await utils.client.tasks.delete.mutate({ taskId: m.taskId })
          } else if (m.type === 'clearDone') {
            await utils.client.tasks.clearDone.mutate({ listId: m.listId, taskIds: m.taskIds })
          }
          offlineQueue.remove(m.id)
          affectedListIds.add(m.listId)
        } catch {
          // If we're still online it's likely a conflict (e.g. task deleted elsewhere) — skip it
          if (navigator.onLine) {
            offlineQueue.remove(m.id)
            affectedListIds.add(m.listId)
          } else {
            break
          }
        }
      }
    } finally {
      syncing.current = false
      setPendingCount(offlineQueue.count())
    }

    for (const listId of affectedListIds) {
      utils.tasks.list.invalidate({ listId })
    }
  }

  // Sync on reconnect
  useEffect(() => {
    const handleOnline = () => sync()
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [])

  // Sync on mount if there's a queue and we're online
  useEffect(() => {
    if (navigator.onLine && offlineQueue.count() > 0) sync()
  }, [])

  return { pendingCount, sync }
}
