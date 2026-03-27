import { useState } from 'react'
import { RecurrencePicker } from './RecurrencePicker.js'
import { useCreateTask, useUpdateTask, useDeleteTask } from '../hooks/useTasks.js'
import type { TaskPayload } from '@tasks/shared'

type Task = TaskPayload & { id: string }
type Props = { task: Task | null; listId: string; listKeyB64: string; onClose: () => void }

export function TaskDetail({ task, listId, listKeyB64, onClose }: Props) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [notes, setNotes] = useState(task?.notes ?? '')
  const [bucket, setBucket] = useState<'now' | 'later'>(task?.bucket ?? 'now')
  const [rrule, setRrule] = useState<string | null>(task?.rrule ?? null)
  const [dueDate, setDueDate] = useState(task?.due_date ?? '')

  const createTask = useCreateTask(listId)
  const updateTask = useUpdateTask(listId)
  const deleteTask = useDeleteTask(listId)

  async function handleSave() {
    const payload: TaskPayload = { title, notes: notes || null, bucket, status: task?.status ?? 'active', rrule, due_date: dueDate || null, completed_at: task?.completed_at ?? null }
    if (task) {
      await updateTask.mutateAsync(task.id, payload, listKeyB64)
    } else {
      await createTask.mutateAsync(payload, listKeyB64)
    }
    onClose()
  }

  async function handleDelete() {
    if (!task) return
    if (!confirm('Delete this task?')) return
    await deleteTask.mutateAsync({ taskId: task.id })
    onClose()
  }

  return (
    <div className="task-panel">
      <div className="task-panel-header">
        <span className="task-panel-title">{task ? 'Edit task' : 'New task'}</span>
        <button className="panel-close-btn" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="task-panel-body">
        <div>
          <label className="field-label">Title</label>
          <input className="field-input" value={title} onChange={e => setTitle(e.target.value)} autoFocus />
        </div>
        <div>
          <label className="field-label">Notes</label>
          <textarea className="field-textarea" value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
        <div>
          <label className="field-label">Bucket</label>
          <select className="field-select" value={bucket} onChange={e => setBucket(e.target.value as 'now' | 'later')}>
            <option value="now">Now</option>
            <option value="later">Later</option>
          </select>
        </div>
        <div>
          <label className="field-label">Due date</label>
          <input className="field-input" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
        </div>
        <RecurrencePicker value={rrule} onChange={setRrule} />
      </div>
      <div className="task-panel-footer">
        <button className="panel-save-btn" onClick={handleSave}>Save</button>
        {task && <button className="panel-delete-btn" onClick={handleDelete}>Delete</button>}
      </div>
    </div>
  )
}
