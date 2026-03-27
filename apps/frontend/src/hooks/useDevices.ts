import { trpc } from '../lib/trpc.js'

export function useDeviceList() {
  return trpc.devices.list.useQuery()
}

export function usePendingDevices() {
  return trpc.devices.listPending.useQuery(undefined, { refetchInterval: 10_000 })
}

export function useApproveDevice() {
  const utils = trpc.useUtils()
  return trpc.devices.approve.useMutation({ onSuccess: () => { utils.devices.listPending.invalidate(); utils.devices.list.invalidate() } })
}

export function useRevokeDevice() {
  const utils = trpc.useUtils()
  return trpc.devices.revoke.useMutation({ onSuccess: () => utils.devices.list.invalidate() })
}
