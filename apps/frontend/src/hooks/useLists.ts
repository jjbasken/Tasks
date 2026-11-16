import { trpc } from '../lib/trpc.js'
import { useEffect } from 'react'
import { unwrapListKey, readListName, encryptListName } from '../lib/listCrypto.js'
import { useAuth } from './useAuth.js'
import { session } from '../lib/session.js'

export type DecryptedList = {
  id: string
  name: string
  isShared: boolean
  isPersonal: boolean
  isOwner: boolean
  encryptedListKey: string
  needsNameMigration?: boolean
}

export function useListsList() {
  const { isLoggedIn } = useAuth()
  const utils = trpc.useUtils()
  const query = trpc.lists.list.useQuery(undefined, {
    enabled: isLoggedIn,
    select: (rows): DecryptedList[] => {
      const stretchKey = session.getStretchKey()
      const privateKey = session.getPrivateKey()
      const publicKey = session.getPublicKey()
      if (!stretchKey || !privateKey || !publicKey) return []
      const keys = { stretchKey, privateKey, publicKey }
      return rows.map(row => {
        try {
          const listKey = unwrapListKey(row.encryptedListKey, keys)
          const { name, needsMigration } = readListName(row.encryptedName, listKey, keys, row.isOwner)
          return { ...row, name, needsNameMigration: needsMigration }
        } catch {
          return { ...row, name: 'Unable to decrypt list' }
        }
      })
    },
  })
  useEffect(() => {
    if (!navigator.onLine) return
    const stretchKey = session.getStretchKey()
    const privateKey = session.getPrivateKey()
    const publicKey = session.getPublicKey()
    if (!stretchKey || !privateKey || !publicKey) return
    const keys = { stretchKey, privateKey, publicKey }
    const migrations = query.data?.filter(row => row.isOwner && row.needsNameMigration)
    if (!migrations?.length) return
    Promise.all(migrations.map(row => utils.client.lists.rename.mutate({ listId: row.id, encryptedName: encryptListName(row.name, unwrapListKey(row.encryptedListKey, keys)) })))
      .then(() => utils.lists.list.invalidate())
      .catch(() => { /* Retry migration on the next successful list fetch. */ })
  }, [query.data, utils])
  return query
}

export function useCreateList() {
  const utils = trpc.useUtils()
  return trpc.lists.create.useMutation({
    onSuccess: () => utils.lists.list.invalidate(),
  })
}

export function useInviteToList() {
  const utils = trpc.useUtils()
  return trpc.lists.invite.useMutation({
    onSuccess: () => utils.lists.list.invalidate(),
  })
}

export function useDeleteList() {
  const utils = trpc.useUtils()
  return trpc.lists.delete.useMutation({
    onSuccess: () => utils.lists.list.invalidate(),
  })
}

export function useLeaveList() {
  const utils = trpc.useUtils()
  return trpc.lists.leave.useMutation({
    onSuccess: () => utils.lists.list.invalidate(),
  })
}
