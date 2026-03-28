import { useState } from 'react'
import { useAuth } from '../hooks/useAuth.js'

export function RegisterPage() {
  const { register } = useAuth()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (passphrase !== confirm) { setError('Passphrases do not match'); return }
    setError(null)
    setSuccess(null)
    setLoading(true)
    try {
      await register(username, email, passphrase)
      setSuccess(`Account created for ${username}`)
      setUsername('')
      setEmail('')
      setPassphrase('')
      setConfirm('')
    } catch (err: any) {
      setError(err?.message ?? 'Registration failed')
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
        <h1 className="auth-heading">Create account</h1>
        <p className="auth-sub">Admin: create a new user account</p>
        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label className="form-label">Username</label>
            <input className="form-input" value={username} onChange={e => setUsername(e.target.value)} required autoFocus />
          </div>
          <div className="form-field">
            <label className="form-label">Email</label>
            <input className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div className="form-field">
            <label className="form-label">Passphrase</label>
            <input className="form-input" type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)} required />
          </div>
          <div className="form-field">
            <label className="form-label">Confirm passphrase</label>
            <input className="form-input" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required />
          </div>
          {error && <div className="form-error">{error}</div>}
          {success && <div className="form-success">{success}</div>}
          <button className="btn-primary" type="submit" disabled={loading}>{loading ? 'Creating account…' : 'Create account'}</button>
        </form>
      </div>
    </div>
  )
}
