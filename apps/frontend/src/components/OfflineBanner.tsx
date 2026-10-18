import { useSyncExternalStore } from 'react'
import { appUpdate } from '../lib/appUpdate.js'
import { offlineStorageStatus } from '../lib/offlineVault.js'
import { session } from '../lib/session.js'
import { Link, useLocation } from 'react-router'
import { useNetworkStatus } from '../hooks/useNetworkStatus.js'
import { useOfflineSync } from '../hooks/useOfflineSync.js'

export function OfflineBanner() {
  const isOnline = useNetworkStatus()
  const onLoginPage = useLocation().pathname === '/login'
  const { pendingCount, error, sync } = useOfflineSync()

  const storageError = useSyncExternalStore(offlineStorageStatus.subscribe, offlineStorageStatus.getSnapshot)
  const updateReady = useSyncExternalStore(appUpdate.subscribe, appUpdate.getSnapshot)
  const needsUnlock = isOnline && !!session.getUserId() && !session.getToken()
  const showStatus = !isOnline || pendingCount > 0 || !!error || !!storageError || needsUnlock
  if (!showStatus && !updateReady) return null

  // Every state names the queued work, so nothing waiting to sync is hidden.
  const pending = pendingCount > 0 ? `${pendingCount} change${pendingCount !== 1 ? 's' : ''} waiting to sync` : null

  return (
    <div className="app-notices">
      {updateReady && (
        <div className="offline-banner offline-banner--update" role="status">
          A new version is ready. <button onClick={appUpdate.apply}>Reload</button>{session.getUserId() && " (you'll unlock again)"}
        </div>
      )}
      {showStatus && (
        <div className={`offline-banner${isOnline ? ' offline-banner--syncing' : ''}`}>
          {storageError ? <span role="alert">{storageError}{pending && ` ${pending}.`}</span>
            : needsUnlock ? <span>Unlocked offline{pending ? ` · ${pending}` : ''}.{!onLoginPage && <> <Link to="/login">Sign in to sync</Link></>}</span>
            : error ? <span role="alert">{error}{pending && ` ${pending}.`} <button onClick={sync}>Retry sync</button> <Link to="/login">Unlock again</Link></span>
            : isOnline ? (
              <>
                <span className="offline-banner-dot offline-banner-dot--syncing" />
                Syncing {pendingCount} change{pendingCount !== 1 ? 's' : ''}…
              </>
            ) : (
              <>
                <span className="offline-banner-dot" />
                Offline{pending ? ` · ${pending}` : ''}
              </>
            )}
        </div>
      )}
    </div>
  )
}
