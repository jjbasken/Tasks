import { session } from '../lib/session.js'
import { sealToPublicKey } from '@tasks/shared'
import { useDeviceList, usePendingDevices, useApproveDevice, useRevokeDevice } from '../hooks/useDevices.js'
import { Sidebar } from '../components/Sidebar.js'

export function DevicesPage() {
  const { data: devices } = useDeviceList()
  const { data: pending } = usePendingDevices()
  const approve = useApproveDevice()
  const revoke = useRevokeDevice()

  async function handleApprove(deviceId: string, devicePublicKey: string) {
    const privateKey = session.getPrivateKey()
    if (!privateKey) { alert('Session expired — please log in again'); return }
    const privateKeyBytes = new TextEncoder().encode(privateKey)
    const sealed = sealToPublicKey(privateKeyBytes, devicePublicKey)
    await approve.mutateAsync({ deviceId, sealedUserPrivateKey: sealed })
  }

  async function handleRevoke(deviceId: string) {
    if (!confirm('Revoke this device? It will be logged out immediately.')) return
    await revoke.mutateAsync({ deviceId })
  }

  return (
    <div className="app-layout">
      <Sidebar activeListId="" onSelectList={() => {}} />
      <div className="main-content">
        <div className="inner-page">
          <h1 className="page-title">Devices</h1>

          {pending && pending.length > 0 && (
            <div className="pending-section">
              <div className="pending-label">Pending approvals</div>
              {pending.map(d => (
                <div key={d.id} className="card-row" style={{ background: 'transparent', padding: '8px 0', border: 'none' }}>
                  <span className="card-row-label">{d.name}</span>
                  <span className="card-row-meta">{new Date(d.createdAt).toLocaleString()}</span>
                  <button className="btn-approve" onClick={() => handleApprove(d.id, d.publicKey)}>Approve</button>
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
    </div>
  )
}
