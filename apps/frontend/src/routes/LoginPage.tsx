import { useState } from 'react'
import { useNavigate, Link } from 'react-router'
import { useAuth } from '../hooks/useAuth.js'

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(username, passphrase)
      navigate('/tasks')
    } catch (err: any) {
      setError(err?.message ?? 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-icon">⚡</div>
          <span className="auth-logo-name">Tasks</span>
        </div>
        <h1 className="auth-heading">Welcome back</h1>
        <p className="auth-sub">Unlock your encrypted vault</p>
        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label className="form-label">Username</label>
            <input className="form-input" value={username} onChange={e => setUsername(e.target.value)} required autoFocus />
          </div>
          <div className="form-field">
            <label className="form-label">Passphrase</label>
            <input className="form-input" type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)} required />
          </div>
          {error && <div className="form-error">{error}</div>}
          <button className="btn-primary" type="submit" disabled={loading}>{loading ? 'Unlocking…' : 'Unlock vault'}</button>
        </form>
        <div className="auth-link-row">
          <Link to="/register">Create an account</Link>
          {' · '}
          <Link to="/device-request">Add this device</Link>
        </div>
        <div className="encrypt-badge">
          <div className="encrypt-dot" />
          End-to-end encrypted — keys never leave your device
        </div>
      </div>
    </div>
  )
}
