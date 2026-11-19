import { useEffect, useRef, useState, type KeyboardEvent, type Ref } from 'react'
import { addDays, parseISODate, parseQuickAdd, toLocalISODate } from '@tasks/shared'

type Bucket = 'now' | 'later'

type Props = {
  /** The bucket being viewed; undated tasks land here. */
  bucket: Bucket
  inputRef?: Ref<HTMLInputElement>
  /** Create the task; resolves to the bucket it landed in, or null if it was not saved. */
  onAdd: (title: string, dueDate: string | null) => Bucket | null | Promise<Bucket | null>
  /** Open the full new-task editor, carrying what was typed so far. */
  onOpenAdd: (title?: string, dueDate?: string) => void
}

function formatDue(iso: string, today: string): string {
  if (iso === today) return 'Today'
  if (iso === addDays(today, 1)) return 'Tomorrow'
  const d = parseISODate(iso)
  const sameYear = iso.slice(0, 4) === today.slice(0, 4)
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

export function QuickAddTask({ bucket, inputRef, onAdd, onOpenAdd }: Props) {
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const submitting = useRef(false)

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(t)
  }, [notice])

  const today = toLocalISODate(new Date())
  const parsed = parseQuickAdd(draft, today)

  async function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    // Enter or Escape while an input method is composing belongs to the IME. (229 covers Safari.)
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Escape') { setDraft(''); e.currentTarget.blur(); return }
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (!parsed.title || submitting.current) return
    submitting.current = true
    const submitted = draft
    try {
      const placed = await onAdd(parsed.title, parsed.dueDate)
      if (!placed) return
      // Clear only once accepted, so a failed save keeps the text, and only if it wasn't edited meanwhile.
      setDraft(current => (current === submitted ? '' : current))
      // The task won't show up in this list, so say where it went.
      setNotice(placed !== bucket ? `Added “${parsed.title}” to ${placed === 'now' ? 'Now' : 'Later'}` : null)
    } finally {
      submitting.current = false
    }
  }

  return (
    <div className="quick-add">
      <div className="quick-add-row">
        <span className="quick-add-plus" aria-hidden="true">+</span>
        <input
          ref={inputRef}
          className="quick-add-input"
          placeholder="Add a task… try “Pay rent fri”"
          aria-label={`Add a task to ${bucket === 'now' ? 'Now' : 'Later'}`}
          aria-describedby="quick-add-status"
          enterKeyHint="enter"
          value={draft}
          onChange={e => { setDraft(e.target.value); setNotice(null) }}
          onKeyDown={handleKey}
        />
        {parsed.dueDate && (
          <span className="quick-add-due" title="Due date read from the end of the title">
            {formatDue(parsed.dueDate, today)}
          </span>
        )}
        {draft.trim() ? (
          <button
            type="button"
            className="quick-add-more"
            onMouseDown={e => e.preventDefault()}
            onClick={() => { onOpenAdd(parsed.title || undefined, parsed.dueDate ?? undefined); setDraft('') }}
          >More…</button>
        ) : (
          <kbd className="quick-add-kbd" title="Press N to add a task">N</kbd>
        )}
      </div>
      <div id="quick-add-status" className="quick-add-status" aria-live="polite">{notice}</div>
    </div>
  )
}
