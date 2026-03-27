import type { TaskPayload } from '@tasks/shared'
import { describeRrule } from '@tasks/shared'

type Task = TaskPayload & { id: string }
type Props = { task: Task; onToggle: (task: Task) => void; onClick: (task: Task) => void }

export function TaskRow({ task, onToggle, onClick }: Props) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}
      onClick={() => onClick(task)}
    >
      <button
        style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid #aaa', background: 'transparent', cursor: 'pointer', flexShrink: 0 }}
        onClick={e => { e.stopPropagation(); onToggle(task) }}
        aria-label="Complete task"
      />
      <span style={{ flex: 1, textDecoration: task.status === 'done' ? 'line-through' : 'none', color: task.status === 'done' ? '#aaa' : 'inherit' }}>
        {task.title}
      </span>
      {task.rrule && (
        <span style={{ fontSize: 11, color: '#888', flexShrink: 0 }} title={describeRrule(task.rrule) ?? ''}>🔁</span>
      )}
    </div>
  )
}
