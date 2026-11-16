import type { HTMLAttributes, Ref } from 'react'
import { useDraggable } from '@dnd-kit/core'
import type { Placed } from '@tasks/shared'
import { describeRrule, isSubDailyRule } from '@tasks/shared'
import type { DecryptedTask } from '../../hooks/useTasks.js'

type Props = {
  placed: Placed<DecryptedTask>
  onToggle: (task: DecryptedTask) => void
  onClick: (task: DecryptedTask) => void
  /** Rendered inside the DragOverlay — no drag wiring. */
  overlay?: boolean
}

/**
 * A task on the calendar. Only real active/overdue instances are draggable; ghosts
 * (future recurrences) and done tasks are static. Draggables are registered in a
 * separate component so that ghost copies never claim the same dnd-kit id.
 */
export function CalendarChip(props: Props) {
  const { kind } = props.placed
  if (!props.overlay && (kind === 'active' || kind === 'overdue')) return <DraggableChip {...props} />
  return <ChipBody {...props} />
}

function DraggableChip(props: Props) {
  const { task } = props.placed
  const { setNodeRef, setActivatorNodeRef, listeners, attributes, isDragging } = useDraggable({ id: task.id, data: { task } })
  // Mouse and touch drags start anywhere on the chip (a click without movement still
  // opens it). Keyboard drags start only from the handle, so Enter/Space on the title
  // button keeps opening the task.
  const { onKeyDown, ...pointerListeners } = (listeners ?? {}) as Record<string, (e: unknown) => void>
  const handleKeyDown = onKeyDown as HTMLAttributes<HTMLSpanElement>['onKeyDown']
  return (
    <ChipBody
      {...props}
      nodeRef={setNodeRef}
      dragging={isDragging}
      chipProps={pointerListeners}
      handleRef={setActivatorNodeRef}
      handleProps={{ ...attributes, onKeyDown: handleKeyDown, 'aria-label': `Move ${task.title}`, 'aria-roledescription': 'drag handle' }}
    />
  )
}

function ChipBody({ placed, onToggle, onClick, overlay, nodeRef, dragging, chipProps, handleRef, handleProps }: Props & {
  nodeRef?: Ref<HTMLDivElement>
  dragging?: boolean
  chipProps?: HTMLAttributes<HTMLDivElement>
  handleRef?: Ref<HTMLSpanElement>
  handleProps?: HTMLAttributes<HTMLSpanElement>
}) {
  const { task, kind, daysLate } = placed
  const className = [
    'cal-chip',
    `cal-chip-${kind}`,
    dragging ? 'cal-chip-dragging' : '',
    overlay ? 'cal-chip-overlay' : '',
  ].filter(Boolean).join(' ')

  const title = kind === 'ghost'
    ? `Upcoming: ${task.title}`
    : kind === 'overdue' ? `${task.title} (due ${task.due_date})` : task.title
  // Keep these controls from starting a drag on press.
  const stop = { onPointerDown: stopEvent, onMouseDown: stopEvent, onTouchStart: stopEvent }

  return (
    <div ref={nodeRef} className={className} title={title} onClick={() => onClick(task)} {...chipProps}>
      {(handleProps || overlay) && (
        <span ref={handleRef} className="cal-chip-handle" aria-hidden={overlay || undefined} {...handleProps}>⠿</span>
      )}
      {kind !== 'ghost' && (
        <button
          type="button"
          className={`cal-chip-check${kind === 'done' ? ' checked' : ''}`}
          aria-label={kind === 'done' ? `Mark ${task.title} active` : `Complete ${task.title}`}
          {...stop}
          onClick={e => { e.stopPropagation(); onToggle(task) }}
        />
      )}
      <button
        type="button"
        className="cal-chip-title"
        aria-label={kind === 'ghost' ? `Upcoming: ${task.title}` : undefined}
        onClick={e => { e.stopPropagation(); onClick(task) }}
      >
        {task.title}
      </button>
      {task.rrule && <span className="cal-chip-recur" title={recurTitle(task.rrule)}>↻</span>}
      {kind === 'overdue' && <span className="cal-chip-late">{daysLate}d late</span>}
    </div>
  )
}

function recurTitle(rrule: string): string {
  const text = describeRrule(rrule) ?? ''
  return isSubDailyRule(rrule) ? `${text} (shown as every matching day; tasks have no time)` : text
}

function stopEvent(e: { stopPropagation: () => void }) {
  e.stopPropagation()
}
