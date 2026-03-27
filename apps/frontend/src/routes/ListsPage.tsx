import { useState } from 'react'
import { trpc } from '../lib/trpc.js'
import { session } from '../lib/session.js'
import { encryptSymmetric, generateListKey, fromBase64, sealToPublicKey, decryptSymmetric } from '@tasks/shared'
import { Sidebar } from '../components/Sidebar.js'

export function ListsPage() {
  const { data: lists, refetch } = trpc.lists.list.useQuery()
  const createList = trpc.lists.create.useMutation({ onSuccess: () => refetch() })
  const inviteMutation = trpc.lists.invite.useMutation({ onSuccess: () => refetch() })

  const [newListName, setNewListName] = useState('')
  const [activeListId] = useState<string>('')
  const [inviteListId, setInviteListId] = useState<string | null>(null)
  const [inviteUsername, setInviteUsername] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleCreateList(e: React.FormEvent) {
    e.preventDefault()
    const stretchKey = session.getStretchKey()
    if (!stretchKey) return
    const listKey = generateListKey()
    const encName = encryptSymmetric(newListName, stretchKey)
    const encKey = encryptSymmetric(listKey, stretchKey)
    await createList.mutateAsync({ encryptedName: JSON.stringify(encName), encryptedListKey: JSON.stringify(encKey) })
    setNewListName('')
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!inviteListId) return
    setError(null)
    try {
      const list = lists?.find(l => l.id === inviteListId)
      if (!list) return
      const stretchKey = session.getStretchKey()
      if (!stretchKey) return
      const listKeyB64 = decryptSymmetric(JSON.parse(list.encryptedListKey), stretchKey)
      const invitee = await trpc.users.search.fetch({ username: inviteUsername })
      if (!invitee) { setError('User not found'); return }
      const sealedKey = sealToPublicKey(fromBase64(listKeyB64), invitee.publicKey)
      await inviteMutation.mutateAsync({ listId: inviteListId, inviteeUsername: inviteUsername, encryptedListKey: sealedKey })
      setInviteUsername('')
      setInviteListId(null)
    } catch (err: any) {
      setError(err?.message ?? 'Invite failed')
    }
  }

  return (
    <div className="app-layout">
      <Sidebar activeListId={activeListId} onSelectList={() => {}} />
      <div className="main-content">
        <div className="inner-page">
          <h1 className="page-title">Lists</h1>

          <div className="section-label">Create shared list</div>
          <form className="inline-form" onSubmit={handleCreateList}>
            <input className="inline-input" placeholder="List name" value={newListName} onChange={e => setNewListName(e.target.value)} required />
            <button className="btn-secondary" type="submit">Create</button>
          </form>

          <div className="section-label">Your lists</div>
          <div className="card">
            {lists?.length === 0 && <div className="card-row"><span className="card-row-label" style={{ color: 'var(--text-muted)' }}>No lists yet</span></div>}
            {lists?.map(list => (
              <div key={list.id} className="card-row">
                <span className="card-row-label">{list.isShared ? 'Shared list' : 'Personal list'}</span>
                <span className="card-row-meta">{list.id.slice(0, 12)}…</span>
                {list.isShared && (
                  <button className="btn-accent-sm" onClick={() => setInviteListId(list.id)}>+ Invite</button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {inviteListId && (
        <div className="modal-backdrop" onClick={() => setInviteListId(null)}>
          <form className="modal-card" onSubmit={handleInvite} onClick={e => e.stopPropagation()}>
            <div className="modal-title">Invite to list</div>
            <div className="form-field">
              <label className="form-label">Username</label>
              <input className="form-input" placeholder="Username" value={inviteUsername} onChange={e => setInviteUsername(e.target.value)} required autoFocus />
            </div>
            {error && <div className="form-error">{error}</div>}
            <div className="modal-actions">
              <button className="btn-primary" type="submit" style={{ marginTop: 0 }}>Invite</button>
              <button className="btn-secondary" type="button" onClick={() => setInviteListId(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
