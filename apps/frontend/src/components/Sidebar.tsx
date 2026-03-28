import { useState } from 'react'
import { NavLink } from 'react-router'
import { useListsList } from '../hooks/useLists.js'

type Props = { activeListId: string; onSelectList: (id: string) => void }

export function Sidebar({ activeListId, onSelectList }: Props) {
  const { data: lists } = useListsList()
  const [mobileOpen, setMobileOpen] = useState(() => window.innerWidth > 768)

  function handleSelectList(id: string) {
    onSelectList(id)
    setMobileOpen(false)
  }

  return (
    <>
      <button className="sidebar-hamburger" aria-label="Open menu" onClick={() => setMobileOpen(true)}>
        <span /><span /><span />
      </button>
      {mobileOpen && <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} />}
      <nav className={`sidebar${mobileOpen ? ' sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <span className="sidebar-brand-icon">⚡</span>
          <span className="sidebar-brand-name">Tasks</span>
          <button className="sidebar-close-btn" aria-label="Close menu" onClick={() => setMobileOpen(false)}>✕</button>
        </div>
        <div className="sidebar-section-label">Lists</div>
        {lists?.map(list => (
          <button
            key={list.id}
            className={`sidebar-list-btn${list.id === activeListId ? ' active' : ''}`}
            onClick={() => handleSelectList(list.id)}
          >
            <span className="sidebar-list-icon">{list.isShared ? '⇄' : '▪'}</span>
            <span className="sidebar-list-name">{list.name}</span>
          </button>
        ))}
        <div className="sidebar-nav">
          <NavLink to="/lists" className={({ isActive }) => `sidebar-nav-link${isActive ? ' active' : ''}`} onClick={() => setMobileOpen(false)}>
            <span className="sidebar-nav-icon">⊞</span> Lists
          </NavLink>
          <NavLink to="/devices" className={({ isActive }) => `sidebar-nav-link${isActive ? ' active' : ''}`} onClick={() => setMobileOpen(false)}>
            <span className="sidebar-nav-icon">◈</span> Devices
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => `sidebar-nav-link${isActive ? ' active' : ''}`} onClick={() => setMobileOpen(false)}>
            <span className="sidebar-nav-icon">⚙</span> Settings
          </NavLink>
        </div>
      </nav>
    </>
  )
}
