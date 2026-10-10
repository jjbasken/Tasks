import { useNavigate } from 'react-router'
import { useAuth } from '../hooks/useAuth.js'
import { Sidebar } from '../components/Sidebar.js'

export function SettingsPage() {
  const navigate = useNavigate()
  const { logout } = useAuth()
  return (
    <div className="app-layout">
      <Sidebar activeListId="" onSelectList={(id) => navigate(`/tasks?listId=${id}`)} />
      <div className="main-content">
        <div className="inner-page">
          <h1 className="page-title">Settings</h1>

          <div className="section-label">Account</div>
          <div className="card" style={{ marginBottom: 0 }}>
            <div className="card-row">
              <span className="card-row-label">Session</span>
              <span className="card-row-meta">Active</span>
            </div>
          </div>

          <div className="danger-zone">
            <div className="danger-zone-title">Danger zone</div>
            <p className="hint-text" style={{ marginBottom: 16 }}>
              Your unlocked keys are kept in this tab only. Refreshing, closing the tab, or logging out locks your vault. Encrypted pending changes stay on this device until you unlock the same account and sync.
            </p>
            <button className="btn-danger" onClick={logout}>Log out</button>
          </div>
        </div>
      </div>
    </div>
  )
}
