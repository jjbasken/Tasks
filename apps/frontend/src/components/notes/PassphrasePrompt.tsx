import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import { trpc } from '../../lib/trpc.js'
import { protection } from '../../lib/protection.js'

type Pending = { reason: string; resolve: (ok: boolean) => void }

/**
 * `requestUnlock(reason)` resolves true once the passphrase checks out, or
 * immediately when a recent unlock is still valid. Render `prompt` once.
 */
export function useProtectionGate() {
  const utils = trpc.useUtils()
  const [pending, setPending] = useState<Pending | null>(null)
  // Re-render when the unlock window opens or closes.
  const unlocked = useSyncExternalStore(protection.subscribe, protection.isUnlocked)
  const [, tick] = useState(0)
  useEffect(() => {
    if (!unlocked) return
    const timer = window.setTimeout(() => { protection.lock(); tick(n => n + 1) }, protection.remainingMs())
    return () => window.clearTimeout(timer)
  }, [unlocked])

  const requestUnlock = useCallback((reason: string) => {
    if (protection.isUnlocked()) return Promise.resolve(true)
    return new Promise<boolean>(resolve => setPending({ reason, resolve }))
  }, [])

  const finish = (ok: boolean) => { pending?.resolve(ok); setPending(null) }
  const prompt = pending && (
    <PassphraseModal
      reason={pending.reason}
      loadSalt={() => utils.client.auth.kdfSalt.query().then(r => r.kdfSalt)}
      onDone={finish}
    />
  )
  return { unlocked, requestUnlock, lock: protection.lock, prompt }
}

function PassphraseModal({ reason, loadSalt, onDone }: { reason: string; loadSalt: () => Promise<string>; onDone: (ok: boolean) => void }) {
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.focus() }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const ok = await protection.verify(passphrase, await loadSalt())
      if (ok) onDone(true)
      else setError('That passphrase is not correct.')
    } catch {
      setError('Could not verify your passphrase. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => onDone(false)}>
      <form className="modal-card" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-title">Enter your passphrase</div>
        <p className="hint-text" style={{ marginBottom: 12 }}>{reason} Protected notes stay open for 5 minutes.</p>
        <input ref={input} className="field-input" type="password" autoComplete="current-password" value={passphrase} onChange={e => setPassphrase(e.target.value)} aria-label="Passphrase" />
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="modal-actions">
          <button type="submit" className="btn-primary" disabled={busy || !passphrase}>{busy ? 'Checking…' : 'Unlock'}</button>
          <button type="button" className="btn-secondary" onClick={() => onDone(false)}>Cancel</button>
        </div>
      </form>
    </div>
  )
}
