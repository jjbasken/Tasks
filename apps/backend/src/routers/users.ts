import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, protectedProcedure, adminProcedure } from '../trpc.js'
import { users } from '../db/schema.js'

export const usersRouter = router({
  search: protectedProcedure
    .input(z.object({ username: z.string() }))
    .query(async ({ ctx, input }) => {
      const [user] = await ctx.db.select({ userId: users.id, username: users.username, publicKey: users.publicKey }).from(users).where(eq(users.username, input.username))
      return user ?? null
    }),

  me: protectedProcedure.query(async ({ ctx }) => {
    const [user] = await ctx.db.select({ id: users.id, isAdmin: users.isAdmin }).from(users).where(eq(users.id, ctx.userId))
    return { id: user?.id ?? null, isAdmin: user?.isAdmin ?? false }
  }),

  list: adminProcedure.query(async ({ ctx }) => {
    return ctx.db.select({
      id: users.id,
      username: users.username,
      email: users.email,
      isAdmin: users.isAdmin,
      createdAt: users.createdAt,
    }).from(users).orderBy(users.createdAt)
  }),

  setAdmin: adminProcedure
    .input(z.object({ userId: z.string(), isAdmin: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.userId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot change your own admin status' })
      }
      await ctx.db.update(users).set({ isAdmin: input.isAdmin }).where(eq(users.id, input.userId))
      return { ok: true }
    }),
})
