import type { DecryptedTask } from '../hooks/useTasks.js'
import { TaskRow } from './TaskRow.js'

type Props = {
  tasks: DecryptedTask[]
  bucket: 'now' | 'later' | 'done'
  onToggle: (task: DecryptedTask) => void
  onClickTask: (task: DecryptedTask) => void
}

export function TaskList({ tasks, bucket, onToggle, onClickTask }: Props) {
  const filtered = tasks.filter(t =>
    bucket === 'done' ? t.status === 'done' : t.status === 'active' && t.bucket === bucket
  )
  if (filtered.length === 0) return <p className="task-empty">No tasks here</p>
  return (
    <div>
      {filtered.map(task => (
        <TaskRow key={task.id} task={task} onToggle={onToggle} onClick={onClickTask} />
      ))}
    </div>
  )
}
