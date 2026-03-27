import { NavLink } from 'react-router'
import { useListsList } from '../hooks/useLists.js'

type Props = { activeListId: string; onSelectList: (id: string) => void }

export function Sidebar({ activeListId, onSelectList }: Props) {
  const { data: lists } = useListsList()

  return (
    <nav className="sidebar">
      <div className="sidebar-brand">
        <span className="sidebar-brand-icon">⚡</span>
        <span className="sidebar-brand-name">Tasks</span>
      </div>
      <div className="sidebar-section-label">Lists</div>
      {lists?.map(list => (
        <button
          key={list.id}
          className={`sidebar-list-btn${list.id === activeListId ? ' active' : ''}`}
          onClick={() => onSelectList(list.id)}
        >
          <span className="sidebar-list-icon">{list.isShared ? '⇄' : '▪'}</span>
          <span className="sidebar-list-name">{list.isShared ? 'shared' : 'personal'}</span>
        </button>
      ))}
      <div className="sidebar-nav">
        <NavLink to="/lists" className={({ isActive }) => `sidebar-nav-link${isActive ? ' active' : ''}`}>
          <span className="sidebar-nav-icon">⊞</span> Lists
        </NavLink>
        <NavLink to="/devices" className={({ isActive }) => `sidebar-nav-link${isActive ? ' active' : ''}`}>
          <span className="sidebar-nav-icon">◈</span> Devices
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => `sidebar-nav-link${isActive ? ' active' : ''}`}>
          <span className="sidebar-nav-icon">⚙</span> Settings
        </NavLink>
      </div>
    </nav>
  )
}
