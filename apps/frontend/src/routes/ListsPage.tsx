import { useState } from 'react'
import { useNavigate } from 'react-router'
import { trpc } from '../lib/trpc.js'
import { session } from '../lib/session.js'
import { encryptSymmetric, generateListKey, fromBase64, sealToPublicKey, decryptSymmetric } from '@tasks/shared'
import { Sidebar } from '../components/Sidebar.js'
import { useListsList, type DecryptedList } from '../hooks/useLists.js'
import { useNetworkStatus } from '../hooks/useNetworkStatus.js'

export function ListsPage() {
  const navigate = useNavigate()
  const { data: lists, refetch } = useListsList()
  const createList = trpc.lists.create.useMutation({ onSuccess: () => refetch() })
  const inviteMutation = trpc.lists.invite.useMutation({ onSuccess: () => refetch() })
  const deleteMutation = trpc.lists.delete.useMutation({ onSuccess: () => refetch() })
  const leaveMutation = trpc.lists.leave.useMutation({ onSuccess: () => refetch() })

  const utils = trpc.useUtils()
  const isOnline = useNetworkStatus()
  const [newListName, setNewListName] = useState('')
  const [activeListId] = useState<string>('')
  const [inviteListId, setInviteListId] = useState<string | null>(null)
  const [inviteUsername, setInviteUsername] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmList, setConfirmList] = useState<DecryptedList | null>(null)
  const [confirmTaskCount, setConfirmTaskCount] = useState<number | null>(null)

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
      const invitee = await utils.users.search.fetch({ username: inviteUsername })
      if (!invitee) { setError('User not found'); return }
      const sealedKey = sealToPublicKey(fromBase64(listKeyB64), invitee.publicKey)
      await inviteMutation.mutateAsync({ listId: inviteListId, inviteeUsername: inviteUsername, encryptedListKey: sealedKey })
      setInviteUsername('')
      setInviteListId(null)
    } catch (err: any) {
      setError(err?.message ?? 'Invite failed')
    }
  }

  function confirmMessage(list: DecryptedList, taskCount: number | null): string {
    if (!list.isOwner) return "The list stays for other members; you'll lose access to it."
    const audience = list.isShared ? ' for everyone on the list' : ''
    if (taskCount === null) return `This permanently deletes the list and all of its tasks${audience}.`
    if (taskCount === 0) return `This list has no tasks. Deleting it${audience} can't be undone.`
    return `This permanently deletes ${taskCount} task${taskCount === 1 ? '' : 's'}${audience}.`
  }

  function openConfirm(list: DecryptedList) {
    setError(null)
    setConfirmTaskCount(null)
    setConfirmList(list)
    // Counting rows needs no decryption; a failure just falls back to vaguer wording.
    utils.tasks.list.fetch({ listId: list.id })
      .then(rows => setConfirmTaskCount(rows.length))
      .catch(() => setConfirmTaskCount(null))
  }

  async function handleConfirm() {
    if (!confirmList) return
    setError(null)
    try {
      if (confirmList.isOwner) {
        await deleteMutation.mutateAsync({ listId: confirmList.id })
      } else {
        await leaveMutation.mutateAsync({ listId: confirmList.id })
      }
      setConfirmList(null)
    } catch (err: any) {
      setError(err?.message ?? 'Could not complete that')
    }
  }

  const confirmPending = deleteMutation.isPending || leaveMutation.isPending

  return (
    <div className="app-layout">
      <Sidebar activeListId={activeListId} onSelectList={(id) => navigate(`/tasks?listId=${id}`)} />
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
                <span className="card-row-label">{list.name}</span>
                <span className="card-row-meta">{list.id.slice(0, 12)}…</span>
                {list.isShared && (
                  <button className="btn-accent-sm" onClick={() => setInviteListId(list.id)}>+ Invite</button>
                )}
                {!list.isPersonal && (
                  <button
                    className="btn-danger-sm"
                    onClick={() => openConfirm(list)}
                    disabled={!isOnline}
                    title={isOnline ? undefined : 'Unavailable offline'}
                  >
                    {list.isOwner ? 'Delete' : 'Leave'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {confirmList && (
        <div className="modal-backdrop" onClick={() => setConfirmList(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-title">
              {confirmList.isOwner ? 'Delete' : 'Leave'} “{confirmList.name}”?
            </div>
            <div className="modal-body">{confirmMessage(confirmList, confirmTaskCount)}</div>
            {error && <div className="form-error">{error}</div>}
            <div className="modal-actions">
              <button className="btn-danger" type="button" onClick={handleConfirm} disabled={confirmPending}>
                {confirmPending ? 'Working…' : confirmList.isOwner ? 'Delete list' : 'Leave list'}
              </button>
              <button className="btn-secondary" type="button" onClick={() => setConfirmList(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

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
