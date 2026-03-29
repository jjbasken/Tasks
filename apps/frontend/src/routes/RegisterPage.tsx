import { useState } from 'react'
import { useAuth } from '../hooks/useAuth.js'
import { trpc } from '../lib/trpc.js'

export function RegisterPage() {
  const { register } = useAuth()
  const utils = trpc.useUtils()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const { data: userList } = trpc.users.list.useQuery()
  const meQuery = trpc.users.me.useQuery()
  const setAdminMutation = trpc.users.setAdmin.useMutation({
    onSettled: () => utils.users.list.invalidate(),
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (passphrase !== confirm) { setError('Passphrases do not match'); return }
    setError(null)
    setSuccess(null)
    setLoading(true)
    try {
      await register(username, email, passphrase, isAdmin)
      setSuccess(`Account created for ${username}`)
      setUsername('')
      setEmail('')
      setPassphrase('')
      setConfirm('')
      setIsAdmin(false)
      utils.users.list.invalidate()
    } catch (err: any) {
      setError(err?.message ?? 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page" style={{ maxWidth: 700 }}>
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
          <div className="form-field" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              id="is-admin-checkbox"
              type="checkbox"
              checked={isAdmin}
              onChange={e => setIsAdmin(e.target.checked)}
              style={{ width: 16, height: 16, cursor: 'pointer' }}
            />
            <label htmlFor="is-admin-checkbox" className="form-label" style={{ margin: 0, cursor: 'pointer' }}>
              Admin user
            </label>
          </div>
          {error && <div className="form-error">{error}</div>}
          {success && <div className="form-success">{success}</div>}
          <button className="btn-primary" type="submit" disabled={loading}>{loading ? 'Creating account…' : 'Create account'}</button>
        </form>
      </div>

      {userList && userList.length > 0 && (
        <div className="auth-card" style={{ marginTop: 24 }}>
          <h2 className="auth-heading" style={{ fontSize: 18 }}>All Users</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '8px 4px', color: 'var(--text-muted)', fontWeight: 500 }}>Username</th>
                <th style={{ textAlign: 'left', padding: '8px 4px', color: 'var(--text-muted)', fontWeight: 500 }}>Email</th>
                <th style={{ textAlign: 'left', padding: '8px 4px', color: 'var(--text-muted)', fontWeight: 500 }}>Role</th>
                <th style={{ textAlign: 'left', padding: '8px 4px', color: 'var(--text-muted)', fontWeight: 500 }}>Joined</th>
              </tr>
            </thead>
            <tbody>
              {userList.map(user => {
                const isSelf = user.id === meQuery.data?.id
                return (
                  <tr key={user.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 4px' }}>{user.username}</td>
                    <td style={{ padding: '8px 4px', color: 'var(--text-muted)' }}>{user.email}</td>
                    <td style={{ padding: '8px 4px' }}>
                      <button
                        onClick={() => setAdminMutation.mutate({ userId: user.id, isAdmin: !user.isAdmin })}
                        disabled={isSelf || setAdminMutation.isPending}
                        style={{
                          padding: '2px 10px',
                          borderRadius: 4,
                          border: '1px solid var(--border)',
                          background: user.isAdmin ? 'var(--primary)' : 'transparent',
                          color: user.isAdmin ? '#fff' : 'var(--text-muted)',
                          cursor: isSelf ? 'not-allowed' : 'pointer',
                          fontSize: 12,
                          opacity: isSelf ? 0.5 : 1,
                        }}
                        title={isSelf ? 'Cannot change your own role' : undefined}
                      >
                        {user.isAdmin ? 'Admin' : 'User'}
                      </button>
                    </td>
                    <td style={{ padding: '8px 4px', color: 'var(--text-muted)' }}>
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
