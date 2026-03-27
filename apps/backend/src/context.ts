import { verifyToken } from './lib/jwt.js'
import { db as defaultDb, type Db } from './db/index.js'

export type AppContext = {
  db: Db
  userId: string | null
}

export async function createContext({ req }: { req: Request }, dbOverride?: Db): Promise<AppContext> {
  const db = dbOverride ?? defaultDb
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  const userId = token ? await verifyToken(token) : null
  return { db, userId }
}
