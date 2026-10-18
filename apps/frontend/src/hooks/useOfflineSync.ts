import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { trpc } from '../lib/trpc.js'
import { useQueryClient } from '@tanstack/react-query'
import { applyQueuedChanges, applyQueuedNoteChanges, isNoteMutation, offlineQueue } from '../lib/offlineQueue.js'
import { session } from '../lib/session.js'
import { drainQueue, sendQueuedMutation, sendQueuedNoteMutation } from '../lib/syncQueue.js'
import { notesQueryKey, type NotesCache } from './useNotes.js'
import { useAuth } from './useAuth.js'

// One replay loop per tab, however many components ask for sync. Callers that
// need the outbox drained (attachments, moves) await the run in progress.
let syncing: Promise<void> | null = null

export function useOfflineSync() {
  const { isLoggedIn } = useAuth()
  const utils = trpc.useUtils()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const revision = useSyncExternalStore(offlineQueue.subscribe, offlineQueue.getRevision)
  let pendingCount = 0
  try { pendingCount = offlineQueue.count() } catch { /* sync reports the storage error */ }

  const sync = useCallback((): Promise<void> => {
    if (syncing) return syncing
    const userId = session.getUserId()
    const run = navigator.locks && userId
      ? navigator.locks.request(`tasks:sync:${userId}`, () => replay())
      : replay()
    syncing = run.finally(() => { syncing = null })
    return syncing
  }, [isLoggedIn, utils, queryClient])

  async function replay() {
    const userId = session.getUserId()
    if (!navigator.onLine || !userId || !isLoggedIn || !session.getToken()) return
    setError(null)
    const affected = new Set<string>()
    const affectedNotes = new Set<string>()
    try {
      await drainQueue({
        next: () => offlineQueue.getAll(userId)[0],
        canContinue: () => navigator.onLine && session.getUserId() === userId && !!session.getToken(),
        send: mutation => isNoteMutation(mutation)
          ? sendQueuedNoteMutation(utils.client, mutation)
          : sendQueuedMutation(utils.client.tasks, mutation),
        acknowledge: mutation => {
          // Fold the acknowledged write into the cached server state first, so
          // removing it from the outbox does not flash the previous version.
          if (session.getUserId() === userId) {
            if (isNoteMutation(mutation)) {
              queryClient.setQueryData<NotesCache>(notesQueryKey(mutation.listId), cache => cache && { ...cache, ...applyQueuedNoteChanges(cache, mutation.listId, [mutation]) })
            } else {
              utils.tasks.list.setData({ listId: mutation.listId }, rows => applyQueuedChanges(rows ?? [], mutation.listId, [mutation]))
            }
          }
          offlineQueue.remove(mutation.id, userId)
          ;(isNoteMutation(mutation) ? affectedNotes : affected).add(mutation.listId)
        },
      })
    } catch (err: any) {
      setError(err?.data?.code === 'UNAUTHORIZED'
        ? 'Unlock your account again to sync. Your changes are saved on this device.'
        : 'Changes are saved on this device. Sync failed; retry when the connection or access is restored.')
    } finally {
      if (session.getUserId() === userId) {
        affected.forEach(listId => { utils.tasks.list.invalidate({ listId }) })
        affectedNotes.forEach(listId => { queryClient.invalidateQueries({ queryKey: notesQueryKey(listId) }) })
      }
    }
  }

  useEffect(() => {
    sync()
    const retry = () => { sync() }
    const resume = () => { if (document.visibilityState === 'visible') retry() }
    window.addEventListener('online', retry)
    window.addEventListener('pageshow', retry)
    document.addEventListener('visibilitychange', resume)
    const interval = window.setInterval(retry, 30_000)
    return () => { window.removeEventListener('online', retry); window.removeEventListener('pageshow', retry); document.removeEventListener('visibilitychange', resume); window.clearInterval(interval) }
  }, [sync])
  useEffect(() => { if (pendingCount > 0) sync() }, [revision, isLoggedIn, sync])

  return { pendingCount, error, sync }
}
