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
    <div style={{ position: 'fixed', right: 0, top: 0, width: 360, height: '100vh', background: '#fff', boxShadow: '-2px 0 8px rgba(0,0,0,0.15)', padding: 24, display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>{task ? 'Edit task' : 'New task'}</h2>
        <button onClick={onClose}>✕</button>
      </div>
      <div><label>Title</label><input value={title} onChange={e => setTitle(e.target.value)} style={{ display: 'block', width: '100%' }} autoFocus /></div>
      <div><label>Notes</label><textarea value={notes} onChange={e => setNotes(e.target.value)} style={{ display: 'block', width: '100%', height: 80 }} /></div>
      <div>
        <label>Bucket</label>
        <select value={bucket} onChange={e => setBucket(e.target.value as 'now' | 'later')} style={{ display: 'block', width: '100%' }}>
          <option value="now">Now</option>
          <option value="later">Later</option>
        </select>
      </div>
      <div><label>Due date</label><input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={{ display: 'block', width: '100%' }} /></div>
      <RecurrencePicker value={rrule} onChange={setRrule} />
      <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
        <button onClick={handleSave} style={{ flex: 1 }}>Save</button>
        {task && <button onClick={handleDelete} style={{ color: 'red' }}>Delete</button>}
      </div>
    </div>
  )
}
