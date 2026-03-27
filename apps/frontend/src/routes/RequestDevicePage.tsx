import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router'
import { trpc } from '../lib/trpc.js'
import { session } from '../lib/session.js'
import { initCrypto, generateKeypair, openSeal } from '@tasks/shared'

type Stage = 'form' | 'waiting'

type PendingState = {
  deviceId: string
  pendingToken: string
  devicePublicKey: string
  devicePrivateKey: string
  username: string
}

export function RequestDevicePage() {
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const requestApproval = trpc.devices.requestApproval.useMutation()

  const [stage, setStage] = useState<Stage>('form')
  const [username, setUsername] = useState('')
  const [deviceName, setDeviceName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const pendingRef = useRef<PendingState | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await initCrypto()
      const { publicKey, privateKey } = generateKeypair()
      const result = await requestApproval.mutateAsync({
        username,
        name: deviceName || 'New device',
        devicePublicKey: publicKey,
      })
      pendingRef.current = {
        deviceId: result.deviceId,
        pendingToken: result.pendingToken,
        devicePublicKey: publicKey,
        devicePrivateKey: privateKey,
        username,
      }
      setStage('waiting')
    } catch (err: any) {
      setError(err?.message ?? 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (stage !== 'waiting') return

    const interval = setInterval(async () => {
      const p = pendingRef.current
      if (!p) return
      try {
        const result = await utils.devices.checkApproval.fetch({
          deviceId: p.deviceId,
          pendingToken: p.pendingToken,
        })
        if (!result) return

        const unsealedBytes = openSeal(result.sealedUserPrivateKey, p.devicePublicKey, p.devicePrivateKey)
        const userPrivateKeyB64 = new TextDecoder().decode(unsealedBytes)

        session.setToken(result.token)
        session.setPrivateKey(userPrivateKeyB64)

        const userInfo = await utils.users.search.fetch({ username: p.username })
        if (userInfo) session.setPublicKey(userInfo.publicKey)

        clearInterval(interval)
        navigate('/tasks')
      } catch {
        // polling errors are expected — keep waiting
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [stage])

  if (stage === 'waiting') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-logo">
            <div className="auth-logo-icon">⚡</div>
            <span className="auth-logo-name">Tasks</span>
          </div>
          <h1 className="auth-heading">Waiting for approval</h1>
          <p className="auth-sub">Open the Devices page on a trusted device and approve this request.</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 0' }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%', background: 'var(--warning)',
              boxShadow: '0 0 8px var(--warning)',
              animation: 'pulse 1.5s ease-in-out infinite',
            }} />
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Checking every 3 seconds…</span>
          </div>
          <div className="auth-link-row">
            <button
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13 }}
              onClick={() => { pendingRef.current = null; setStage('form') }}
            >
              Cancel
            </button>
          </div>
          <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-icon">⚡</div>
          <span className="auth-logo-name">Tasks</span>
        </div>
        <h1 className="auth-heading">Add this device</h1>
        <p className="auth-sub">An existing trusted device must approve this request</p>
        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label className="form-label">Username</label>
            <input className="form-input" value={username} onChange={e => setUsername(e.target.value)} required autoFocus />
          </div>
          <div className="form-field">
            <label className="form-label">Device name</label>
            <input className="form-input" placeholder="e.g. MacBook, iPhone…" value={deviceName} onChange={e => setDeviceName(e.target.value)} />
          </div>
          {error && <div className="form-error">{error}</div>}
          <button className="btn-primary" type="submit" disabled={loading}>
            {loading ? 'Requesting…' : 'Request access'}
          </button>
        </form>
        <div className="auth-link-row">
          <Link to="/login">Back to login</Link>
        </div>
        <div className="encrypt-badge">
          <div className="encrypt-dot" />
          Your passphrase is never sent over the network
        </div>
      </div>
    </div>
  )
}
