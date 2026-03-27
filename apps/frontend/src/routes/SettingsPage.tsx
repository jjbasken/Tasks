import { useAuth } from '../hooks/useAuth.js'

export function SettingsPage() {
  const { logout } = useAuth()
  return (
    <div style={{ padding: 24, maxWidth: 400 }}>
      <h1>Settings</h1>
      <button onClick={logout} style={{ color: 'red', background: 'none', border: '1px solid red', borderRadius: 4, padding: '8px 16px', cursor: 'pointer' }}>
        Log out
      </button>
    </div>
  )
}
