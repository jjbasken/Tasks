import { describeRrule } from '@tasks/shared'
import type { DecryptedTask } from '../hooks/useTasks.js'

type Props = { task: DecryptedTask; onToggle: (task: DecryptedTask) => void; onClick: (task: DecryptedTask) => void }

export function TaskRow({ task, onToggle, onClick }: Props) {
  const isDone = task.status === 'done'
  return (
    <div className="task-row" onClick={() => onClick(task)}>
      <button
        className="task-check-btn"
        onClick={e => { e.stopPropagation(); onToggle(task) }}
        aria-label="Complete task"
        style={isDone ? { borderColor: 'var(--accent)', background: 'var(--accent-dim)' } : undefined}
      />
      <span className={`task-title${isDone ? ' done' : ''}`}>{task.title}</span>
      {task.rrule && (
        <span className="task-recur-badge" title={describeRrule(task.rrule) ?? ''}>↻</span>
      )}
    </div>
  )
}
