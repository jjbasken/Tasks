import { initTRPC, TRPCError } from '@trpc/server'
import { eq, count } from 'drizzle-orm'
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

// Allows unauthenticated access when no users exist (first-time bootstrap).
// Once any user exists, requires admin.
export const bootstrapOrAdminProcedure = t.procedure.use(async ({ ctx, next }) => {
  const [{ value: userCount }] = await ctx.db.select({ value: count() }).from(users)
  if (userCount === 0) {
    return next({ ctx: { ...ctx, userId: ctx.userId } })
  }
  if (!ctx.userId) throw new TRPCError({ code: 'UNAUTHORIZED' })
  const [user] = await ctx.db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, ctx.userId))
  if (!user?.isAdmin) throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' })
  return next({ ctx: { ...ctx, userId: ctx.userId } })
})
