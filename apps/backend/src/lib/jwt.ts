import { SignJWT, jwtVerify } from 'jose'
import { randomUUID } from 'crypto'

function getSecret() {
  const s = process.env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET env var not set')
  return new TextEncoder().encode(s)
}

/** Minimum length for an HS256 signing key. 32 bytes matches the HMAC-SHA256 block security level. */
const MIN_SECRET_LENGTH = 32

// Values that ship in example env files and tutorials. Anyone who copies
// `.env.example` verbatim gets a publicly known signing key, which is enough to
// mint a token for any account — including an admin one.
const PLACEHOLDER_SECRETS = new Set([
  'change-me', 'changeme', 'change_me', 'secret', 'jwt-secret', 'jwtsecret',
  'password', 'your-secret-here', 'your_secret_here', 'replace-me', 'todo',
])

/**
 * Fail fast at boot on a signing key that cannot be trusted. A merely non-empty
 * check passes `change-me`, which is exactly the value `.env.example` used to
 * carry, so emptiness is not the interesting condition — guessability is.
 */
export function assertUsableJwtSecret(): void {
  const s = process.env.JWT_SECRET
  if (!s) {
    throw new Error('JWT_SECRET environment variable must be set. Generate one with: openssl rand -base64 48')
  }
  if (PLACEHOLDER_SECRETS.has(s.trim().toLowerCase())) {
    throw new Error('JWT_SECRET is a placeholder value. Generate a real one with: openssl rand -base64 48')
  }
  if (s.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters (got ${s.length}). ` +
      'Generate one with: openssl rand -base64 48'
    )
  }
}

export type TokenData = {
  userId: string
  tokenVersion: number
  deviceId?: string
  /** Unique per-token id. Logout adds it to the revocation list. */
  tokenId: string
  /** Token expiry, ms since epoch. Bounds how long its revocation entry must be kept. */
  expiresAt: number
}

export async function signToken(userId: string, tokenVersion: number, deviceId?: string): Promise<string> {
  const payload: Record<string, string | number> = { sub: userId, tv: tokenVersion }
  if (deviceId) payload.did = deviceId
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(randomUUID())
    .setIssuedAt()
    // Keep a stolen browser token useful for hours, not a year. Explicit logout and
    // tokenVersion revocation still terminate it earlier.
    .setExpirationTime('12h')
    .sign(getSecret())
}

export async function verifyToken(token: string): Promise<TokenData | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret())
    if (!payload.sub || typeof payload.tv !== 'number') return null
    // A token with no jti can never be revoked on logout, so refuse it outright
    // rather than accept a session we cannot terminate.
    if (typeof payload.jti !== 'string' || !payload.jti) return null
    if (typeof payload.exp !== 'number') return null
    return {
      userId: payload.sub,
      tokenVersion: payload.tv,
      deviceId: typeof payload.did === 'string' ? payload.did : undefined,
      tokenId: payload.jti,
      expiresAt: payload.exp * 1000,
    }
  } catch {
    return null
  }
}
