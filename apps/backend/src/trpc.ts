import { initTRPC, TRPCError } from '@trpc/server'
import { eq } from 'drizzle-orm'
import type { AppContext } from './context.js'
import { users } from './db/schema.js'

const t = initTRPC.context<AppContext>().create()

export const router = t.router
export const publicProcedure = t.procedure
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: 'UNAUTHORIZED' })
  return next({ ctx: { ...ctx, userId: ctx.userId } })
})
export const adminProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: 'UNAUTHORIZED' })
  const [user] = await ctx.db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, ctx.userId))
  if (!user?.isAdmin) throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' })
  return next({ ctx: { ...ctx, userId: ctx.userId } })
})
