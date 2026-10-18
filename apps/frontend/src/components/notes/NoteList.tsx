import { displayTitle, liveTagIds, notePreview, type DecryptedNote, type DecryptedTag, type SortOrder } from '../../lib/notesModel.js'

type Props = {
  heading: string
  notes: DecryptedNote[]
  tags: DecryptedTag[]
  selectedId: string | null
  search: string
  onSearch: (value: string) => void
  sort: SortOrder
  onSort: (sort: SortOrder) => void
  onSelect: (note: DecryptedNote) => void
  onCreate?: () => void
  onEmptyTrash?: () => void
  onBack?: () => void
  showListName?: (listId: string) => string | null
}

function relativeDate(iso: string) {
  const date = new Date(iso)
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000)
  if (days < 1 && new Date().getDate() === date.getDate()) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (days < 7) return date.toLocaleDateString([], { weekday: 'short' })
  return date.toLocaleDateString()
}

export function NoteList(props: Props) {
  const { notes, tags, selectedId, sort } = props
  return (
    <div className="note-list-pane">
      <div className="note-list-header">
        {props.onBack && <button className="note-back-btn" onClick={props.onBack} aria-label="Back to views">‹</button>}
        <h2 className="note-list-title">{props.heading}</h2>
        <span className="note-list-count">{notes.length}</span>
        {props.onCreate && <button className="add-task-btn" onClick={props.onCreate}>+ Note</button>}
        {props.onEmptyTrash && notes.length > 0 && <button className="btn-danger-sm" onClick={props.onEmptyTrash}>Empty trash</button>}
      </div>
      <div className="note-list-controls">
        <input
          className="field-input note-search"
          type="search"
          placeholder="Search notes"
          value={props.search}
          onChange={e => props.onSearch(e.target.value)}
          aria-label="Search notes"
        />
        <select
          className="field-select note-sort"
          value={`${sort.key}:${sort.desc ? 'desc' : 'asc'}`}
          onChange={e => {
            const [key, dir] = e.target.value.split(':')
            props.onSort({ key: key as SortOrder['key'], desc: dir === 'desc' })
          }}
          aria-label="Sort notes"
        >
          <option value="edited:desc">Recently edited</option>
          <option value="edited:asc">Least recently edited</option>
          <option value="created:desc">Newest first</option>
          <option value="created:asc">Oldest first</option>
          <option value="title:asc">Title A–Z</option>
          <option value="title:desc">Title Z–A</option>
        </select>
      </div>
      <div className="note-list" role="listbox" aria-label="Notes">
        {notes.length === 0 && <div className="task-empty">{props.search ? 'No matching notes' : 'No notes here yet'}</div>}
        {notes.map(note => {
          const tagCount = liveTagIds(note, tags).length
          const listName = props.showListName?.(note.listId)
          return (
            <button
              key={note.id}
              role="option"
              aria-selected={note.id === selectedId}
              className={`note-list-item${note.id === selectedId ? ' active' : ''}`}
              onClick={() => props.onSelect(note)}
            >
              <div className="note-list-item-title">
                {note.pinned && <span className="note-pin" aria-label="Pinned">📌</span>}
                {note.protected && <span aria-label="Protected">🔒</span>}
                <span>{displayTitle(note)}</span>
              </div>
              <div className="note-list-item-preview">
                {note.protected ? 'Protected note' : notePreview(note.text) || <em>Empty</em>}
              </div>
              <div className="note-list-item-meta">
                <span>{relativeDate(sort.key === 'created' ? note.created_at : note.edited_at)}</span>
                {tagCount > 0 && <span>· {tagCount} tag{tagCount === 1 ? '' : 's'}</span>}
                {note.attachment_ids.length > 0 && <span>· 📎 {note.attachment_ids.length}</span>}
                {listName && <span className="note-list-item-list">· {listName}</span>}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
