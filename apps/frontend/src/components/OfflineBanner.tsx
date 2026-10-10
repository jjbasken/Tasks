import { Link } from 'react-router'
import { useNetworkStatus } from '../hooks/useNetworkStatus.js'
import { useOfflineSync } from '../hooks/useOfflineSync.js'

export function OfflineBanner() {
  const isOnline = useNetworkStatus()
  const { pendingCount, error, sync } = useOfflineSync()

  if (isOnline && pendingCount === 0 && !error) return null

  return (
    <div className={`offline-banner${isOnline ? ' offline-banner--syncing' : ''}`}>
      {error ? <span role="alert">{error} <button onClick={sync}>Retry sync</button> <Link to="/login">Unlock again</Link></span> : isOnline ? (
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
