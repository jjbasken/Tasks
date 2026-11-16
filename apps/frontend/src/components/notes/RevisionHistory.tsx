import { useMemo, useState } from 'react'
import { decryptSymmetric, fromBase64, type NotePayload } from '@tasks/shared'
import { trpc } from '../../lib/trpc.js'
import { displayTitle, normalizeNote } from '../../lib/notesModel.js'
import { MarkdownPreview } from './MarkdownPreview.js'

type Props = { noteId: string; listKey: string; onRestore: (payload: NotePayload) => void; onClose: () => void }

export function RevisionHistory({ noteId, listKey, onRestore, onClose }: Props) {
  const query = trpc.notes.revisions.useQuery({ noteId }, { staleTime: 0 })
  const revisions = useMemo(() => {
    const key = fromBase64(listKey)
    return (query.data ?? []).flatMap(r => {
      try {
        return [{ id: r.id, createdAt: r.createdAt, payload: normalizeNote(JSON.parse(decryptSymmetric(JSON.parse(r.encryptedPayload), key))) }]
      } catch { return [] }
    })
  }, [query.data, listKey])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = revisions.find(r => r.id === selectedId) ?? revisions[0]

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card revision-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="Revision history">
        <div className="modal-title">Revision history</div>
        {query.isLoading && <p className="hint-text">Loading…</p>}
        {query.error && <div className="form-error" role="alert">Revision history needs a connection to the server.</div>}
        {!query.isLoading && !query.error && revisions.length === 0 && (
          <p className="hint-text">No earlier versions yet. A version is kept each time a note is edited, at most every 10 minutes, up to 100 per note.</p>
        )}
        {revisions.length > 0 && (
          <div className="revision-layout">
            <div className="revision-list">
              {revisions.map(r => (
                <button key={r.id} className={`revision-item${selected?.id === r.id ? ' active' : ''}`} onClick={() => setSelectedId(r.id)}>
                  <span>{new Date(r.createdAt).toLocaleString()}</span>
                  <span className="revision-item-title">{displayTitle(r.payload)}</span>
                </button>
              ))}
            </div>
            {selected && (
              <div className="revision-preview">
                <h3 className="revision-preview-title">{displayTitle(selected.payload)}</h3>
                <MarkdownPreview text={selected.payload.text} readOnly onToggleTask={() => {}} />
              </div>
            )}
          </div>
        )}
        <div className="modal-actions">
          {selected && <button className="btn-primary" onClick={() => {
            if (window.confirm('Replace the current note with this version? The current version is kept in history.')) onRestore(selected.payload)
          }}>Restore this version</button>}
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
