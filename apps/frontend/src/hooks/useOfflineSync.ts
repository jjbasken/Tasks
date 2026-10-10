import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { trpc } from '../lib/trpc.js'
import { applyQueuedChanges, offlineQueue } from '../lib/offlineQueue.js'
import { session } from '../lib/session.js'
import { drainQueue, sendQueuedMutation } from '../lib/syncQueue.js'
import { useAuth } from './useAuth.js'

export function useOfflineSync() {
  const { isLoggedIn } = useAuth()
  const utils = trpc.useUtils()
  const syncing = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const revision = useSyncExternalStore(offlineQueue.subscribe, offlineQueue.getRevision)
  let pendingCount = 0
  try { pendingCount = offlineQueue.count() } catch { /* sync reports the storage error */ }

  const sync = useCallback(async () => {
    const userId = session.getUserId()
    if (syncing.current || !navigator.onLine || !userId || !isLoggedIn) return
    syncing.current = true
    setError(null)
    const affected = new Set<string>()
    try {
      await drainQueue({
        next: () => offlineQueue.getAll(userId)[0],
        canContinue: () => navigator.onLine && session.getUserId() === userId,
        send: mutation => sendQueuedMutation(utils.client.tasks, mutation),
        acknowledge: mutation => {
          if (session.getUserId() === userId) {
            utils.tasks.list.setData({ listId: mutation.listId }, rows => applyQueuedChanges(rows ?? [], mutation.listId, [mutation]))
          }
          offlineQueue.remove(mutation.id, userId)
          affected.add(mutation.listId)
        },
      })
    } catch (err: any) {
      setError(err?.data?.code === 'UNAUTHORIZED'
        ? 'Unlock your account again to sync. Your changes are saved on this device.'
        : 'Changes are saved on this device. Sync failed; retry when the connection or access is restored.')
    } finally {
      syncing.current = false
      if (session.getUserId() === userId) {
        affected.forEach(listId => { utils.tasks.list.invalidate({ listId }) })
      }
    }
  }, [isLoggedIn, utils])

  useEffect(() => {
    sync()
    const retry = () => { sync() }
    window.addEventListener('online', retry)
    const interval = window.setInterval(retry, 30_000)
    return () => { window.removeEventListener('online', retry); window.clearInterval(interval) }
  }, [sync])
  useEffect(() => { if (pendingCount > 0) sync() }, [revision, isLoggedIn, sync])

  return { pendingCount, error, sync }
}
