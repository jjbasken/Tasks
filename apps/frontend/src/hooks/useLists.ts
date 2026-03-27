import { trpc } from '../lib/trpc.js'
import { decryptSymmetric } from '@tasks/shared'
import { session } from '../lib/session.js'

export type DecryptedList = {
  id: string
  name: string
  isShared: boolean
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
          return [{ id: row.id, name, isShared: row.isShared, encryptedListKey: row.encryptedListKey }]
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
