import { eq } from 'drizzle-orm'
import { verifyToken } from './lib/jwt.js'
import { db as defaultDb, type Db } from './db/index.js'
import { devices, revokedTokens, users } from './db/schema.js'

export type AppContext = {
  db: Db
  userId: string | null
  // Present when the request carried a valid token. `logout` uses these to revoke
  // exactly this session. Optional so test callers can build a bare context.
  tokenId?: string | null
  tokenExpiresAt?: number | null
  // Source address for rate limiting, from the reverse proxy. Optional so test
  // callers can build a bare context; limits keyed on an account still apply.
  clientIp?: string | null
}

/**
 * Client address as reported by the reverse proxy in front of this server.
 *
 * The leftmost X-Forwarded-For entry is the original client when exactly one
 * trusted proxy sits in front, which is how nginx is configured here. It is
 * client-controlled if the backend is reachable directly, so nothing that grants
 * access may depend on it — it only ever tightens a rate limit.
 */
function readClientIp(req: Request): string | null {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first.slice(0, 64)
  }
  return req.headers.get('x-real-ip')?.trim().slice(0, 64) || null
}

export async function createContext({ req }: { req: Request }, dbOverride?: Db): Promise<AppContext> {
  const db = dbOverride ?? defaultDb
  const clientIp = readClientIp(req)
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return { db, userId: null, clientIp }

  const tokenData = await verifyToken(token)
  if (!tokenData) return { db, userId: null, clientIp }

  // Reject tokens that were explicitly logged out. Unlike a tokenVersion bump this
  // ends one session without signing the user out on their other devices.
  const [revoked] = await db.select({ jti: revokedTokens.jti })
    .from(revokedTokens)
    .where(eq(revokedTokens.jti, tokenData.tokenId))
  if (revoked) return { db, userId: null, clientIp }

  // Verify the user still exists and the token has not been revoked. A user's
  // tokenVersion is bumped on logout-everywhere / admin revoke, which invalidates
  // every outstanding token for that user (including non-device password logins).
  const [user] = await db.select({ tokenVersion: users.tokenVersion })
    .from(users)
    .where(eq(users.id, tokenData.userId))
  if (!user || user.tokenVersion !== tokenData.tokenVersion) return { db, userId: null, clientIp }

  // If the token was issued for a specific device, verify the device is still approved
  if (tokenData.deviceId) {
    const [device] = await db.select({ status: devices.status })
      .from(devices)
      .where(eq(devices.id, tokenData.deviceId))
    if (!device || device.status !== 'approved') return { db, userId: null, clientIp }
  }

  return { db, userId: tokenData.userId, tokenId: tokenData.tokenId, tokenExpiresAt: tokenData.expiresAt, clientIp }
}
