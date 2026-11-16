import { useState } from 'react'
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
}

export function CalendarDay({ date, today, items, limit, outsideMonth, showWeekday, isDragging, onToggle, onClickTask }: Props) {
  const isPast = date < today
  const isToday = date === today
  const { setNodeRef, isOver } = useDroppable({ id: date, disabled: isPast })
  const [expanded, setExpanded] = useState(false)

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
      </div>
    </div>
  )
}
