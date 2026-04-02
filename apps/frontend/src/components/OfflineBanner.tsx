import { useNetworkStatus } from '../hooks/useNetworkStatus.js'
import { useOfflineSync } from '../hooks/useOfflineSync.js'

export function OfflineBanner() {
  const isOnline = useNetworkStatus()
  const { pendingCount } = useOfflineSync()

  if (isOnline && pendingCount === 0) return null

  return (
    <div className={`offline-banner${isOnline ? ' offline-banner--syncing' : ''}`}>
      {isOnline ? (
        <>
          <span className="offline-banner-dot offline-banner-dot--syncing" />
          Syncing {pendingCount} change{pendingCount !== 1 ? 's' : ''}…
        </>
      ) : (
        <>
          <span className="offline-banner-dot" />
          Offline{pendingCount > 0 ? ` · ${pendingCount} change${pendingCount !== 1 ? 's' : ''} pending` : ''}
        </>
      )}
    </div>
  )
}
