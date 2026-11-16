import { useRef, useState, type KeyboardEvent } from 'react'
import { useDroppable } from '@dnd-kit/core'
import type { Placed } from '@tasks/shared'
import { parseISODate } from '@tasks/shared'
import type { DecryptedTask } from '../../hooks/useTasks.js'
import { CalendarChip } from './CalendarChip.js'

type Props = {
  date: string
  today: string
  items: Placed<DecryptedTask>[]
  /** Max chips before collapsing into "+N more"; undefined shows all. */
  limit?: number
  outsideMonth?: boolean
  showWeekday?: boolean
  isDragging: boolean
  onToggle: (task: DecryptedTask) => void
  onClickTask: (task: DecryptedTask) => void
  onQuickAddStart?: () => void
  /** Create a task due on this date with just a title; resolves false if it was not saved. */
  onQuickAdd: (date: string, title: string) => boolean | Promise<boolean>
  /** Open the full new-task editor for this date, carrying any title typed so far. */
  onOpenAdd: (date: string, title?: string) => void
}

export function CalendarDay({ date, today, items, limit, outsideMonth, showWeekday, isDragging, onToggle, onClickTask, onQuickAddStart, onQuickAdd, onOpenAdd }: Props) {
  const isPast = date < today
  const isToday = date === today
  const { setNodeRef, isOver } = useDroppable({ id: date, disabled: isPast })
  const [expanded, setExpanded] = useState(false)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const submitting = useRef(false)

  function closeAdd() { setAdding(false); setDraft('') }

  async function handleAddKey(e: KeyboardEvent<HTMLInputElement>) {
    // Keep keys away from dnd-kit's keyboard sensor so typing never starts a drag.
    e.stopPropagation()
    // Enter or Escape while an input method is composing confirms or cancels the
    // candidate; it is not meant for this form. (keyCode 229 covers Safari.)
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Escape') { closeAdd(); return }
    if (e.key !== 'Enter') return
    e.preventDefault()
    const title = draft.trim()
    if (!title || submitting.current) return
    submitting.current = true
    try {
      // Clear only once the task is accepted, so a failed save keeps the title to retry,
      // and only if it wasn't edited in the meantime.
      if (await onQuickAdd(date, title)) setDraft(current => (current.trim() === title ? '' : current))
    } finally {
      submitting.current = false
    }
  }

  const overdueCount = isToday ? items.filter(p => p.kind === 'overdue').length : 0
  const visible = limit && !expanded ? items.slice(0, limit) : items
  const hidden = items.length - visible.length
  const d = parseISODate(date)

  const className = [
    'cal-day',
    isToday ? 'cal-day-today' : '',
    isPast ? 'cal-day-past' : '',
    outsideMonth ? 'cal-day-outside' : '',
    isDragging && isPast ? 'cal-day-reject' : '',
    isOver ? 'cal-day-over' : '',
  ].filter(Boolean).join(' ')

  return (
    <div ref={setNodeRef} className={className} aria-label={d.toDateString()}>
      <div className="cal-day-header">
        {showWeekday && <span className="cal-day-weekday">{d.toLocaleDateString(undefined, { weekday: 'short' })}</span>}
        <span className="cal-day-num">{d.getDate()}</span>
        {overdueCount > 0 && (
          <span className="cal-day-overdue" title={`${overdueCount} overdue`}>{overdueCount} overdue</span>
        )}
        {!isPast && (
          <button
            type="button"
            className="cal-add-btn"
            aria-label={`Add task on ${d.toDateString()}`}
            title="Add task"
            onClick={() => { onQuickAddStart?.(); setAdding(true) }}
          >+</button>
        )}
      </div>
      <div className="cal-day-items">
        {visible.map(p => (
          <CalendarChip
            key={p.kind === 'ghost' ? `ghost-${p.task.id}-${date}` : p.task.id}
            placed={p}
            onToggle={onToggle}
            onClick={onClickTask}
          />
        ))}
        {hidden > 0 && (
          <button className="cal-more-btn" onClick={() => setExpanded(true)}>+{hidden} more</button>
        )}
        {expanded && limit && items.length > limit && (
          <button className="cal-more-btn" onClick={() => setExpanded(false)}>Show less</button>
        )}
        {adding && !isPast && (
          <div className="cal-quick-add" onPointerDown={e => e.stopPropagation()}>
            <input
              className="cal-quick-input"
              placeholder="New task…"
              aria-label={`New task title for ${d.toDateString()}`}
              value={draft}
              autoFocus
              onChange={e => setDraft(e.target.value)}
              onKeyDown={handleAddKey}
              onBlur={e => {
                // Leaving for the "More…" button is handled by its click.
                if (e.relatedTarget instanceof Element && e.relatedTarget.closest('.cal-quick-add')) return
                if (!draft.trim()) closeAdd()
              }}
            />
            <button
              type="button"
              className="cal-quick-more"
              // Keep focus in the input so its blur can't close the form before this click lands.
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onOpenAdd(date, draft.trim() || undefined); closeAdd() }}
            >More…</button>
          </div>
        )}
      </div>
    </div>
  )
}
