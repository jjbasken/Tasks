import type { DecryptedTask } from '../hooks/useTasks.js'
import { TaskRow } from './TaskRow.js'

type Props = {
  tasks: DecryptedTask[]
  bucket: 'now' | 'later' | 'done'
  onToggle: (task: DecryptedTask) => void
  onClickTask: (task: DecryptedTask) => void
  completingIds?: Set<string>
}

export function TaskList({ tasks, bucket, onToggle, onClickTask, completingIds }: Props) {
  const filtered = tasks
    .filter(t => completingIds?.has(t.id) ? false : bucket === 'done' ? t.status === 'done' : t.status === 'active' && t.bucket === bucket)
    .sort((a, b) => {
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
      if (a.due_date) return -1
      if (b.due_date) return 1
      return 0
    })
  if (filtered.length === 0) return <p className="task-empty">No tasks here</p>
  return (
    <div>
      {filtered.map(task => (
        <TaskRow key={task.id} task={task} onToggle={onToggle} onClick={onClickTask} />
      ))}
    </div>
  )
}
