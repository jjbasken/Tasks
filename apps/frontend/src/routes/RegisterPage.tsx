import { useState } from 'react'
import { useNavigate, Link } from 'react-router'
import { useAuth } from '../hooks/useAuth.js'

export function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (passphrase !== confirm) { setError('Passphrases do not match'); return }
    setError(null)
    setLoading(true)
    try {
      await register(username, email, passphrase)
      navigate('/tasks')
    } catch (err: any) {
      setError(err?.message ?? 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 400, margin: '80px auto', padding: 24 }}>
      <h1>Create Account</h1>
      <form onSubmit={handleSubmit}>
        <div><label>Username</label><input value={username} onChange={e => setUsername(e.target.value)} required autoFocus /></div>
        <div><label>Email</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></div>
        <div><label>Passphrase</label><input type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)} required /></div>
        <div><label>Confirm passphrase</label><input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required /></div>
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <button type="submit" disabled={loading}>{loading ? 'Creating…' : 'Create account'}</button>
      </form>
      <p><Link to="/login">Back to login</Link></p>
    </div>
  )
}
