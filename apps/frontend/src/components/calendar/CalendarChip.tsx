import type { HTMLAttributes, Ref } from 'react'
import { useDraggable } from '@dnd-kit/core'
import type { Placed } from '@tasks/shared'
import { describeRrule } from '@tasks/shared'
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
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: task.id, data: { task } })
  return (
    <ChipBody
      {...props}
      nodeRef={setNodeRef}
      dragging={isDragging}
      dragProps={{ ...listeners, ...attributes, 'aria-roledescription': 'draggable task' }}
    />
  )
}

function ChipBody({ placed, onToggle, onClick, overlay, nodeRef, dragging, dragProps }: Props & {
  nodeRef?: Ref<HTMLDivElement>
  dragging?: boolean
  dragProps?: HTMLAttributes<HTMLDivElement>
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

  return (
    <div
      ref={nodeRef}
      className={className}
      title={title}
      role="button"
      tabIndex={0}
      onClick={() => onClick(task)}
      {...dragProps}
    >
      {kind !== 'ghost' && (
        <button
          className={`cal-chip-check${kind === 'done' ? ' checked' : ''}`}
          aria-label={kind === 'done' ? 'Mark task active' : 'Complete task'}
          onPointerDown={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}
          onKeyDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onToggle(task) }}
        />
      )}
      <span className="cal-chip-title">{task.title}</span>
      {task.rrule && <span className="cal-chip-recur" title={describeRrule(task.rrule) ?? ''}>↻</span>}
      {kind === 'overdue' && <span className="cal-chip-late">{daysLate}d late</span>}
    </div>
  )
}
