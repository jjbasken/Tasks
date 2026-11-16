// A new build installs in the background and waits, so an open editor keeps
// the scripts it started with. Installed phone apps are usually suspended rather
// than closed, so offer the update instead of waiting for every window to close.
let waiting: ServiceWorker | null = null
const listeners = new Set<() => void>()
function set(worker: ServiceWorker | null) {
  waiting = worker
  listeners.forEach(listener => listener())
}

export const appUpdate = {
  getSnapshot: () => waiting !== null,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  apply() {
    if (!waiting) return
    // Reload only for the switch this click asked for, not a first install claiming the page.
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true })
    waiting.postMessage({ type: 'SKIP_WAITING' })
  },
}

export function watchForUpdates(registration: ServiceWorkerRegistration) {
  const track = (worker: ServiceWorker | null) => {
    if (!worker) return
    const check = () => {
      // With no controller this is the first install, not an update.
      if (worker.state === 'installed' && navigator.serviceWorker.controller) set(worker)
      else if (worker.state === 'redundant' && waiting === worker) set(null)
    }
    check()
    worker.addEventListener('statechange', check)
  }
  track(registration.waiting)
  registration.addEventListener('updatefound', () => track(registration.installing))
  // Resuming a suspended app does not reload it; look for a new build then.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') registration.update().catch(() => {})
  })
}
