import { trpc } from '../lib/trpc.js'
import { decryptSymmetric } from '@tasks/shared'
import { session } from '../lib/session.js'

export type DecryptedList = {
  id: string
  name: string
  isShared: boolean
  isPersonal: boolean
  isOwner: boolean
  encryptedListKey: string
}

export function useListsList() {
  return trpc.lists.list.useQuery(undefined, {
    select: (rows): DecryptedList[] => {
      const stretchKey = session.getStretchKey()
      if (!stretchKey) return []
      return rows.flatMap(row => {
        try {
          const parsed = JSON.parse(row.encryptedName)
          // Handle legacy unencrypted names (plain JSON strings stored pre-encryption)
          const name = typeof parsed === 'string' ? parsed : decryptSymmetric(parsed, stretchKey)
          return [{ id: row.id, name, isShared: row.isShared, isPersonal: row.isPersonal, isOwner: row.isOwner, encryptedListKey: row.encryptedListKey }]
        } catch {
          return []
        }
      })
    },
  })
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
