import { useState } from 'react'
import { trpc } from '../lib/trpc.js'
import { session } from '../lib/session.js'
import { encryptSymmetric, generateListKey, fromBase64, sealToPublicKey, decryptSymmetric } from '@tasks/shared'

export function ListsPage() {
  const { data: lists, refetch } = trpc.lists.list.useQuery()
  const createList = trpc.lists.create.useMutation({ onSuccess: () => refetch() })
  const inviteMutation = trpc.lists.invite.useMutation({ onSuccess: () => refetch() })

  const [newListName, setNewListName] = useState('')
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
      await inviteMutation.mutateAsync({ listId: inviteListId, inviteeUsername, encryptedListKey: sealedKey })
      setInviteUsername('')
      setInviteListId(null)
    } catch (err: any) {
      setError(err?.message ?? 'Invite failed')
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 600 }}>
      <h1>Lists</h1>
      <section>
        <h2>Create shared list</h2>
        <form onSubmit={handleCreateList} style={{ display: 'flex', gap: 8 }}>
          <input placeholder="List name" value={newListName} onChange={e => setNewListName(e.target.value)} required />
          <button type="submit">Create</button>
        </form>
      </section>
      <section style={{ marginTop: 32 }}>
        <h2>Your lists</h2>
        {lists?.map(list => (
          <div key={list.id} style={{ padding: '10px 0', borderBottom: '1px solid #eee' }}>
            <span>{list.isShared ? '🤝 Shared' : '📋 Personal'} — {list.id.slice(0, 12)}…</span>
            {list.isShared && (
              <button onClick={() => setInviteListId(list.id)} style={{ marginLeft: 12, fontSize: 12 }}>+ Invite</button>
            )}
          </div>
        ))}
      </section>
      {inviteListId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <form onSubmit={handleInvite} style={{ background: '#fff', padding: 24, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 300 }}>
            <h3>Invite to list</h3>
            <input placeholder="Username" value={inviteUsername} onChange={e => setInviteUsername(e.target.value)} required autoFocus />
            {error && <p style={{ color: 'red' }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit">Invite</button>
              <button type="button" onClick={() => setInviteListId(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
