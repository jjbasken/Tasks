import { useState } from 'react'
import { useNavigate } from 'react-router'
import { session } from '../lib/session.js'
import { sealToPublicKey, toBase64, type DeviceKeyBundle } from '@tasks/shared'
import { useDeviceList, usePendingDevices, useApproveDevice, useRevokeDevice } from '../hooks/useDevices.js'
import { Sidebar } from '../components/Sidebar.js'

type PendingDevice = { id: string; name: string; publicKey: string; createdAt: number }

export function DevicesPage() {
  const navigate = useNavigate()
  const { data: devices } = useDeviceList()
  const { data: pending } = usePendingDevices()
  const approve = useApproveDevice()
  const revoke = useRevokeDevice()

  const [confirming, setConfirming] = useState<PendingDevice | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  function openApproval(device: PendingDevice) {
    setError(null)
    setCode('')
    setConfirming(device)
  }

  // Anyone who knows the username can queue a request, so the pending entry itself
  // proves nothing — the code typed here is what binds the approval to the device
  // physically in front of the user. The server re-derives and checks it too.
  async function handleApprove(e: React.FormEvent) {
    e.preventDefault()
    if (!confirming) return
    setError(null)
    const privateKey = session.getPrivateKey()
    const stretchKey = session.getStretchKey()
    const publicKey = session.getPublicKey()
    if (!privateKey || !stretchKey || !publicKey) { setError('Session expired — please log in again'); return }
    try {
      const bundle: DeviceKeyBundle = { version: 1, privateKey, stretchKey: toBase64(stretchKey), publicKey, isAdmin: session.getIsAdmin() }
      const sealed = sealToPublicKey(new TextEncoder().encode(JSON.stringify(bundle)), confirming.publicKey)
      await approve.mutateAsync({
        deviceId: confirming.id,
        verificationCode: code.trim(),
        sealedUserPrivateKey: sealed,
      })
      setConfirming(null)
      setCode('')
    } catch (err: any) {
      setError(err?.message ?? 'Approval failed')
    }
  }

  async function handleRevoke(deviceId: string) {
    if (!confirm('Revoke this device? It will be logged out immediately.')) return
    await revoke.mutateAsync({ deviceId })
  }

  return (
    <div className="app-layout">
      <Sidebar activeListId="" onSelectList={(id) => navigate(`/tasks?listId=${id}`)} />
      <div className="main-content">
        <div className="inner-page">
          <h1 className="page-title">Devices</h1>

          {pending && pending.length > 0 && (
            <div className="pending-section">
              <div className="pending-label">Pending approvals</div>
              <p className="hint-text" style={{ marginBottom: 8 }}>
                Only approve a request you started yourself. The name below is supplied by
                whoever made the request and proves nothing.
              </p>
              {pending.map(d => (
                <div key={d.id} className="card-row" style={{ background: 'transparent', padding: '8px 0', border: 'none' }}>
                  <span className="card-row-label">{d.name}</span>
                  <span className="card-row-meta">{new Date(d.createdAt).toLocaleString()}</span>
                  <button className="btn-approve" onClick={() => openApproval(d)}>Approve</button>
                </div>
              ))}
            </div>
          )}

          <div className="section-label">Trusted devices</div>
          <div className="card">
            {(!devices || devices.length === 0) && (
              <div className="card-row"><span className="card-row-label" style={{ color: 'var(--text-muted)' }}>No approved devices</span></div>
            )}
            {devices?.map(d => (
              <div key={d.id} className="card-row">
                <span className="card-row-label">{d.id.slice(0, 16)}…</span>
                <span className="card-row-meta">{d.approvedAt ? new Date(d.approvedAt).toLocaleDateString() : '—'}</span>
                <button className="btn-danger-ghost" onClick={() => handleRevoke(d.id)}>Revoke</button>
              </div>
            ))}
          </div>

          <div className="section-label" style={{ marginTop: 28 }}>Add this device</div>
          <p className="hint-text">On a new device, go to the login page and choose "Approve via existing device". Then approve it here.</p>
        </div>
      </div>

      {confirming && (
        <div className="modal-backdrop" onClick={() => setConfirming(null)}>
          <form className="modal-card" onSubmit={handleApprove} onClick={e => e.stopPropagation()}>
            <div className="modal-title">Approve “{confirming.name}”?</div>
            <div className="modal-body">
              Approving hands this device the key to your account. Enter the 6-digit code
              shown on the new device's screen. If you did not start this request, cancel —
              do not accept a code sent to you by anyone.
            </div>
            <div className="form-field">
              <label className="form-label">Verification code</label>
              <input
                className="form-input"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                required
                style={{ letterSpacing: 6, fontFamily: 'ui-monospace, monospace' }}
              />
            </div>
            {error && <div className="form-error">{error}</div>}
            <div className="modal-actions">
              <button className="btn-primary" type="submit" style={{ marginTop: 0 }} disabled={code.length !== 6 || approve.isPending}>
                {approve.isPending ? 'Approving…' : 'Approve device'}
              </button>
              <button className="btn-secondary" type="button" onClick={() => setConfirming(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
