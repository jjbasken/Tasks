import { NavLink } from 'react-router'
import { useListsList } from '../hooks/useLists.js'

type Props = { activeListId: string; onSelectList: (id: string) => void }

export function Sidebar({ activeListId, onSelectList }: Props) {
  const { data: lists } = useListsList()

  return (
    <nav style={{ width: 200, borderRight: '1px solid #ddd', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontWeight: 'bold', marginBottom: 8 }}>Lists</div>
      {lists?.map(list => (
        <button
          key={list.id}
          onClick={() => onSelectList(list.id)}
          style={{ textAlign: 'left', background: list.id === activeListId ? '#e8e8ff' : 'transparent', border: 'none', cursor: 'pointer', padding: '6px 8px', borderRadius: 4 }}
        >
          {list.isShared ? '🤝' : '📋'} {list.id.slice(0, 8)}…
        </button>
      ))}
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <NavLink to="/lists">Manage lists</NavLink>
        <NavLink to="/devices">Devices</NavLink>
        <NavLink to="/settings">Settings</NavLink>
      </div>
    </nav>
  )
}
