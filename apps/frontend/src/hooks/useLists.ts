import { useEffect } from 'react'
import { trpc } from '../lib/trpc.js'
import { decryptSymmetric, encryptSymmetric, fromBase64 } from '@tasks/shared'
import { session } from '../lib/session.js'
import { resolveListKey } from '../lib/listKeys.js'

const migratingNames = new Set<string>()

export type DecryptedList = {
  id: string
  name: string
  isShared: boolean
  isPersonal: boolean
  isOwner: boolean
  encryptedListKey: string
  listKeyB64: string
  needsNameMigration: boolean
}

export function useListsList() {
  const utils = trpc.useUtils()
  const migrateName = trpc.lists.updateEncryptedName.useMutation({
    onSuccess: () => utils.lists.list.invalidate(),
  })
  const query = trpc.lists.list.useQuery(undefined, {
    select: (rows): DecryptedList[] => {
      const stretchKey = session.getStretchKey()
      return rows.flatMap(row => {
        const listKeyB64 = resolveListKey(row.encryptedListKey)
        if (!listKeyB64) return []
        try {
          const parsed = JSON.parse(row.encryptedName)
          let name: string
          let needsNameMigration = false
          if (typeof parsed === 'string') {
            name = parsed
            needsNameMigration = true
          } else {
            try {
              name = decryptSymmetric(parsed, fromBase64(listKeyB64))
            } catch {
              if (!stretchKey) return []
              name = decryptSymmetric(parsed, stretchKey)
              needsNameMigration = true
            }
          }
          return [{ id: row.id, name, isShared: row.isShared, isPersonal: row.isPersonal, isOwner: row.isOwner, encryptedListKey: row.encryptedListKey, listKeyB64, needsNameMigration }]
        } catch {
          return []
        }
      })
    },
  })

  useEffect(() => {
    for (const list of query.data ?? []) {
      if (!list.isOwner || !list.needsNameMigration || migratingNames.has(list.id)) continue
      migratingNames.add(list.id)
      const encryptedName = JSON.stringify(encryptSymmetric(list.name, fromBase64(list.listKeyB64)))
      migrateName.mutate({ listId: list.id, encryptedName }, {
        onError: () => migratingNames.delete(list.id),
      })
    }
  }, [query.data])

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
