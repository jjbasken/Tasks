import { useState, type FormEvent } from 'react'
import { buildTagTree, flattenTagTree, tagSubtree, type DecryptedTag, type NoteView, type TagNode } from '../../lib/notesModel.js'
import type { DecryptedList } from '../../hooks/useLists.js'

type Props = {
  lists: DecryptedList[]
  scope: string
  onScope: (scope: string) => void
  view: NoteView
  onView: (view: NoteView) => void
  tags: DecryptedTag[]
  counts: Record<string, number>
  onCreateTag: (listId: string, title: string, parentId: string | null) => void
  onUpdateTag: (tag: DecryptedTag, title: string, parentId: string | null) => void
  onDeleteTag: (tag: DecryptedTag) => void
  showFiles: boolean
}

const VIEWS: { kind: Exclude<NoteView['kind'], 'tag'>; label: string; icon: string }[] = [
  { kind: 'all', label: 'All notes', icon: '▤' },
  { kind: 'pinned', label: 'Pinned', icon: '📌' },
  { kind: 'untagged', label: 'Untagged', icon: '◌' },
  { kind: 'archived', label: 'Archived', icon: '▣' },
  { kind: 'trash', label: 'Trash', icon: '🗑' },
  { kind: 'files', label: 'Files', icon: '📎' },
]

export function NotesNav(props: Props) {
  const { lists, scope, view, tags } = props
  const [editing, setEditing] = useState<{ tag: DecryptedTag | null; listId: string; parentId: string | null } | null>(null)
  const visibleLists = lists.filter(l => scope === 'all' || l.id === scope)
  const defaultListId = scope !== 'all' ? scope : (lists.find(l => l.isPersonal) ?? lists[0])?.id

  return (
    <nav className="notes-nav" aria-label="Note views">
      <label className="field-label" htmlFor="notes-scope">Notebook</label>
      <select id="notes-scope" className="field-select notes-scope" value={scope} onChange={e => props.onScope(e.target.value)}>
        <option value="all">All lists</option>
        {lists.map(l => <option key={l.id} value={l.id}>{l.name}{l.isShared ? ' (shared)' : ''}</option>)}
      </select>

      <div className="notes-nav-section">
        {VIEWS.filter(v => v.kind !== 'files' || props.showFiles).map(v => (
          <button key={v.kind} className={`notes-nav-item${view.kind === v.kind ? ' active' : ''}`} onClick={() => props.onView({ kind: v.kind })}>
            <span className="notes-nav-icon">{v.icon}</span>
            <span className="notes-nav-label">{v.label}</span>
            {props.counts[v.kind] !== undefined && <span className="notes-nav-count">{props.counts[v.kind]}</span>}
          </button>
        ))}
      </div>

      <div className="notes-nav-tags-header">
        <span className="sidebar-section-label">Tags</span>
        {defaultListId && <button className="notes-nav-add" aria-label="New tag" onClick={() => setEditing({ tag: null, listId: defaultListId, parentId: null })}>+</button>}
      </div>
      {visibleLists.map(list => {
        const listTags = tags.filter(t => t.listId === list.id)
        if (scope === 'all' && listTags.length === 0) return null
        return (
          <div key={list.id} className="notes-nav-section">
            {scope === 'all' && <div className="notes-nav-group">{list.name}</div>}
            {listTags.length === 0 && <div className="hint-text notes-nav-empty">Type in a note’s tag field or press + to add tags.</div>}
            {flattenTagTree(buildTagTree(listTags)).map((node: TagNode) => (
              <div key={node.tag.id} className={`notes-nav-item notes-nav-tag${view.kind === 'tag' && view.tagId === node.tag.id ? ' active' : ''}`} style={{ paddingLeft: 10 + node.depth * 14 }}>
                <button className="notes-nav-tag-btn" onClick={() => props.onView({ kind: 'tag', tagId: node.tag.id })}>
                  <span className="notes-nav-icon">#</span>
                  <span className="notes-nav-label">{node.tag.title}</span>
                  {props.counts[node.tag.id] ? <span className="notes-nav-count">{props.counts[node.tag.id]}</span> : null}
                </button>
                <button className="notes-nav-edit" aria-label={`Edit tag ${node.tag.title}`} onClick={() => setEditing({ tag: node.tag, listId: list.id, parentId: node.tag.parent_id })}>✎</button>
              </div>
            ))}
          </div>
        )
      })}

      {editing && (
        <TagModal
          {...editing}
          lists={lists}
          tags={tags}
          onClose={() => setEditing(null)}
          onSave={(listId, title, parentId) => {
            if (editing.tag) props.onUpdateTag(editing.tag, title, parentId)
            else props.onCreateTag(listId, title, parentId)
            setEditing(null)
          }}
          onDelete={editing.tag ? () => { props.onDeleteTag(editing.tag!); setEditing(null) } : undefined}
        />
      )}
    </nav>
  )
}

type TagModalProps = {
  tag: DecryptedTag | null
  listId: string
  parentId: string | null
  lists: DecryptedList[]
  tags: DecryptedTag[]
  onClose: () => void
  onSave: (listId: string, title: string, parentId: string | null) => void
  onDelete?: () => void
}

function TagModal({ tag, listId: initialList, parentId: initialParent, lists, tags, onClose, onSave, onDelete }: TagModalProps) {
  const [title, setTitle] = useState(tag?.title ?? '')
  const [listId, setListId] = useState(initialList)
  const [parentId, setParentId] = useState(initialParent ?? '')
  // A tag cannot nest under itself or its own descendants.
  const excluded = tag ? tagSubtree(tags, tag.id) : new Set<string>()
  const parents = flattenTagTree(buildTagTree(tags.filter(t => t.listId === listId))).filter(n => !excluded.has(n.tag.id))

  function submit(e: FormEvent) {
    e.preventDefault()
    const trimmed = title.trim().replace(/\//g, '-')
    if (trimmed) onSave(listId, trimmed, parentId || null)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal-card" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-title">{tag ? 'Edit tag' : 'New tag'}</div>
        <div className="modal-body">
          <label className="field-label">Name</label>
          <input className="field-input" value={title} onChange={e => setTitle(e.target.value)} autoFocus />
          {!tag && lists.length > 1 && (
            <>
              <label className="field-label">List</label>
              <select className="field-select" value={listId} onChange={e => { setListId(e.target.value); setParentId('') }}>
                {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </>
          )}
          <label className="field-label">Nested under</label>
          <select className="field-select" value={parentId} onChange={e => setParentId(e.target.value)}>
            <option value="">(top level)</option>
            {parents.map(n => <option key={n.tag.id} value={n.tag.id}>{'  '.repeat(n.depth)}{n.tag.title}</option>)}
          </select>
        </div>
        <div className="modal-actions">
          <button type="submit" className="btn-primary" disabled={!title.trim()}>Save</button>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          {onDelete && <button type="button" className="btn-danger-sm" onClick={() => { if (window.confirm(`Delete tag "${tag!.title}"? Notes keep their content; nested tags move to the top level.`)) onDelete() }}>Delete</button>}
        </div>
      </form>
    </div>
  )
}
