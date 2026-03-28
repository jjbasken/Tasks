import { describeRrule } from '@tasks/shared'
import type { DecryptedTask } from '../hooks/useTasks.js'

type Props = { task: DecryptedTask; onToggle: (task: DecryptedTask) => void; onClick: (task: DecryptedTask) => void }

function formatDueDate(due: string): string {
  const today = new Date().toISOString().split('T')[0]
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
  if (due === today) return 'Today'
  if (due === tomorrow) return 'Tomorrow'
  return new Date(due + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function TaskRow({ task, onToggle, onClick }: Props) {
  const isDone = task.status === 'done'
  const isOverdue = !isDone && !!task.due_date && task.due_date < new Date().toISOString().split('T')[0]
  return (
    <div className="task-row" onClick={() => onClick(task)}>
      <button
        className="task-check-btn"
        onClick={e => { e.stopPropagation(); onToggle(task) }}
        aria-label="Complete task"
        style={isDone ? { borderColor: 'var(--accent)', background: 'var(--accent-dim)' } : undefined}
      />
      <span className={`task-title${isDone ? ' done' : ''}`}>{task.title}</span>
      {task.due_date && (
        <span className={`task-due-badge${isOverdue ? ' overdue' : ''}`}>{formatDueDate(task.due_date)}</span>
      )}
      {task.rrule && (
        <span className="task-recur-badge" title={describeRrule(task.rrule) ?? ''}>↻</span>
      )}
    </div>
  )
}
