import { useEffect, useMemo, useState } from 'react'
import {
  DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor,
  pointerWithin, rectIntersection, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { addDays, monthGrid, parseISODate, placeTasks, toLocalISODate, weekDays, type Placed } from '@tasks/shared'
import type { DecryptedTask } from '../../hooks/useTasks.js'
import { CalendarDay } from './CalendarDay.js'
import { CalendarChip } from './CalendarChip.js'
import { UnscheduledTray } from './UnscheduledTray.js'

type Mode = 'month' | 'week'
type Props = {
  tasks: DecryptedTask[]
  onToggle: (task: DecryptedTask) => void
  onClickTask: (task: DecryptedTask) => void
  /** Move a task to a date (YYYY-MM-DD), or null to clear its due date. */
  onMove: (task: DecryptedTask, date: string | null) => void
}

const MODE_KEY = 'tasks.calendar.mode'
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function initialMode(): Mode {
  try {
    const saved = localStorage.getItem(MODE_KEY)
    if (saved === 'month' || saved === 'week') return saved
  } catch { /* storage unavailable */ }
  return window.matchMedia?.('(max-width: 768px)').matches ? 'week' : 'month'
}

/** Pointer position wins (precise on a dense grid); fall back to overlap for keyboard drags. */
const collision: CollisionDetection = args => {
  const hits = pointerWithin(args)
  return hits.length > 0 ? hits : rectIntersection(args)
}

function useToday(): string {
  const [today, setToday] = useState(() => toLocalISODate(new Date()))
  useEffect(() => {
    const id = setInterval(() => setToday(toLocalISODate(new Date())), 60_000)
    return () => clearInterval(id)
  }, [])
  return today
}

export function CalendarView({ tasks, onToggle, onClickTask, onMove }: Props) {
  const today = useToday()
  const [mode, setModeState] = useState<Mode>(initialMode)
  const [anchor, setAnchor] = useState(today)
  const [active, setActive] = useState<Placed<DecryptedTask> | null>(null)

  function setMode(m: Mode) {
    setModeState(m)
    try { localStorage.setItem(MODE_KEY, m) } catch { /* ignore */ }
  }

  const anchorDate = parseISODate(anchor)
  const days = mode === 'month' ? monthGrid(anchorDate.getFullYear(), anchorDate.getMonth()) : weekDays(anchor)
  const rangeStart = days[0]
  const rangeEnd = days[days.length - 1]

  const { byDate, unscheduled } = useMemo(
    () => placeTasks(tasks, rangeStart, rangeEnd, today),
    [tasks, rangeStart, rangeEnd, today],
  )

  function shift(dir: -1 | 1) {
    if (mode === 'week') { setAnchor(addDays(anchor, dir * 7)); return }
    const d = parseISODate(anchor)
    setAnchor(toLocalISODate(new Date(d.getFullYear(), d.getMonth() + dir, 1, 12)))
  }

  const rangeTitle = mode === 'month'
    ? anchorDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : `${parseISODate(rangeStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${parseISODate(rangeEnd).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor),
  )

  function handleDragStart(e: DragStartEvent) {
    const task = e.active.data.current?.task as DecryptedTask | undefined
    if (!task) return
    const overdue = !!task.due_date && task.due_date < today
    setActive({ task, kind: overdue ? 'overdue' : 'active' })
  }

  function handleDragEnd(e: DragEndEvent) {
    setActive(null)
    const task = e.active.data.current?.task as DecryptedTask | undefined
    const target = e.over?.id
    if (!task || target == null) return
    if (target === 'unscheduled') {
      if (task.due_date) onMove(task, null)
      return
    }
    const date = String(target)
    if (date < today || date === task.due_date) return
    onMove(task, date)
  }

  const currentMonth = anchorDate.getMonth()

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActive(null)}
    >
      <div className="cal">
        <div className="cal-toolbar">
          <div className="cal-nav">
            <button className="cal-nav-btn" onClick={() => shift(-1)} aria-label="Previous">‹</button>
            <button className="cal-nav-btn cal-today-btn" onClick={() => setAnchor(today)}>Today</button>
            <button className="cal-nav-btn" onClick={() => shift(1)} aria-label="Next">›</button>
            <span className="cal-range-title">{rangeTitle}</span>
          </div>
          <div className="cal-mode" role="group" aria-label="Calendar view">
            {(['month', 'week'] as Mode[]).map(m => (
              <button key={m} className={`cal-mode-btn${mode === m ? ' active' : ''}`} onClick={() => setMode(m)}>
                {m === 'month' ? 'Month' : 'Week'}
              </button>
            ))}
          </div>
        </div>

        <div className="cal-body">
          <div className={`cal-grid cal-grid-${mode}`}>
            {mode === 'month' && WEEKDAYS.map(w => <div key={w} className="cal-weekday">{w}</div>)}
            {days.map(date => (
              <CalendarDay
                key={date}
                date={date}
                today={today}
                items={byDate.get(date) ?? []}
                limit={mode === 'month' ? 3 : undefined}
                outsideMonth={mode === 'month' && parseISODate(date).getMonth() !== currentMonth}
                showWeekday={mode === 'week'}
                isDragging={!!active}
                onToggle={onToggle}
                onClickTask={onClickTask}
              />
            ))}
          </div>
          <UnscheduledTray tasks={unscheduled} onToggle={onToggle} onClickTask={onClickTask} />
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {active && <CalendarChip placed={active} onToggle={() => {}} onClick={() => {}} overlay />}
      </DragOverlay>
    </DndContext>
  )
}
