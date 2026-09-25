import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router'
import { trpc } from '../lib/trpc.js'
import { session } from '../lib/session.js'
import { pinPublicKey } from '../lib/keyPinning.js'
import { initCrypto, generateKeypair, openSeal, deviceVerificationCode, fromBase64, type DeviceKeyBundle } from '@tasks/shared'
import { useAuth } from '../hooks/useAuth.js'

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
  const { activateSession } = useAuth()
  const utils = trpc.useUtils()
  const requestApproval = trpc.devices.requestApproval.useMutation()

  const [stage, setStage] = useState<Stage>('form')
  const [username, setUsername] = useState('')
  const [deviceName, setDeviceName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [verificationCode, setVerificationCode] = useState('')

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
      // Derived locally from this device's own key — the approving device derives
      // the same value from the key it is about to seal to, so a matching code
      // means no one has swapped it in between.
      setVerificationCode(await deviceVerificationCode(publicKey))
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

    async function poll() {
      const p = pendingRef.current
      if (!p) return
      let result
      try {
        result = await utils.client.devices.checkApproval.mutate({
          deviceId: p.deviceId,
          pendingToken: p.pendingToken,
        })
      } catch {
        // polling errors are expected — keep waiting
        return
      }
      if (!result) return

      // checkApproval hands out the token exactly once, so from here on a failure
      // is final: stop polling and tell the user instead of waiting forever.
      clearInterval(interval)
      try {
        const unsealedBytes = openSeal(result.sealedUserPrivateKey, p.devicePublicKey, p.devicePrivateKey)
        const decoded = new TextDecoder().decode(unsealedBytes)
        const bundle = JSON.parse(decoded) as DeviceKeyBundle
        if (bundle.version !== 1 || typeof bundle.privateKey !== 'string' || typeof bundle.stretchKey !== 'string' || typeof bundle.publicKey !== 'string' || typeof bundle.isAdmin !== 'boolean') {
          throw new Error('The approving device sent an unsupported key bundle')
        }

        session.setToken(result.token)
        session.setPrivateKey(bundle.privateKey)
        session.setStretchKey(fromBase64(bundle.stretchKey))
        session.setPublicKey(bundle.publicKey)
        pinPublicKey(p.username, bundle.publicKey)
        activateSession(bundle.isAdmin)
        navigate('/tasks')
      } catch (err: any) {
        session.clear()
        pendingRef.current = null
        setError(err?.message ?? 'Could not open the approved key bundle')
        setStage('form')
      }
    }

    const interval = setInterval(poll, 3000)

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') poll()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
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
          <p className="auth-sub">Open the Devices page on a trusted device and enter this code.</p>
          <div style={{
            margin: '20px 0 8px', padding: '18px 0', textAlign: 'center',
            border: '1px solid var(--border)', borderRadius: 8,
            fontSize: 34, fontWeight: 600, letterSpacing: 8, fontFamily: 'ui-monospace, monospace',
          }}>
            {verificationCode || '••••••'}
          </div>
          <p className="hint-text" style={{ marginBottom: 8 }}>
            Type this code on your trusted device. Never accept a code someone sends you —
            it must come from the screen in front of you. Expires in 10 minutes.
          </p>
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
              onClick={() => { pendingRef.current = null; setVerificationCode(''); setStage('form') }}
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
