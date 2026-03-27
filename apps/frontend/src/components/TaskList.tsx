import type { TaskPayload } from '@tasks/shared'
import { TaskRow } from './TaskRow.js'

type Task = TaskPayload & { id: string }
type Props = {
  tasks: Task[]
  bucket: 'now' | 'later' | 'done'
  onToggle: (task: Task) => void
  onClickTask: (task: Task) => void
}

export function TaskList({ tasks, bucket, onToggle, onClickTask }: Props) {
  const filtered = tasks.filter(t =>
    bucket === 'done' ? t.status === 'done' : t.status === 'active' && t.bucket === bucket
  )
  if (filtered.length === 0) return <p style={{ color: '#aaa', fontStyle: 'italic' }}>No tasks here</p>
  return (
    <div>
      {filtered.map(task => (
        <TaskRow key={task.id} task={task} onToggle={onToggle} onClick={onClickTask} />
      ))}
    </div>
  )
}
