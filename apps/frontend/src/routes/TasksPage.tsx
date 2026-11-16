import { useState, useMemo, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router'
import { Sidebar } from '../components/Sidebar.js'
import { TaskList } from '../components/TaskList.js'
import { TaskDetail } from '../components/TaskDetail.js'
import { CalendarView } from '../components/calendar/CalendarView.js'
import { useListsList, useSetListDefaultView } from '../hooks/useLists.js'
import { useNetworkStatus } from '../hooks/useNetworkStatus.js'
import { useTaskList, useUpdateTask, useCreateTask, useClearDone, useDeleteTask, type DecryptedTask } from '../hooks/useTasks.js'
import type { TaskPayload } from '@tasks/shared'
import { nextDueOnCompletion, successorRule, toLocalISODate, bucketForDueDate } from '@tasks/shared'
import { resolveListKey } from '../lib/listKeys.js'
import { spawnedOccurrences } from '../lib/recurrence.js'

type Tab = 'now' | 'later' | 'done' | 'calendar'

export function TasksPage() {
  const [actionError, setActionError] = useState<string | null>(null)
  const [editorListId, setEditorListId] = useState('')
  const [tab, setTab] = useState<Tab>('now')
  const [selectedTask, setSelectedTask] = useState<DecryptedTask | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  // `seq` gives each "More…" its own editor instance, so a new title replaces an open draft for the same day.
  const [createDefaults, setCreateDefaults] = useState<{ dueDate: string; title?: string; seq: number } | null>(null)
  const isOnline = useNetworkStatus()
  const setDefaultView = useSetListDefaultView()
  const { data: lists } = useListsList()
  const [searchParams] = useSearchParams()
  const [activeListId, setActiveListId] = useState<string | null>(() => searchParams.get('listId'))

  const personalList = lists?.find(l => l.isPersonal) ?? lists?.[0] ?? null
  // A deleted or left list can linger in state or in a ?listId= URL; fall back rather
  // than querying a list the server will now reject.
  const activeStillExists = !!activeListId && !!lists?.some(l => l.id === activeListId)
  const currentListId = (activeStillExists ? activeListId : personalList?.id) ?? ''
  const currentList = lists?.find(l => l.id === currentListId)

  // Use refreshed defaults until the user chooses a tab or starts a calendar draft.
  // Preserve their current tab after that for the rest of this list visit.
  const visitListId = useRef<string | null>(null)
  const pickedTabFor = useRef<string | null>(null)
  useEffect(() => {
    if (!currentList) return
    if (visitListId.current !== currentList.id) {
      visitListId.current = currentList.id
      pickedTabFor.current = null
    }
    if (pickedTabFor.current === currentList.id) return
    setTab(currentList.defaultView === 'calendar' ? 'calendar' : 'now')
  }, [currentList?.id, currentList?.defaultView])

  function pickTab(t: Tab) {
    pickedTabFor.current = currentListId
    setTab(t)
  }

  const listKeyB64 = useMemo(() => {
    if (!currentList) return null
    return resolveListKey(currentList.encryptedListKey)
  }, [currentList?.id, currentList?.encryptedListKey])

  const { data: tasks = [] } = useTaskList(currentListId, listKeyB64)
  const updateTask = useUpdateTask(currentListId)
  const createTask = useCreateTask(currentListId)
  const clearDone = useClearDone(currentListId)
  const deleteTask = useDeleteTask(currentListId)
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set())
  const [isUncheckingAll, setIsUncheckingAll] = useState(false)

  useEffect(() => {
    if (!listKeyB64) return
    const in7Days = new Date()
    in7Days.setDate(in7Days.getDate() + 7)
    const cutoff = toLocalISODate(in7Days)
    const toPromote = tasks.filter(t => t.status === 'active' && t.bucket === 'later' && !!t.due_date && t.due_date <= cutoff)
    toPromote.forEach(task => {
      updateTask.mutateAsync(task.id, { ...task, bucket: 'now' }, listKeyB64)
    })
  }, [tasks])

  async function handleToggle(task: DecryptedTask) {
    if (!listKeyB64) return
    if (completingIds.has(task.id)) return
    setCompletingIds(prev => new Set(prev).add(task.id))
    try {
      const isDone = task.status === 'active'
      const updated: TaskPayload = { ...task, status: isDone ? 'done' : 'active', completed_at: isDone ? new Date().toISOString() : null }
      await updateTask.mutateAsync(task.id, updated, listKeyB64)
      if (isDone && task.rrule) {
        // Skips missed occurrences, matching the first ghost the calendar previews.
        const today = toLocalISODate(new Date())
        const next = nextDueOnCompletion(task.rrule, task.due_date, today)
        if (next) {
          const bucket = bucketForDueDate(next, today)
          // Carry the series' end forward so a COUNT doesn't restart on every occurrence.
          const rrule = successorRule(task.rrule, task.due_date ?? today)
          const nextPayload: TaskPayload = { spawned_by: task.id, title: task.title, notes: task.notes, rrule, status: 'active', completed_at: null, due_date: next, bucket }
          await createTask.mutateAsync(nextPayload, listKeyB64)
        }
      } else if (!isDone && task.rrule) {
        // Undoing a completed recurring task — delete the next occurrence that was spawned
        const orphanIds = spawnedOccurrences(tasks, task.id)
        if (orphanIds.length > 0) {
          await clearDone.mutateAsync({ listId: currentListId, taskIds: orphanIds })
        }
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update task')
    } finally {
      setCompletingIds(prev => { const s = new Set(prev); s.delete(task.id); return s })
    }
  }

  // Open the editor scoped to the list the task belongs to, so switching lists while
  // it is open never saves against another list's key.
  function openTask(task: DecryptedTask) {
    setEditorListId(currentListId)
    setSelectedTask(task)
    setShowCreate(false)
    setCreateDefaults(null)
  }

  async function handleMove(task: DecryptedTask, date: string | null) {
    if (!listKeyB64) return
    const bucket = date ? bucketForDueDate(date, toLocalISODate(new Date())) : task.bucket
    try {
      await updateTask.mutateAsync(task.id, { ...task, due_date: date, bucket }, listKeyB64)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not move task')
    }
  }

  /** Resolves true once the task is in the local queue, so the quick-add box can keep a failed title. */
  async function handleQuickAdd(date: string, title: string): Promise<boolean> {
    if (!listKeyB64) return false
    const bucket = bucketForDueDate(date, toLocalISODate(new Date()))
    const payload: TaskPayload = { title, notes: null, rrule: null, status: 'active', completed_at: null, due_date: date, bucket }
    try {
      await createTask.mutateAsync(payload, listKeyB64)
      return true
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not add task')
      return false
    }
  }

  function handleOpenAdd(date: string, title?: string) {
    setSelectedTask(null)
    setEditorListId(currentListId)
    setCreateDefaults(prev => ({ dueDate: date, title, seq: (prev?.seq ?? 0) + 1 }))
    setShowCreate(true)
  }

  function handleToggleDefault(next: boolean) {
    if (!currentListId || setDefaultView.isPending) return
    // Changing the default is a deliberate choice of where you are; don't jump tabs.
    pickedTabFor.current = currentListId
    setDefaultView.mutate(
      { listId: currentListId, view: next ? 'calendar' : 'now' },
      { onError: error => setActionError(error.message || 'Could not save default view') },
    )
  }

  function handleDeleteTask(task: DecryptedTask) {
    if (!window.confirm(`Delete "${task.title}"?`)) return
    if (selectedTask?.id === task.id) setSelectedTask(null)
    deleteTask.mutate({ taskId: task.id })
  }

  async function handleUncheckAll() {
    if (!listKeyB64 || isUncheckingAll) return
    const doneTasks = tasks.filter(t => t.status === 'done')
    if (doneTasks.length === 0) return
    if (!window.confirm(`Mark all ${doneTasks.length} done task${doneTasks.length === 1 ? '' : 's'} as unchecked?`)) return
    setIsUncheckingAll(true)
    try {
      await Promise.all(doneTasks.map(task =>
        updateTask.mutateAsync(task.id, { ...task, status: 'active', completed_at: null }, listKeyB64)
      ))
    } finally {
      setIsUncheckingAll(false)
    }
  }

  return (
    <div className="app-layout">
      <Sidebar activeListId={currentListId} onSelectList={setActiveListId} />
      <div className="main-content">
        <div className="main-header">
          {(['now', 'later', 'done', 'calendar'] as Tab[]).map(t => (
            <button
              key={t}
              className={`tab-btn${tab === t ? ' active' : ''}`}
              onClick={() => pickTab(t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
          {tab !== 'done' && (
            <button className="add-task-btn" onClick={() => { setSelectedTask(null); setCreateDefaults(null); setEditorListId(currentListId); setShowCreate(true) }}>
              + Add task
            </button>
          )}
          {tab === 'done' && (
            <>
              <button
                className="add-task-btn"
                onClick={handleUncheckAll}
                disabled={isUncheckingAll}
              >
                Uncheck all
              </button>
              <button
                className="add-task-btn"
                onClick={() => {
                  const doneIds = tasks.filter(t => t.status === 'done').map(t => t.id)
                  if (doneIds.length > 0) clearDone.mutate({ listId: currentListId, taskIds: doneIds })
                }}
              >
                Clear done
              </button>
            </>
          )}
        </div>
        {actionError && <div className="form-error" role="alert">{actionError}</div>}
        {tab === 'calendar' ? (
          <div className="task-list-area cal-area">
            <CalendarView
              // Remount per list so an unsent quick-add draft can't be submitted to another list.
              key={currentListId}
              tasks={tasks}
              onToggle={handleToggle}
              onClickTask={openTask}
              onMove={handleMove}
              onQuickAddStart={() => pickTab('calendar')}
              onQuickAdd={handleQuickAdd}
              onOpenAdd={handleOpenAdd}
              isDefault={currentList?.defaultView === 'calendar'}
              onToggleDefault={currentList ? handleToggleDefault : undefined}
              defaultDisabledReason={!isOnline ? 'Go online to change the default view' : setDefaultView.isPending ? 'Saving…' : null}
            />
          </div>
        ) : (
          <div className="task-list-area">
            <TaskList tasks={tasks} bucket={tab} onToggle={handleToggle} onClickTask={openTask} onDeleteTask={handleDeleteTask} completingIds={completingIds} />
          </div>
        )}
      </div>
      {editorListId === currentListId && (selectedTask || showCreate) && (
        <TaskDetail
          key={`${currentListId}:${selectedTask?.id ?? `new:${createDefaults ? `${createDefaults.dueDate}:${createDefaults.seq}` : ''}`}`}
          task={selectedTask ?? null}
          initialDueDate={selectedTask ? undefined : createDefaults?.dueDate}
          initialTitle={selectedTask ? undefined : createDefaults?.title}
          listId={currentListId}
          listKeyB64={listKeyB64 ?? ''}
          onClose={() => { setSelectedTask(null); setShowCreate(false); setCreateDefaults(null) }}
        />
      )}
    </div>
  )
}
