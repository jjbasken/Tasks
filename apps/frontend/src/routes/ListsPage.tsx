import { useState } from 'react'
import { useNavigate } from 'react-router'
import { trpc } from '../lib/trpc.js'
import { session } from '../lib/session.js'
import { encryptSymmetric, generateListKey, fromBase64, sealToPublicKey, decryptSymmetric, publicKeyFingerprint } from '@tasks/shared'
import { Sidebar } from '../components/Sidebar.js'
import { useListsList, type DecryptedList } from '../hooks/useLists.js'
import { useNetworkStatus } from '../hooks/useNetworkStatus.js'
import { checkPublicKey, pinPublicKey } from '../lib/keyPinning.js'

type InviteCandidate = {
  username: string
  publicKey: string
  fingerprint: string
  firstContact: boolean
}

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
  const [inviteCandidate, setInviteCandidate] = useState<InviteCandidate | null>(null)
  const [inviting, setInviting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmList, setConfirmList] = useState<DecryptedList | null>(null)
  const [confirmTaskCount, setConfirmTaskCount] = useState<number | null>(null)

  async function handleCreateList(e: React.FormEvent) {
    e.preventDefault()
    const stretchKey = session.getStretchKey()
    if (!stretchKey) return
    const listKey = generateListKey()
    const encName = encryptSymmetric(newListName, fromBase64(listKey))
    const encKey = encryptSymmetric(listKey, stretchKey)
    await createList.mutateAsync({ encryptedName: JSON.stringify(encName), encryptedListKey: JSON.stringify(encKey) })
    setNewListName('')
  }

  function closeInvite() {
    setInviteListId(null)
    setInviteCandidate(null)
    setInviteUsername('')
    setError(null)
  }

  // Step 1: look the invitee up, then stop. The public key comes from the server, so
  // it gets checked against the pinned copy and shown as a fingerprint before any
  // key material is sealed to it — a swapped key would otherwise silently hand the
  // list contents to whoever supplied it.
  async function handleLookup(e: React.FormEvent) {
    e.preventDefault()
    if (!inviteListId) return
    setError(null)
    try {
      const invitee = await utils.users.search.fetch({ username: inviteUsername })
      if (!invitee) { setError('User not found'); return }
      const status = checkPublicKey(invitee.username, invitee.publicKey)
      if (status === 'mismatch') {
        setError(
          `${invitee.username}'s encryption key has changed since you last shared with them. ` +
          'This can mean they reset their account — or that the key is being substituted. ' +
          'Verify with them directly before sharing anything else.'
        )
        return
      }
      setInviteCandidate({
        username: invitee.username,
        publicKey: invitee.publicKey,
        fingerprint: await publicKeyFingerprint(invitee.publicKey),
        firstContact: status === 'new',
      })
    } catch (err: any) {
      setError(err?.message ?? 'Lookup failed')
    }
  }

  // Step 2: the user has seen the fingerprint. Pin it and seal the list key to it.
  async function handleConfirmInvite() {
    if (!inviteListId || !inviteCandidate) return
    setError(null)
    setInviting(true)
    try {
      const list = lists?.find(l => l.id === inviteListId)
      if (!list) return
      const stretchKey = session.getStretchKey()
      if (!stretchKey) return
      if (pinPublicKey(inviteCandidate.username, inviteCandidate.publicKey) === 'mismatch') {
        setError('Key changed during the invite — aborted. Verify with the recipient and try again.')
        return
      }
      const listKeyB64 = decryptSymmetric(JSON.parse(list.encryptedListKey), stretchKey)
      const sealedKey = sealToPublicKey(fromBase64(listKeyB64), inviteCandidate.publicKey)
      await inviteMutation.mutateAsync({ listId: inviteListId, inviteeUsername: inviteCandidate.username, encryptedListKey: sealedKey })
      closeInvite()
    } catch (err: any) {
      setError(err?.message ?? 'Invite failed')
    } finally {
      setInviting(false)
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
                {/* Gated on what the server actually allows: the owner of a list that
                    is not the personal one. Gating on isShared instead made this
                    unreachable — a new list starts unshared, and only an invite
                    flips that flag, so the button could never appear. */}
                {list.isOwner && !list.isPersonal && (
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

      {inviteListId && !inviteCandidate && (
        <div className="modal-backdrop" onClick={closeInvite}>
          <form className="modal-card" onSubmit={handleLookup} onClick={e => e.stopPropagation()}>
            <div className="modal-title">Invite to list</div>
            <div className="form-field">
              <label className="form-label">Username</label>
              <input className="form-input" placeholder="Username" value={inviteUsername} onChange={e => setInviteUsername(e.target.value)} required autoFocus />
            </div>
            {error && <div className="form-error">{error}</div>}
            <div className="modal-actions">
              <button className="btn-primary" type="submit" style={{ marginTop: 0 }}>Continue</button>
              <button className="btn-secondary" type="button" onClick={closeInvite}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {inviteListId && inviteCandidate && (
        <div className="modal-backdrop" onClick={closeInvite}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Share with {inviteCandidate.username}?</div>
            <div className="modal-body">
              {inviteCandidate.firstContact
                ? `This is the first time you have shared with ${inviteCandidate.username}. Check this fingerprint with them over a channel you trust — a matching fingerprint is what proves the key belongs to them and not to the server.`
                : `This matches the key you have shared with ${inviteCandidate.username} before.`}
            </div>
            <div style={{
              margin: '4px 0 12px', padding: '12px 14px',
              border: '1px solid var(--border)', borderRadius: 8,
              fontFamily: 'ui-monospace, monospace', fontSize: 14, letterSpacing: 1,
              wordBreak: 'break-all',
            }}>
              {inviteCandidate.fingerprint}
            </div>
            {error && <div className="form-error">{error}</div>}
            <div className="modal-actions">
              <button className="btn-primary" type="button" style={{ marginTop: 0 }} onClick={handleConfirmInvite} disabled={inviting}>
                {inviting ? 'Sharing…' : 'Confirm & share'}
              </button>
              <button className="btn-secondary" type="button" onClick={() => { setInviteCandidate(null); setError(null) }}>Back</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
