import { useDroppable } from '@dnd-kit/core'
import type { DecryptedTask } from '../../hooks/useTasks.js'
import { CalendarChip } from './CalendarChip.js'

type Props = {
  tasks: DecryptedTask[]
  onToggle: (task: DecryptedTask) => void
  onClickTask: (task: DecryptedTask) => void
}

export function UnscheduledTray({ tasks, onToggle, onClickTask }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: 'unscheduled' })
  return (
    <aside ref={setNodeRef} className={`cal-tray${isOver ? ' cal-tray-over' : ''}`}>
      <div className="cal-tray-header">
        Unscheduled <span className="cal-tray-count">{tasks.length}</span>
      </div>
      <div className="cal-tray-items">
        {tasks.length === 0 && <p className="cal-tray-empty">Drop a task here to clear its date</p>}
        {tasks.map(t => (
          <CalendarChip key={t.id} placed={{ task: t, kind: 'active' }} onToggle={onToggle} onClick={onClickTask} />
        ))}
      </div>
    </aside>
  )
}
