import { eq } from 'drizzle-orm'
import { verifyToken } from './lib/jwt.js'
import { db as defaultDb, type Db } from './db/index.js'
import { devices } from './db/schema.js'

export type AppContext = {
  db: Db
  userId: string | null
}

export async function createContext({ req }: { req: Request }, dbOverride?: Db): Promise<AppContext> {
  const db = dbOverride ?? defaultDb
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return { db, userId: null }

  const tokenData = await verifyToken(token)
  if (!tokenData) return { db, userId: null }

  // If the token was issued for a specific device, verify the device is still approved
  if (tokenData.deviceId) {
    const [device] = await db.select({ status: devices.status })
      .from(devices)
      .where(eq(devices.id, tokenData.deviceId))
    if (!device || device.status !== 'approved') return { db, userId: null }
  }

  return { db, userId: tokenData.userId }
}
