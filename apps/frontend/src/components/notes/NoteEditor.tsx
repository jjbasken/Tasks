import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { NotePayload } from '@tasks/shared'
import { applyFormat, attachmentMarkdown, toggleTask } from '../../lib/markdown.js'
import { isImage, type Attachment } from '../../lib/attachments.js'
import { Attachments } from './Attachments.js'
import { displayTitle, liveTagIds, stripNote, tagPath, wordCount, type DecryptedNote, type DecryptedTag } from '../../lib/notesModel.js'
import { MarkdownPreview } from './MarkdownPreview.js'

export type EditorMode = 'edit' | 'split' | 'preview'
const MODE_KEY = 'tasks:notes:editor-mode'
const AUTOSAVE_MS = 800

function readMode(): EditorMode {
  try {
    const value = localStorage.getItem(MODE_KEY)
    if (value === 'edit' || value === 'split' || value === 'preview') return value
  } catch { /* storage unavailable */ }
  return 'split'
}

export type EditorMenuAction =
  | 'pin' | 'archive' | 'lock' | 'protect' | 'move' | 'duplicate' | 'history' | 'export' | 'trash' | 'restore' | 'delete'

type Props = {
  note: DecryptedNote
  tags: DecryptedTag[]
  listName: string
  unlocked: boolean
  onSave: (note: DecryptedNote, payload: NotePayload) => void
  onAction: (action: EditorMenuAction, latest: NotePayload) => void
  onAddTag: (path: string) => string | null
  onRequestUnlock: () => void
  onBack?: () => void
  attachments?: Attachment[]
  attachmentBusy?: string | null
  /** Uploads and records the files on the note; resolves the uploaded attachments. */
  uploadFiles?: (files: File[]) => Promise<Attachment[]>
  onDownloadAttachment?: (attachment: Attachment) => void
  onDeleteAttachment?: (attachment: Attachment) => void
  resolveImage?: (attachmentId: string) => Promise<string | null>
  onOpenAttachment?: (attachmentId: string) => void
  error?: string | null
}

export function NoteEditor(props: Props) {
  const { note, tags, unlocked } = props
  if (note.protected && !unlocked) {
    return (
      <div className="note-editor">
        <EditorHeader {...props} title={displayTitle(note)} />
        <div className="note-protected">
          <div className="note-protected-icon">🔒</div>
          <p className="hint-text">This note is protected.</p>
          <button className="btn-accent-sm" onClick={props.onRequestUnlock}>Unlock to view</button>
        </div>
      </div>
    )
  }
  return <UnlockedEditor key={note.id} {...props} tags={tags} />
}

// Actions that do not themselves save the note: persist pending typing first so
// what they read (history, a move, an export) matches what is on screen.
const FLUSH_FIRST: EditorMenuAction[] = ['history', 'move', 'export', 'duplicate']

function EditorHeader({ note, title, onBack, onAction, listName, latest, flush }: Props & { title: string; latest?: () => NotePayload; flush?: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const current = () => latest?.() ?? stripNote(note)
  const act = (action: EditorMenuAction) => {
    setMenuOpen(false)
    const payload = current()
    if (FLUSH_FIRST.includes(action)) flush?.()
    onAction(action, payload)
  }
  const trashed = !!note.trashed_at
  return (
    <div className="note-editor-header">
      {onBack && <button className="note-back-btn" onClick={onBack} aria-label="Back to notes">‹</button>}
      <div className="note-editor-meta">
        <span className="note-editor-list">{listName}</span>
        {note.pinned && <span className="note-flag">Pinned</span>}
        {note.archived && <span className="note-flag">Archived</span>}
        {note.locked && <span className="note-flag">Read-only</span>}
        {note.protected && <span className="note-flag">Protected</span>}
        {trashed && <span className="note-flag note-flag--danger">In trash</span>}
      </div>
      <div className="note-menu">
        <button className="note-menu-btn" aria-label={`Actions for ${title}`} aria-expanded={menuOpen} onClick={() => setMenuOpen(o => !o)}>⋯</button>
        {menuOpen && (
          <>
            <div className="note-menu-backdrop" onClick={() => setMenuOpen(false)} />
            <div className="note-menu-list" role="menu">
              {!trashed && <>
                <button role="menuitem" onClick={() => act('pin')}>{note.pinned ? 'Unpin' : 'Pin to top'}</button>
                <button role="menuitem" onClick={() => act('archive')}>{note.archived ? 'Unarchive' : 'Archive'}</button>
                <button role="menuitem" onClick={() => act('lock')}>{note.locked ? 'Allow editing' : 'Prevent editing'}</button>
                <button role="menuitem" onClick={() => act('protect')}>{note.protected ? 'Remove protection' : 'Protect with passphrase'}</button>
                <button role="menuitem" onClick={() => act('move')}>Move to list…</button>
                <button role="menuitem" onClick={() => act('duplicate')}>Duplicate</button>
              </>}
              <button role="menuitem" onClick={() => act('history')}>Revision history</button>
              <button role="menuitem" onClick={() => act('export')}>Download as Markdown</button>
              {trashed
                ? <>
                    <button role="menuitem" onClick={() => act('restore')}>Restore</button>
                    <button role="menuitem" className="danger" onClick={() => act('delete')}>Delete forever</button>
                  </>
                : <button role="menuitem" className="danger" onClick={() => act('trash')}>Move to trash</button>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function UnlockedEditor(props: Props) {
  const { note, tags, onSave } = props
  const [title, setTitle] = useState(note.title)
  const [text, setText] = useState(note.text)
  const [mode, setModeState] = useState<EditorMode>(() => note.locked ? 'preview' : readMode())
  const [tagInput, setTagInput] = useState('')
  const textarea = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const dirty = useRef(false)
  const timer = useRef<number | null>(null)
  const latestNote = useRef(note)
  latestNote.current = note
  const saveRef = useRef(onSave)
  saveRef.current = onSave
  const content = useRef({ title, text })
  content.current = { title, text }
  const readOnly = note.locked || !!note.trashed_at

  // Payload as the user currently sees it, including unsaved typing.
  const latest = (): NotePayload => {
    const base = stripNote(latestNote.current)
    if (!dirty.current) return base
    return { ...base, ...content.current, edited_at: new Date().toISOString() }
  }

  const flush = () => {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null }
    if (!dirty.current) return
    const payload = latest()
    dirty.current = false
    saveRef.current(latestNote.current, payload)
  }

  // Save on leaving the note or the page, never lose the last keystrokes.
  useEffect(() => {
    const onHide = () => flush()
    window.addEventListener('pagehide', onHide)
    return () => { window.removeEventListener('pagehide', onHide); flush() }
  }, [])

  // Adopt edits from another device while this note has no unsaved typing.
  useEffect(() => {
    if (dirty.current) return
    setTitle(note.title)
    setText(note.text)
  }, [note.title, note.text])

  useEffect(() => { if (note.locked) setModeState('preview') }, [note.locked])

  function schedule() {
    dirty.current = true
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, AUTOSAVE_MS)
  }

  function setMode(next: EditorMode) {
    setModeState(next)
    try { localStorage.setItem(MODE_KEY, next) } catch { /* storage unavailable */ }
  }

  function format(kind: Parameters<typeof applyFormat>[3]) {
    const el = textarea.current
    if (!el || readOnly) return
    const edit = applyFormat(text, el.selectionStart, el.selectionEnd, kind)
    setText(edit.text)
    content.current = { title, text: edit.text }
    schedule()
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(edit.selectionStart, edit.selectionEnd) })
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key === 'b') { e.preventDefault(); format('bold') }
    else if (mod && e.key === 'i') { e.preventDefault(); format('italic') }
    else if (mod && e.key === 's') { e.preventDefault(); flush() }
    else if (e.key === 'Tab') {
      e.preventDefault()
      const el = e.currentTarget
      const { selectionStart: start, selectionEnd: end } = el
      const next = text.slice(0, start) + '  ' + text.slice(end)
      setText(next)
      content.current = { title, text: next }
      schedule()
      requestAnimationFrame(() => el.setSelectionRange(start + 2, start + 2))
    }
  }

  function insertAtCursor(snippet: string) {
    const el = textarea.current
    const current = content.current.text
    const at = el ? el.selectionEnd : current.length
    const before = current.slice(0, at)
    const glue = before && !before.endsWith('\n') ? '\n' : ''
    const next = before + glue + snippet + '\n' + current.slice(at)
    setText(next)
    content.current = { title: content.current.title, text: next }
    schedule()
  }

  async function handleFiles(list: FileList | null) {
    if (!list?.length || !props.uploadFiles) return
    const uploaded = await props.uploadFiles([...list])
    if (fileInput.current) fileInput.current.value = ''
    if (uploaded.length) insertAtCursor(uploaded.map(a => attachmentMarkdown(a.id, a.name, isImage(a.mime))).join('\n'))
  }

  function handleToggleTask(index: number) {
    const next = toggleTask(text, index)
    if (next === text) return
    setText(next)
    content.current = { title, text: next }
    schedule()
  }

  function addTag() {
    const path = tagInput.trim()
    if (!path) return
    const tagId = props.onAddTag(path)
    setTagInput('')
    if (!tagId || note.tag_ids.includes(tagId)) return
    // Any pending autosave rebuilds from the updated note, so it keeps the tag.
    onSave(latestNote.current, { ...latest(), tag_ids: [...latestNote.current.tag_ids, tagId] })
  }

  function removeTag(tagId: string) {
    onSave(latestNote.current, { ...latest(), tag_ids: latestNote.current.tag_ids.filter(id => id !== tagId) })
  }

  const noteTags = liveTagIds(note, tags)
  const words = wordCount(text)
  const editorProps = { ...props, latest, flush }

  return (
    <div className="note-editor">
      <EditorHeader {...editorProps} title={displayTitle({ ...note, title, text })} />
      {props.error && <div className="form-error" role="alert">{props.error}</div>}
      <input
        className="note-title-input"
        value={title}
        placeholder="Title"
        readOnly={readOnly}
        onChange={e => { setTitle(e.target.value); content.current = { title: e.target.value, text }; schedule() }}
        aria-label="Note title"
      />
      <div className="note-tags">
        {noteTags.map(id => (
          <span key={id} className="note-tag-chip">
            #{tagPath(tags, id)}
            {!readOnly && <button onClick={() => removeTag(id)} aria-label={`Remove tag ${tagPath(tags, id)}`}>×</button>}
          </span>
        ))}
        {!readOnly && (
          <>
            <input
              className="note-tag-input"
              value={tagInput}
              list={`tag-options-${note.id}`}
              placeholder="+ tag"
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
              onBlur={addTag}
              aria-label="Add tag"
            />
            <datalist id={`tag-options-${note.id}`}>
              {tags.filter(t => !noteTags.includes(t.id)).map(t => <option key={t.id} value={tagPath(tags, t.id)} />)}
            </datalist>
          </>
        )}
      </div>
      <div className="note-toolbar">
        {!readOnly && mode !== 'preview' && (
          <div className="note-format-btns">
            <button onClick={() => format('bold')} title="Bold (Ctrl+B)"><b>B</b></button>
            <button onClick={() => format('italic')} title="Italic (Ctrl+I)"><i>I</i></button>
            <button onClick={() => format('heading')} title="Heading">H</button>
            <button onClick={() => format('bullet')} title="Bulleted list">•</button>
            <button onClick={() => format('checklist')} title="Checklist">☑</button>
            <button onClick={() => format('quote')} title="Quote">❝</button>
            <button onClick={() => format('code')} title="Inline code">{'<>'}</button>
            <button onClick={() => format('codeblock')} title="Code block">{'{ }'}</button>
            <button onClick={() => format('link')} title="Link">🔗</button>
            {props.uploadFiles && <button onClick={() => fileInput.current?.click()} title="Attach files">📎</button>}
          </div>
        )}
        <div className="note-mode-btns" role="group" aria-label="Editor layout">
          {(['edit', 'split', 'preview'] as EditorMode[]).map(m => (
            <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)} disabled={readOnly && m !== 'preview'}>
              {m === 'edit' ? 'Edit' : m === 'split' ? 'Split' : 'Preview'}
            </button>
          ))}
        </div>
      </div>
      <div className={`note-body note-body--${mode}`}>
        {mode !== 'preview' && (
          <textarea
            ref={textarea}
            className="note-textarea"
            value={text}
            readOnly={readOnly}
            spellCheck
            placeholder="Start writing… Markdown is supported."
            onChange={e => { setText(e.target.value); content.current = { title, text: e.target.value }; schedule() }}
            onKeyDown={handleKeyDown}
            aria-label="Note text"
          />
        )}
        {mode !== 'edit' && (
          <MarkdownPreview text={text} readOnly={readOnly} onToggleTask={handleToggleTask} resolveImage={props.resolveImage} onOpenAttachment={props.onOpenAttachment} />
        )}
      </div>
      {props.uploadFiles && <input ref={fileInput} type="file" multiple hidden onChange={e => handleFiles(e.target.files)} />}
      {props.attachments && (
        <Attachments
          attachments={props.attachments}
          readOnly={readOnly}
          busy={props.attachmentBusy ?? null}
          onInsert={a => insertAtCursor(attachmentMarkdown(a.id, a.name, isImage(a.mime)))}
          onDownload={a => props.onDownloadAttachment?.(a)}
          onDelete={a => props.onDeleteAttachment?.(a)}
        />
      )}
      <div className="note-footer">
        <span>{words} word{words === 1 ? '' : 's'} · {text.length} characters</span>
        <span>Edited {new Date(note.edited_at).toLocaleString()}</span>
      </div>
    </div>
  )
}
