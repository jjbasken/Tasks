import { formatBytes, type Attachment } from '../../lib/attachments.js'

type Props = {
  files: (Attachment & { listId: string })[]
  noteTitle: (noteId: string | undefined) => string | null
  onOpenNote: (noteId: string) => void
  onDownload: (attachment: Attachment) => void
  onDelete: (attachment: Attachment) => void
  usage?: { used: number; quota: number }
  onBack?: () => void
}

export function FilesView({ files, noteTitle, onOpenNote, onDownload, onDelete, usage, onBack }: Props) {
  return (
    <div className="note-list-pane notes-files">
      <div className="note-list-header">
        {onBack && <button className="note-back-btn" onClick={onBack} aria-label="Back to views">‹</button>}
        <h2 className="note-list-title">Files</h2>
        <span className="note-list-count">{files.length}</span>
      </div>
      {usage && <p className="hint-text notes-files-usage">{formatBytes(usage.used)} of {formatBytes(usage.quota)} used by your uploads</p>}
      <div className="note-list">
        {files.length === 0 && <div className="task-empty">No attachments yet</div>}
        {[...files].sort((a, b) => b.createdAt - a.createdAt).map(f => {
          const title = noteTitle(f.noteId)
          return (
            <div key={f.id} className="note-list-item notes-file-row">
              <div className="note-list-item-title"><span>📎 {f.name}</span></div>
              <div className="note-list-item-meta">
                <span>{formatBytes(f.size)}</span>
                <span>· {new Date(f.createdAt).toLocaleDateString()}</span>
                {title && f.noteId && <button className="notes-file-note" onClick={() => onOpenNote(f.noteId!)}>· {title}</button>}
              </div>
              {!f.uploaded && <span className="hint-text">Upload incomplete</span>}
              <button className="btn-secondary" onClick={() => onDelete(f)}>Delete</button>
              {f.uploaded && <button className="btn-secondary" onClick={() => onDownload(f)}>Download</button>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
