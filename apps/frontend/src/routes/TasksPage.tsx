import { useState, useMemo, useEffect } from 'react'
import { useSearchParams } from 'react-router'
import { Sidebar } from '../components/Sidebar.js'
import { TaskList } from '../components/TaskList.js'
import { TaskDetail } from '../components/TaskDetail.js'
import { useListsList } from '../hooks/useLists.js'
import { useTaskList, useUpdateTask, useCreateTask, useClearDone, type DecryptedTask } from '../hooks/useTasks.js'
import { session } from '../lib/session.js'
import type { TaskPayload } from '@tasks/shared'
import { nextOccurrence, decryptSymmetric, openSeal, fromBase64 } from '@tasks/shared'

type Tab = 'now' | 'later' | 'done'

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
  const [searchParams] = useSearchParams()
  const [activeListId, setActiveListId] = useState<string | null>(() => searchParams.get('listId'))

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
  const clearDone = useClearDone(currentListId)

  useEffect(() => {
    if (!listKeyB64) return
    const in7Days = new Date()
    in7Days.setDate(in7Days.getDate() + 7)
    const cutoff = in7Days.toISOString().split('T')[0]
    const toPromote = tasks.filter(t => t.status === 'active' && t.bucket === 'later' && !!t.due_date && t.due_date <= cutoff)
    toPromote.forEach(task => {
      updateTask.mutateAsync(task.id, { ...task, bucket: 'now' }, listKeyB64)
    })
  }, [tasks])

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
    <div className="app-layout">
      <Sidebar activeListId={currentListId} onSelectList={setActiveListId} />
      <div className="main-content">
        <div className="main-header">
          {(['now', 'later', 'done'] as Tab[]).map(t => (
            <button
              key={t}
              className={`tab-btn${tab === t ? ' active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
          {tab !== 'done' && (
            <button className="add-task-btn" onClick={() => setShowCreate(true)}>
              + Add task
            </button>
          )}
          {tab === 'done' && (
            <button
              className="add-task-btn"
              onClick={() => {
                const doneIds = tasks.filter(t => t.status === 'done').map(t => t.id)
                if (doneIds.length > 0) clearDone.mutate({ listId: currentListId, taskIds: doneIds })
              }}
            >
              Clear done
            </button>
          )}
        </div>
        <div className="task-list-area">
          <TaskList tasks={tasks} bucket={tab} onToggle={handleToggle} onClickTask={setSelectedTask} />
        </div>
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
