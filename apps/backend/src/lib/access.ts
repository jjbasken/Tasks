import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { listMemberships } from '../db/schema.js'

/** Membership is the only authority over a list's contents. */
export async function assertListAccess(db: any, listId: string, userId: string) {
  const [membership] = await db
    .select()
    .from(listMemberships)
    .where(and(eq(listMemberships.listId, listId), eq(listMemberships.userId, userId)))
  if (!membership) throw new TRPCError({ code: 'FORBIDDEN' })
}
