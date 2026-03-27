import { session } from '../lib/session.js'
import { sealToPublicKey } from '@tasks/shared'
import { useDeviceList, usePendingDevices, useApproveDevice, useRevokeDevice } from '../hooks/useDevices.js'

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
    <div style={{ padding: 24, maxWidth: 600 }}>
      <h1>Devices</h1>
      {pending && pending.length > 0 && (
        <section style={{ marginBottom: 32, padding: 16, background: '#fff8e0', borderRadius: 8 }}>
          <h2 style={{ marginTop: 0 }}>Pending approvals</h2>
          {pending.map(d => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <span>{d.name}</span>
              <span style={{ color: '#888', fontSize: 12 }}>{new Date(d.createdAt).toLocaleString()}</span>
              <button onClick={() => handleApprove(d.id, d.publicKey)} style={{ marginLeft: 'auto', background: '#22c55e', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer' }}>
                Approve
              </button>
            </div>
          ))}
        </section>
      )}
      <section>
        <h2>Trusted devices</h2>
        {devices?.length === 0 && <p style={{ color: '#aaa' }}>No approved devices</p>}
        {devices?.map(d => (
          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #eee' }}>
            <span style={{ flex: 1 }}>{d.id.slice(0, 8)}…</span>
            <span style={{ color: '#888', fontSize: 12 }}>{d.approvedAt ? new Date(d.approvedAt).toLocaleDateString() : '—'}</span>
            <button onClick={() => handleRevoke(d.id)} style={{ color: 'red', background: 'none', border: 'none', cursor: 'pointer' }}>Revoke</button>
          </div>
        ))}
      </section>
      <section style={{ marginTop: 32 }}>
        <h2>Add this device</h2>
        <p style={{ color: '#666' }}>On a new device, go to the login page and choose "Approve via existing device". Then approve it here.</p>
      </section>
    </div>
  )
}
