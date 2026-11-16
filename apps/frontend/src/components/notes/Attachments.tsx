import { formatBytes, type Attachment } from '../../lib/attachments.js'

type Props = {
  attachments: Attachment[]
  readOnly: boolean
  busy: string | null
  onInsert: (attachment: Attachment) => void
  onDownload: (attachment: Attachment) => void
  onDelete: (attachment: Attachment) => void
}

export function Attachments({ attachments, readOnly, busy, onInsert, onDownload, onDelete }: Props) {
  if (attachments.length === 0 && !busy) return null
  return (
    <div className="note-attachments" aria-label="Attachments">
      {busy && <div className="note-attachment note-attachment--busy">{busy}</div>}
      {attachments.map(a => (
        <div key={a.id} className="note-attachment">
          <span className="note-attachment-name" title={a.name}>📎 {a.name}</span>
          <span className="note-attachment-size">{formatBytes(a.size)}</span>
          {!a.uploaded && <span className="note-flag note-flag--danger">Upload incomplete</span>}
          {a.uploaded && <button className="btn-secondary" onClick={() => onDownload(a)}>Download</button>}
          {a.uploaded && !readOnly && <button className="btn-secondary" onClick={() => onInsert(a)}>Insert</button>}
          {!readOnly && <button className="btn-danger-sm" onClick={() => { if (window.confirm(`Delete ${a.name}?`)) onDelete(a) }}>Delete</button>}
        </div>
      ))}
    </div>
  )
}
