import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../hooks/useAuth.js'
import { offlineQueue } from '../lib/offlineQueue.js'
import { Sidebar } from '../components/Sidebar.js'
import { NotesBackup } from '../components/notes/NotesBackup.js'

export function SettingsPage() {
  const navigate = useNavigate()
  const { logout, forgetDevice } = useAuth()
  const [forgetError, setForgetError] = useState<string | null>(null)

  async function handleForget() {
    let pending = 0
    try { pending = offlineQueue.count() } catch { /* Unreadable changes are deleted too. */ }
    const warning = pending > 0
      ? `${pending} unsynced change${pending !== 1 ? 's' : ''} will be lost. `
      : ''
    if (!window.confirm(`${warning}Remove the offline copy of your vault from this device and log out?`)) return
    setForgetError(null)
    try { await forgetDevice() } catch { setForgetError('Could not remove all offline data. Clear this site\'s data in your browser settings.') }
  }

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

          <NotesBackup />

          <div className="danger-zone">
            <div className="danger-zone-title">Danger zone</div>
            <p className="hint-text" style={{ marginBottom: 16 }}>
              Your unlocked keys are kept in this tab only. Refreshing, closing the tab, or logging out locks your vault. Logging out keeps the encrypted offline copy and pending changes on this device, so you can unlock them again with your passphrase.
            </p>
            <button className="btn-danger" onClick={logout}>Log out</button>
            <p className="hint-text" style={{ margin: '16px 0' }}>
              On a shared or lost device, remove the offline copy instead. Signing in online again turns offline access back on.
            </p>
            <button className="btn-danger" onClick={handleForget}>Remove offline data and log out</button>
            {forgetError && <div className="form-error" role="alert" style={{ marginTop: 12 }}>{forgetError}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
