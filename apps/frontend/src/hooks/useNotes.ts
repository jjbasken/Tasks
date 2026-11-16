import { useMemo, useRef, useSyncExternalStore } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { decryptSymmetric, encryptSymmetric, fromBase64 } from '@tasks/shared'
import type { NotePayload, TagPayload } from '@tasks/shared'
import { trpc } from '../lib/trpc.js'
import { applyQueuedNoteChanges, offlineQueue, type NoteRow } from '../lib/offlineQueue.js'
import { resolveListKey } from '../lib/listKeys.js'
import { normalizeNote, stripNote, type DecryptedNote, type DecryptedTag } from '../lib/notesModel.js'
import type { DecryptedList } from './useLists.js'

export type NotesCache = { notes: NoteRow[]; tags: NoteRow[]; cursor: number }
export const notesQueryKey = (listId: string) => ['notes', listId] as const

const MAX_NOTE_CIPHERTEXT = 2 * 1024 * 1024

export function encryptNote(payload: NotePayload, listKey: string) {
  const encrypted = JSON.stringify(encryptSymmetric(JSON.stringify(payload), fromBase64(listKey)))
  if (encrypted.length > MAX_NOTE_CIPHERTEXT) throw new Error('This note is too large to save. Split it into smaller notes.')
  return encrypted
}

export function encryptTag(payload: TagPayload, listKey: string) {
  return JSON.stringify(encryptSymmetric(JSON.stringify(payload), fromBase64(listKey)))
}

/** Merge an incremental sync response into the cached server state. */
export function mergeSync(previous: NotesCache | undefined, response: { notes: NoteRow[]; tags: NoteRow[]; deleted: { id: string; kind: 'note' | 'tag' }[]; cursor: number }): NotesCache {
  if (!previous) return { notes: response.notes, tags: response.tags, cursor: response.cursor }
  const notes = new Map(previous.notes.map(r => [r.id, r]))
  const tags = new Map(previous.tags.map(r => [r.id, r]))
  for (const d of response.deleted) (d.kind === 'note' ? notes : tags).delete(d.id)
  for (const r of response.notes) notes.set(r.id, r)
  for (const r of response.tags) tags.set(r.id, r)
  return { notes: [...notes.values()], tags: [...tags.values()], cursor: response.cursor }
}

export type ListKeys = Map<string, string>

/** List keys for every list the vault can open. */
export function useListKeys(lists: DecryptedList[] | undefined): ListKeys {
  return useMemo(() => {
    const keys: ListKeys = new Map()
    for (const list of lists ?? []) {
      const key = resolveListKey(list.encryptedListKey)
      if (key) keys.set(list.id, key)
    }
    return keys
  }, [lists?.map(l => `${l.id}:${l.encryptedListKey}`).join('|')])
}

/**
 * Notes and tags from every list, decrypted, with pending offline writes applied.
 * Each list syncs incrementally from its last cursor, so a refetch costs only
 * what changed since.
 */
export function useAllNotes(keys: ListKeys) {
  const utils = trpc.useUtils()
  const queryClient = useQueryClient()
  const revision = useSyncExternalStore(offlineQueue.subscribe, offlineQueue.getRevision)
  const listIds = [...keys.keys()]
  const results = useQueries({
    queries: listIds.map(listId => ({
      queryKey: notesQueryKey(listId),
      queryFn: async () => {
        const previous = queryClient.getQueryData<NotesCache>(notesQueryKey(listId))
        const response = await utils.client.notes.sync.query({ listId, since: previous?.cursor ?? 0 })
        return mergeSync(previous, response)
      },
      refetchInterval: 60_000,
    })),
  })
  // Decrypting thousands of notes on every keystroke is wasteful; reuse the
  // plaintext while a row's ciphertext is unchanged.
  const decrypted = useRef(new Map<string, { ciphertext: string; value: unknown }>())
  const dataStamp = results.map(r => r.dataUpdatedAt).join(',')

  const data = useMemo(() => {
    const notes: DecryptedNote[] = []
    const tags: DecryptedTag[] = []
    let queue: ReturnType<typeof offlineQueue.getAll> = []
    try { queue = offlineQueue.getAll() } catch { /* the sync banner reports unreadable storage */ }
    const open = <T,>(row: NoteRow, key: Uint8Array): T | null => {
      const cached = decrypted.current.get(row.id)
      if (cached?.ciphertext === row.encryptedPayload) return cached.value as T
      try {
        const value = JSON.parse(decryptSymmetric(JSON.parse(row.encryptedPayload), key))
        decrypted.current.set(row.id, { ciphertext: row.encryptedPayload, value })
        return value
      } catch { return null }
    }
    listIds.forEach((listId, i) => {
      const keyB64 = keys.get(listId)
      const cache = results[i]?.data
      if (!keyB64) return
      const key = fromBase64(keyB64)
      const merged = applyQueuedNoteChanges(cache ?? { notes: [], tags: [] }, listId, queue)
      for (const row of merged.notes) {
        const payload = open<Partial<NotePayload>>(row, key)
        if (payload) notes.push({ ...normalizeNote(payload), id: row.id, listId, updatedAt: row.updatedAt })
      }
      for (const row of merged.tags) {
        const payload = open<TagPayload>(row, key)
        if (payload) tags.push({ title: payload.title ?? 'Untitled tag', parent_id: payload.parent_id ?? null, id: row.id, listId })
      }
    })
    return { notes, tags }
  }, [dataStamp, revision, listIds.join(','), keys])

  const isLoading = results.some(r => r.isLoading)
  const error = results.find(r => r.error)?.error ?? null
  return { ...data, isLoading, error, refetch: () => Promise.all(results.map(r => r.refetch())) }
}

function requireKey(keys: ListKeys, listId: string) {
  const key = keys.get(listId)
  if (!key) throw new Error('This list is locked. Unlock your account again.')
  return key
}

/**
 * Every write goes through the encrypted outbox first, so edits made offline
 * or during a flaky connection are never lost.
 */
export function noteActions(keys: ListKeys) {
  return {
    createNote(listId: string, payload: NotePayload) {
      const noteId = crypto.randomUUID()
      offlineQueue.add({ type: 'note.create', listId, noteId, encryptedPayload: encryptNote(payload, requireKey(keys, listId)) })
      return noteId
    },
    saveNote(note: DecryptedNote, patch: Partial<NotePayload> = {}) {
      const payload = { ...stripNote(note), ...patch }
      offlineQueue.add({ type: 'note.update', listId: note.listId, noteId: note.id, encryptedPayload: encryptNote(payload, requireKey(keys, note.listId)) })
    },
    deleteNoteForever(note: Pick<DecryptedNote, 'id' | 'listId'>) {
      offlineQueue.add({ type: 'note.delete', listId: note.listId, noteId: note.id })
    },
    createTag(listId: string, payload: TagPayload) {
      const tagId = crypto.randomUUID()
      offlineQueue.add({ type: 'tag.create', listId, tagId, encryptedPayload: encryptTag(payload, requireKey(keys, listId)) })
      return tagId
    },
    saveTag(tag: DecryptedTag, patch: Partial<TagPayload>) {
      const payload: TagPayload = { title: tag.title, parent_id: tag.parent_id, ...patch }
      offlineQueue.add({ type: 'tag.update', listId: tag.listId, tagId: tag.id, encryptedPayload: encryptTag(payload, requireKey(keys, tag.listId)) })
    },
    deleteTag(tag: DecryptedTag) {
      offlineQueue.add({ type: 'tag.delete', listId: tag.listId, tagId: tag.id })
    },
  }
}

/** True while the outbox still holds writes for this note. */
export function hasPendingWrites(noteId: string) {
  try {
    return offlineQueue.getAll().some(m => 'noteId' in m && m.noteId === noteId)
  } catch { return true }
}
