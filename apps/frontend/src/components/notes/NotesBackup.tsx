import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { trpc } from '../../lib/trpc.js'
import { useListsList } from '../../hooks/useLists.js'
import { encryptNote, encryptTag, notesQueryKey, useAllNotes, useListKeys } from '../../hooks/useNotes.js'
import { useNetworkStatus } from '../../hooks/useNetworkStatus.js'
import { assignIds, chunkBySize, ImportError, parseBackupFile, type ImportResult } from '../../lib/notesImport.js'
import { buildNotesArchive } from '../../lib/notesExport.js'
import { decryptMetadata, fetchAttachment, saveBlob, type Attachment } from '../../lib/attachments.js'
import { useProtectionGate } from './PassphrasePrompt.js'

export function NotesBackup() {
  const { data: lists = [] } = useListsList()
  const keys = useListKeys(lists)
  const usable = lists.filter(l => keys.has(l.id))
  const { notes, tags } = useAllNotes(keys)
  const utils = trpc.useUtils()
  const queryClient = useQueryClient()
  const online = useNetworkStatus()
  const gate = useProtectionGate()
  const fileInput = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<{ name: string; result: ImportResult } | null>(null)
  const [targetListId, setTargetListId] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const target = targetListId || (usable.find(l => l.isPersonal) ?? usable[0])?.id || ''

  async function choose(file: File | undefined) {
    if (!file) return
    setError(null)
    setStatus(null)
    try {
      setParsed({ name: file.name, result: await parseBackupFile(file) })
    } catch (err) {
      setParsed(null)
      setError(err instanceof ImportError ? err.message : 'That file could not be read.')
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function runImport() {
    const listKey = keys.get(target)
    if (!parsed || !listKey || busy) return
    setBusy(true)
    setError(null)
    try {
      const { tags: tagItems, notes: noteItems } = await assignIds(parsed.result, target)
      const encTags = tagItems.map(t => ({ id: t.id, encryptedPayload: encryptTag(t.payload, listKey) }))
      const encNotes = noteItems.map(n => ({ id: n.id, encryptedPayload: encryptNote(n.payload, listKey) }))
      const tagChunks = chunkBySize(encTags)
      const noteChunks = chunkBySize(encNotes)
      const total = tagChunks.length + noteChunks.length
      let done = 0
      // Tags first, so a partially completed import never shows notes whose tags are missing.
      for (const chunk of tagChunks) {
        setStatus(`Importing… ${Math.round((done++ / total) * 100)}%`)
        await utils.client.notes.importBatch.mutate({ listId: target, notes: [], tags: chunk })
      }
      for (const chunk of noteChunks) {
        setStatus(`Importing… ${Math.round((done++ / total) * 100)}%`)
        await utils.client.notes.importBatch.mutate({ listId: target, notes: chunk, tags: [] })
      }
      await queryClient.invalidateQueries({ queryKey: notesQueryKey(target) })
      const listName = usable.find(l => l.id === target)?.name ?? 'the list'
      setStatus(`Imported ${noteItems.length} note${noteItems.length === 1 ? '' : 's'} and ${tagItems.length} tag${tagItems.length === 1 ? '' : 's'} into ${listName}.${parsed.result.skipped ? ` Skipped ${parsed.result.skipped} deleted or unreadable item${parsed.result.skipped === 1 ? '' : 's'}.` : ''}`)
      setParsed(null)
    } catch (err) {
      setError(err instanceof Error && err.message ? `Import stopped: ${err.message}. Running it again resumes safely; nothing is duplicated.` : 'Import failed. Running it again resumes safely.')
      setStatus(null)
    } finally {
      setBusy(false)
    }
  }

  async function runExport() {
    if (busy) return
    if (notes.some(n => n.protected) && !(await gate.requestUnlock('Exporting includes protected notes.'))) return
    setBusy(true)
    setError(null)
    try {
      let attachments: Attachment[] = []
      if (online) {
        const rows = await Promise.all(usable.map(l => utils.files.forList.fetch({ listId: l.id }).then(r => r.map(row => decryptMetadata(row, keys.get(l.id)!)))))
        attachments = rows.flat().filter((a): a is Attachment => !!a && a.uploaded)
      }
      const zip = await buildNotesArchive({
        lists: usable.map(l => ({ id: l.id, name: l.name })),
        notes, tags, attachments, fetchAttachment,
        onProgress: (d, t) => setStatus(`Preparing export… ${d} of ${t}`),
      })
      saveBlob(new Blob([zip as BlobPart], { type: 'application/zip' }), `notes-export-${new Date().toISOString().slice(0, 10)}.zip`)
      setStatus(`Exported ${notes.length} notes${attachments.length ? ` and ${attachments.length} attachments` : online ? '' : ' (attachments skipped while offline)'}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
      setStatus(null)
    } finally {
      setBusy(false)
    }
  }

  const counts = parsed && {
    notes: parsed.result.notes.length,
    tags: parsed.result.tags.length,
    trashed: parsed.result.notes.filter(n => n.trashed_at).length,
  }

  return (
    <>
      <div className="section-label">Notes</div>
      <div className="card notes-backup">
        <div className="card-row">
          <span className="card-row-label">Import from StandardNotes</span>
          <button className="btn-secondary" disabled={busy || !online} onClick={() => fileInput.current?.click()}>Choose backup…</button>
        </div>
        <p className="hint-text notes-backup-hint">
          In StandardNotes, download a <strong>decrypted</strong> backup (Preferences → Backups), then choose the .txt or .zip file here.
          Notes, nested tags, pinned, archived, trashed, read-only and protected states are kept. Super notes are converted to Markdown.
          StandardNotes file attachments are not included in its backups and are not imported. A backup exported from this app can be imported the same way.
        </p>
        <input ref={fileInput} type="file" accept=".txt,.json,.zip" hidden onChange={e => choose(e.target.files?.[0])} />
        {parsed && counts && (
          <div className="notes-backup-confirm">
            <p className="hint-text">{parsed.name}: {counts.notes} notes ({counts.trashed} in trash) and {counts.tags} tags.</p>
            <label className="field-label" htmlFor="import-target">Import into</label>
            <select id="import-target" className="field-select" value={target} onChange={e => setTargetListId(e.target.value)}>
              {usable.map(l => <option key={l.id} value={l.id}>{l.name}{l.isShared ? ' (shared — members will see these notes)' : ''}</option>)}
            </select>
            <div className="modal-actions">
              <button className="btn-primary" disabled={busy || !target} onClick={runImport}>{busy ? 'Importing…' : `Import ${counts.notes} notes`}</button>
              <button className="btn-secondary" disabled={busy} onClick={() => setParsed(null)}>Cancel</button>
            </div>
          </div>
        )}
        <div className="card-row">
          <span className="card-row-label">Export all notes</span>
          <button className="btn-secondary" disabled={busy || notes.length === 0} onClick={runExport}>Download .zip</button>
        </div>
        <p className="hint-text notes-backup-hint">
          A decrypted zip: one Markdown file per note (with tags and dates in front matter), your attachments, and a JSON file for a lossless restore. Store it somewhere safe; it is not encrypted.
        </p>
        {status && <p className="hint-text notes-backup-status" role="status">{status}</p>}
        {error && <div className="form-error" role="alert">{error}</div>}
      </div>
      {gate.prompt}
    </>
  )
}
