import { useState, useMemo } from 'react'
import { Sidebar } from '../components/Sidebar.js'
import { TaskList } from '../components/TaskList.js'
import { TaskDetail } from '../components/TaskDetail.js'
import { useListsList } from '../hooks/useLists.js'
import { useTaskList, useUpdateTask, useCreateTask, type DecryptedTask } from '../hooks/useTasks.js'
import { session } from '../lib/session.js'
import type { TaskPayload } from '@tasks/shared'
import { nextOccurrence, decryptSymmetric, openSeal, fromBase64 } from '@tasks/shared'

type Tab = 'now' | 'later' | 'done'

/** Decrypt a list's encryptedListKey into a raw base64 list key.
 *  Personal lists are encrypted symmetrically (EncryptedBlob) with the stretch key.
 *  Shared lists are sealed asymmetrically to the user's public key.
 */
function resolveListKey(encryptedListKey: string, isShared: boolean): string | null {
  if (!isShared) {
    const stretchKey = session.getStretchKey()
    if (!stretchKey) return null
    try { return decryptSymmetric(JSON.parse(encryptedListKey), stretchKey) } catch { return null }
  } else {
    const privateKey = session.getPrivateKey()
    const publicKey = session.getPublicKey()
    if (!privateKey || !publicKey) return null
    try {
      const raw = openSeal(encryptedListKey, publicKey, privateKey)
      return btoa(String.fromCharCode(...raw))
    } catch { return null }
  }
}

export function TasksPage() {
  const [tab, setTab] = useState<Tab>('now')
  const [selectedTask, setSelectedTask] = useState<DecryptedTask | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const { data: lists } = useListsList()
  const [activeListId, setActiveListId] = useState<string | null>(null)

  const personalList = lists?.[0] ?? null
  const currentListId = activeListId ?? personalList?.id ?? ''
  const currentList = lists?.find(l => l.id === currentListId)

  const listKeyB64 = useMemo(() => {
    if (!currentList) return null
    return resolveListKey(currentList.encryptedListKey, currentList.isShared)
  }, [currentList?.id, currentList?.encryptedListKey])

  const { data: tasks = [] } = useTaskList(currentListId, listKeyB64)
  const updateTask = useUpdateTask(currentListId)
  const createTask = useCreateTask(currentListId)

  async function handleToggle(task: DecryptedTask) {
    if (!listKeyB64) return
    const isDone = task.status === 'active'
    const updated: TaskPayload = { ...task, status: isDone ? 'done' : 'active', completed_at: isDone ? new Date().toISOString() : null }
    await updateTask.mutateAsync(task.id, updated, listKeyB64)
    if (isDone && task.rrule) {
      const next = nextOccurrence(task.rrule, new Date())
      if (next) {
        const nextPayload: TaskPayload = { ...task, status: 'active', completed_at: null, due_date: next.toISOString().split('T')[0] }
        await createTask.mutateAsync(nextPayload, listKeyB64)
      }
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <Sidebar activeListId={currentListId} onSelectList={setActiveListId} />
      <div style={{ flex: 1, padding: 24 }}>
        <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
          {(['now', 'later', 'done'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ fontWeight: tab === t ? 'bold' : 'normal', textTransform: 'capitalize', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, borderBottom: tab === t ? '2px solid #4444ff' : '2px solid transparent', paddingBottom: 4 }}>{t}</button>
          ))}
          <button onClick={() => setShowCreate(true)} style={{ marginLeft: 'auto' }}>+ Add task</button>
        </div>
        <TaskList tasks={tasks} bucket={tab} onToggle={handleToggle} onClickTask={setSelectedTask} />
      </div>
      {(selectedTask || showCreate) && (
        <TaskDetail
          task={selectedTask ?? null}
          listId={currentListId}
          listKeyB64={listKeyB64 ?? ''}
          onClose={() => { setSelectedTask(null); setShowCreate(false) }}
        />
      )}
    </div>
  )
}
