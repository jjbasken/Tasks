import { SignJWT, jwtVerify } from 'jose'
import { randomUUID } from 'crypto'

function getSecret() {
  const s = process.env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET env var not set')
  return new TextEncoder().encode(s)
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
    .setExpirationTime('1y')
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
