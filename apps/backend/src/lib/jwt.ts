import { SignJWT, jwtVerify } from 'jose'

function getSecret() {
  const s = process.env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET env var not set')
  return new TextEncoder().encode(s)
}

export async function signToken(userId: string, deviceId?: string): Promise<string> {
  const payload: Record<string, string> = { sub: userId }
  if (deviceId) payload.did = deviceId
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('100y')
    .sign(getSecret())
}

export async function verifyToken(token: string): Promise<{ userId: string; deviceId?: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret())
    if (!payload.sub) return null
    return {
      userId: payload.sub,
      deviceId: typeof payload.did === 'string' ? payload.did : undefined,
    }
  } catch {
    return null
  }
}
