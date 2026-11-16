import { useState } from 'react'
import type { DecryptedList } from '../../hooks/useLists.js'

type Props = { currentListId: string; lists: DecryptedList[]; onMove: (listId: string) => Promise<void>; onClose: () => void }

export function MoveNoteModal({ currentListId, lists, onMove, onClose }: Props) {
  const targets = lists.filter(l => l.id !== currentListId)
  const [listId, setListId] = useState(targets[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!listId || busy) return
    setBusy(true)
    setError(null)
    try {
      await onMove(listId)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not move the note')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()} role="dialog" aria-label="Move note">
        <div className="modal-title">Move note to another list</div>
        {targets.length === 0 ? <p className="hint-text">Create another list first.</p> : (
          <div className="modal-body">
            <select className="field-select" value={listId} onChange={e => setListId(e.target.value)} aria-label="Target list">
              {targets.map(l => <option key={l.id} value={l.id}>{l.name}{l.isShared ? ' (shared)' : ''}</option>)}
            </select>
            <p className="hint-text">The note and its attachments are re-encrypted for the new list, and its tags are matched by name there. Members of the new list will be able to read it. Revision history stays behind and is removed.</p>
          </div>
        )}
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="modal-actions">
          <button className="btn-primary" disabled={!listId || busy} onClick={submit}>{busy ? 'Moving…' : 'Move'}</button>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
