import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { NotePayload } from '@tasks/shared'
import { Sidebar } from '../components/Sidebar.js'
import { NotesNav } from '../components/notes/NotesNav.js'
import { NoteList } from '../components/notes/NoteList.js'
import { NoteEditor, type EditorMenuAction } from '../components/notes/NoteEditor.js'
import { RevisionHistory } from '../components/notes/RevisionHistory.js'
import { MoveNoteModal } from '../components/notes/MoveNoteModal.js'
import { FilesView } from '../components/notes/FilesView.js'
import { useProtectionGate } from '../components/notes/PassphrasePrompt.js'
import { useListsList } from '../hooks/useLists.js'
import { encryptNote, hasPendingWrites, noteActions, notesQueryKey, useAllNotes, useListKeys, type NotesCache } from '../hooks/useNotes.js'
import { useOfflineSync } from '../hooks/useOfflineSync.js'
import { useNetworkStatus } from '../hooks/useNetworkStatus.js'
import { trpc } from '../lib/trpc.js'
import {
  liveTagIds, matchesSearch, matchesView, newNotePayload, sortNotes, stripNote, tagPath,
  type DecryptedNote, type DecryptedTag, type NoteView, type SortOrder,
} from '../lib/notesModel.js'
import {
  attachmentUrl, decryptMetadata, encryptMetadata, fetchAttachment, saveBlob, uploadAttachment, type Attachment,
} from '../lib/attachments.js'
import { noteToMarkdown, safeFilename } from '../lib/notesExport.js'

type Pane = 'nav' | 'list' | 'editor'
const SORT_KEY = 'tasks:notes:sort'

function readSort(): SortOrder {
  try {
    const parsed = JSON.parse(localStorage.getItem(SORT_KEY) ?? '')
    if (['edited', 'created', 'title'].includes(parsed?.key)) return { key: parsed.key, desc: !!parsed.desc }
  } catch { /* default */ }
  return { key: 'edited', desc: true }
}

const VIEW_TITLES: Record<NoteView['kind'], string> = {
  all: 'All notes', pinned: 'Pinned', untagged: 'Untagged', archived: 'Archived', trash: 'Trash', files: 'Files', tag: '',
}

export function NotesPage() {
  const { data: lists = [] } = useListsList()
  const keys = useListKeys(lists)
  const { notes, tags, isLoading } = useAllNotes(keys)
  const actions = useMemo(() => noteActions(keys), [keys])
  const utils = trpc.useUtils()
  const queryClient = useQueryClient()
  const { sync } = useOfflineSync()
  const online = useNetworkStatus()
  const gate = useProtectionGate()

  const [searchParams, setSearchParams] = useSearchParams()
  const requestedScope = searchParams.get('listId') ?? 'all'
  const scope = requestedScope !== 'all' && lists.some(l => l.id === requestedScope) ? requestedScope : 'all'
  const setScope = (value: string) => {
    setSearchParams(value === 'all' ? {} : { listId: value }, { replace: true })
    setView({ kind: 'all' })
    setPane('list')
  }

  const [view, setView] = useState<NoteView>({ kind: 'all' })
  const [search, setSearch] = useState('')
  const [sort, setSortState] = useState<SortOrder>(readSort)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pane, setPane] = useState<Pane>('list')
  const [modal, setModal] = useState<null | { kind: 'history' | 'move'; noteId: string }>(null)
  const [error, setError] = useState<string | null>(null)
  const [attachmentBusy, setAttachmentBusy] = useState<string | null>(null)

  const setSort = (value: SortOrder) => {
    setSortState(value)
    try { localStorage.setItem(SORT_KEY, JSON.stringify(value)) } catch { /* storage unavailable */ }
  }

  const listName = useCallback((listId: string) => lists.find(l => l.id === listId)?.name ?? 'List', [lists])
  const personalListId = (lists.find(l => l.isPersonal) ?? lists[0])?.id ?? null

  const scopeNotes = useMemo(() => notes.filter(n => scope === 'all' || n.listId === scope), [notes, scope])
  const scopeTags = useMemo(() => tags.filter(t => scope === 'all' || t.listId === scope), [tags, scope])
  const tagsFor = useCallback((listId: string) => tags.filter(t => t.listId === listId), [tags])

  // A tag view that vanished (deleted elsewhere, or scope changed) falls back.
  const activeView: NoteView = view.kind === 'tag' && !scopeTags.some(t => t.id === view.tagId) ? { kind: 'all' } : view
  const visible = useMemo(
    () => sortNotes(scopeNotes.filter(n => matchesView(n, activeView, tagsFor(n.listId)) && matchesSearch(n, search)), sort),
    [scopeNotes, activeView, search, sort, tagsFor],
  )

  const counts = useMemo(() => {
    const result: Record<string, number> = {}
    for (const kind of ['all', 'pinned', 'untagged', 'archived', 'trash'] as const) {
      result[kind] = scopeNotes.filter(n => matchesView(n, { kind }, tagsFor(n.listId))).length
    }
    for (const tag of scopeTags) result[tag.id] = scopeNotes.filter(n => matchesView(n, { kind: 'tag', tagId: tag.id }, tagsFor(n.listId))).length
    return result
  }, [scopeNotes, scopeTags, tagsFor])

  const selected = notes.find(n => n.id === selectedId) ?? null
  const notesRef = useRef(notes)
  notesRef.current = notes
  const latestNote = (id: string) => notesRef.current.find(n => n.id === id) ?? null

  const heading = activeView.kind === 'tag'
    ? `#${tagPath(scopeTags, activeView.tagId)}`
    : VIEW_TITLES[activeView.kind]

  function guard(action: () => void) {
    try { setError(null); action(); return true } catch (err) { setError(err instanceof Error ? err.message : 'Could not save the change'); return false }
  }

  function save(note: DecryptedNote, payload: NotePayload) {
    return guard(() => actions.saveNote(note, payload))
  }

  /** Find or create each segment of a slash path such as "work/projects". */
  function ensureTagPath(listId: string, path: string, created: DecryptedTag[] = []): string | null {
    let parentId: string | null = null
    for (const segment of path.split('/').map(s => s.trim()).filter(Boolean)) {
      const pool = [...tagsFor(listId), ...created]
      const existing = pool.find(t => t.parent_id === parentId && t.title.toLowerCase() === segment.toLowerCase())
      if (existing) { parentId = existing.id; continue }
      const id: string = actions.createTag(listId, { title: segment, parent_id: parentId })
      created.push({ id, listId, title: segment, parent_id: parentId })
      parentId = id
    }
    return parentId
  }

  function handleCreate() {
    const tagView = activeView.kind === 'tag' ? scopeTags.find(t => t.id === activeView.tagId) : undefined
    const listId = tagView?.listId ?? (scope !== 'all' ? scope : personalListId)
    if (!listId) return
    guard(() => {
      const id = actions.createNote(listId, newNotePayload({ tag_ids: tagView ? [tagView.id] : [], pinned: activeView.kind === 'pinned' }))
      if (['archived', 'trash', 'untagged', 'files'].includes(activeView.kind)) setView({ kind: 'all' })
      setSearch('')
      setSelectedId(id)
      setPane('editor')
    })
  }

  async function downloadNote(payload: NotePayload, note: DecryptedNote) {
    saveBlob(new Blob([noteToMarkdown(payload, tagsFor(note.listId))], { type: 'text/markdown' }), `${safeFilename(payload.title || 'Untitled')}.md`)
  }

  async function handleAction(note: DecryptedNote, action: EditorMenuAction, latest: NotePayload) {
    if (latest.protected && !(await gate.requestUnlock('Using a protected note needs your passphrase.'))) return
    const now = new Date().toISOString()
    switch (action) {
      case 'pin': return save(note, { ...latest, pinned: !latest.pinned })
      case 'archive': return save(note, { ...latest, archived: !latest.archived })
      case 'lock': return save(note, { ...latest, locked: !latest.locked })
      case 'protect':
        if (latest.protected && !(await gate.requestUnlock('Removing protection needs your passphrase.'))) return
        return save(note, { ...latest, protected: !latest.protected })
      case 'move': return setModal({ kind: 'move', noteId: note.id })
      case 'history':
        if (latest.protected && !(await gate.requestUnlock('Viewing a protected note’s history needs your passphrase.'))) return
        return setModal({ kind: 'history', noteId: note.id })
      case 'export': return downloadNote(latest, note)
      case 'duplicate':
        return guard(() => {
          const id = actions.createNote(note.listId, { ...latest, title: `${latest.title || 'Untitled'} (copy)`, attachment_ids: [], pinned: false, created_at: now, edited_at: now })
          setSelectedId(id)
        })
      case 'trash':
        save(note, { ...latest, trashed_at: now, pinned: false })
        setSelectedId(null)
        setPane('list')
        return
      case 'restore': return save(note, { ...latest, trashed_at: null })
      case 'delete':
        if (!window.confirm(`Delete "${latest.title || 'Untitled'}" forever? This also deletes its attachments and history.`)) return
        guard(() => actions.deleteNoteForever(note))
        setSelectedId(null)
        setPane('list')
        return
    }
  }

  function handleEmptyTrash() {
    const trashed = scopeNotes.filter(n => n.trashed_at)
    if (!trashed.length || !window.confirm(`Delete ${trashed.length} note${trashed.length === 1 ? '' : 's'} forever, with their attachments and history?`)) return
    guard(() => trashed.forEach(n => actions.deleteNoteForever(n)))
    setSelectedId(null)
  }

  /** Server-side writes need the note itself synced first. */
  async function requireSynced(noteId: string) {
    if (!navigator.onLine) throw new Error('You are offline. This needs a connection to the server.')
    await sync()
    if (hasPendingWrites(noteId)) throw new Error('This note has changes that have not synced yet. Try again in a moment.')
  }

  async function moveNote(noteId: string, toListId: string) {
    const note = latestNote(noteId)
    const fromKey = note && keys.get(note.listId)
    const toKey = keys.get(toListId)
    if (!note || !fromKey || !toKey) throw new Error('That list is not available.')
    await requireSynced(note.id)
    const current = latestNote(noteId) ?? note
    const sourceTags = tagsFor(current.listId)
    const createdTags: DecryptedTag[] = []
    const tagIds = liveTagIds(current, sourceTags).map(id => ensureTagPath(toListId, tagPath(sourceTags, id), createdTags)).filter((id): id is string => !!id)
    const payload: NotePayload = { ...stripNote(current), tag_ids: tagIds }
    const rows = await utils.client.files.forList.query({ listId: current.listId })
    const files = rows.filter(r => r.noteId === current.id).map(row => {
      const meta = decryptMetadata(row, fromKey)
      if (!meta) throw new Error('An attachment could not be decrypted, so the note cannot be moved.')
      const { id, uploaded: _u, createdAt: _c, noteId: _n, ...metadata } = meta
      return { id, encryptedMetadata: encryptMetadata(metadata, toKey) }
    })
    await utils.client.notes.move.mutate({ noteId: current.id, listId: current.listId, toListId, encryptedPayload: encryptNote(payload, toKey), files })
    queryClient.setQueryData<NotesCache>(notesQueryKey(current.listId), cache => cache && { ...cache, notes: cache.notes.filter(n => n.id !== current.id) })
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: notesQueryKey(current.listId) }),
      queryClient.invalidateQueries({ queryKey: notesQueryKey(toListId) }),
      utils.files.forList.invalidate(),
    ])
    if (scope !== 'all') setScope(toListId)
    setSelectedId(current.id)
  }

  // Attachments for every list in scope; one cheap metadata query per list.
  const fileQueries = trpc.useQueries(t => [...keys.keys()].filter(id => scope === 'all' || id === scope).map(listId => t.files.forList({ listId }, { enabled: online, staleTime: 60_000 })))
  const fileListIds = [...keys.keys()].filter(id => scope === 'all' || id === scope)
  const fileStamp = fileQueries.map(q => q.dataUpdatedAt).join(',')
  const attachments = useMemo(() => fileListIds.flatMap((listId, i) => {
    const key = keys.get(listId)
    return key ? (fileQueries[i]?.data ?? []).flatMap(row => { const a = decryptMetadata(row, key); return a ? [{ ...a, listId }] : [] }) : []
  }), [fileStamp, keys, scope])
  const usage = trpc.files.usage.useQuery(undefined, { enabled: online && activeView.kind === 'files' })

  const noteAttachments = selected ? attachments.filter(a => a.noteId === selected.id) : []

  const resolveImage = useCallback(async (attachmentId: string) => {
    const note = selectedId ? latestNote(selectedId) : null
    if (!note) return null
    const key = keys.get(note.listId)
    if (!key) return null
    try {
      const rows = await utils.files.forList.fetch({ listId: note.listId })
      const row = rows.find(r => r.id === attachmentId && r.uploaded)
      const owner = row && latestNote(row.noteId)
      if (!owner || (owner.protected && !gate.unlocked)) return null
      const meta = row && decryptMetadata(row, key)
      return meta ? await attachmentUrl(meta) : null
    } catch { return null }
  }, [selectedId, keys, utils, gate.unlocked])

  async function openAttachment(attachment: Attachment) {
    try {
      const owner = attachment.noteId && latestNote(attachment.noteId)
      if (owner && owner.protected && !(await gate.requestUnlock('Opening a protected attachment needs your passphrase.'))) return
      saveBlob(await fetchAttachment(attachment), attachment.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not download the attachment')
    }
  }

  async function uploadFiles(noteId: string, files: File[]): Promise<Attachment[]> {
    const note = latestNote(noteId)
    const key = note && keys.get(note.listId)
    if (!note || !key) return []
    setError(null)
    const uploaded: Attachment[] = []
    try {
      await requireSynced(noteId)
      const { maxFile } = await utils.files.usage.fetch()
      for (const [i, file] of files.entries()) {
        if (file.size + 40 > maxFile) throw new Error(`${file.name} is larger than the ${Math.floor(maxFile / 1024 / 1024)} MB limit.`)
        setAttachmentBusy(`Encrypting and uploading ${file.name} (${i + 1} of ${files.length})…`)
        const { id, meta } = await uploadAttachment(utils.client.files, { listId: note.listId, noteId, file, listKey: key })
        uploaded.push({ ...meta, id, uploaded: true, createdAt: Date.now(), noteId })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The upload failed')
    } finally {
      setAttachmentBusy(null)
      utils.files.forList.invalidate({ listId: note.listId })
      utils.files.usage.invalidate()
    }
    const current = latestNote(noteId)
    if (current && uploaded.length) save(current, { ...stripNote(current), attachment_ids: [...current.attachment_ids, ...uploaded.map(a => a.id)] })
    return uploaded
  }

  async function deleteAttachment(noteId: string, attachment: Attachment) {
    try {
      const owner = latestNote(noteId)
      if (owner?.protected && !(await gate.requestUnlock('Deleting a protected attachment needs your passphrase.'))) return
      if (owner?.locked) throw new Error('Allow editing of this note before deleting attachments.')
      await utils.client.files.delete.mutate({ fileId: attachment.id })
      const current = latestNote(noteId)
      if (current) save(current, { ...stripNote(current), attachment_ids: current.attachment_ids.filter(id => id !== attachment.id) })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the attachment. Check your connection.')
    } finally {
      utils.files.forList.invalidate()
      utils.files.usage.invalidate()
    }
  }

  // Keyboard: Alt+N for a new note, like StandardNotes' Ctrl/Alt shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === 'n' || e.key === 'N')) { e.preventDefault(); handleCreate() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const modalNote = modal ? latestNote(modal.noteId) : null

  return (
    <div className="app-layout">
      <Sidebar activeListId={scope === 'all' ? '' : scope} onSelectList={setScope} />
      <div className={`main-content notes-layout notes-pane-${pane}`}>
        <NotesNav
          lists={lists.filter(l => keys.has(l.id))}
          scope={scope}
          onScope={setScope}
          view={activeView}
          onView={v => { setView(v); setPane('list') }}
          tags={scopeTags}
          counts={counts}
          showFiles
          onCreateTag={(listId, title, parentId) => guard(() => { actions.createTag(listId, { title, parent_id: parentId }) })}
          onUpdateTag={(tag, title, parentId) => guard(() => actions.saveTag(tag, { title, parent_id: parentId }))}
          onDeleteTag={tag => guard(() => actions.deleteTag(tag))}
        />
        {activeView.kind === 'files' ? (
          <FilesView
            files={attachments}
            noteTitle={noteId => { const n = notes.find(x => x.id === noteId); return n ? (n.protected ? 'Protected note' : n.title || 'Untitled') : null }}
            onOpenNote={noteId => { setView({ kind: 'all' }); setSelectedId(noteId); setPane('editor') }}
            onDownload={openAttachment}
            onDelete={a => { if (a.noteId && window.confirm(`Delete "${a.name}" forever?`)) deleteAttachment(a.noteId, a) }}
            usage={usage.data}
            onBack={() => setPane('nav')}
          />
        ) : (
          <NoteList
            heading={heading}
            notes={visible}
            tags={tags}
            selectedId={selectedId}
            search={search}
            onSearch={setSearch}
            sort={sort}
            onSort={setSort}
            onSelect={note => { setSelectedId(note.id); setPane('editor') }}
            onCreate={activeView.kind === 'trash' ? undefined : handleCreate}
            onEmptyTrash={activeView.kind === 'trash' ? handleEmptyTrash : undefined}
            onBack={() => setPane('nav')}
            showListName={scope === 'all' && lists.length > 1 ? listName : undefined}
          />
        )}
        <div className="note-editor-pane">
          {selected ? (
            <NoteEditor
              note={selected}
              tags={tagsFor(selected.listId)}
              listName={listName(selected.listId)}
              unlocked={gate.unlocked}
              error={error}
              onSave={save}
              onAction={(action, latest) => handleAction(selected, action, latest)}
              onAddTag={path => { try { return ensureTagPath(selected.listId, path) } catch (err) { setError(err instanceof Error ? err.message : 'Could not add the tag'); return null } }}
              onRequestUnlock={() => gate.requestUnlock('Opening a protected note needs your passphrase.')}
              onBack={() => setPane('list')}
              attachments={noteAttachments}
              attachmentBusy={attachmentBusy}
              uploadFiles={online ? files => uploadFiles(selected.id, files) : undefined}
              onDownloadAttachment={openAttachment}
              onDeleteAttachment={a => deleteAttachment(selected.id, a)}
              resolveImage={resolveImage}
              onOpenAttachment={id => { const a = attachments.find(x => x.id === id); if (a) openAttachment(a) }}
            />
          ) : (
            <div className="note-empty">
              {isLoading ? 'Loading notes…' : error ? <div className="form-error" role="alert">{error}</div> : <>
                <p>Select a note, or create one.</p>
                <button className="add-task-btn" onClick={handleCreate}>+ New note</button>
                <p className="hint-text">Alt+N creates a note anywhere on this page.</p>
              </>}
            </div>
          )}
        </div>
      </div>
      {modal?.kind === 'history' && modalNote && keys.get(modalNote.listId) && (
        <RevisionHistory
          noteId={modalNote.id}
          listKey={keys.get(modalNote.listId)!}
          onClose={() => setModal(null)}
          onRestore={payload => {
            const current = latestNote(modalNote.id)
            if (current) save(current, { ...payload, attachment_ids: current.attachment_ids, edited_at: new Date().toISOString() })
            setModal(null)
          }}
        />
      )}
      {modal?.kind === 'move' && modalNote && (
        <MoveNoteModal
          currentListId={modalNote.listId}
          lists={lists.filter(l => keys.has(l.id))}
          onMove={listId => moveNote(modalNote.id, listId)}
          onClose={() => setModal(null)}
        />
      )}
      {gate.prompt}
    </div>
  )
}
