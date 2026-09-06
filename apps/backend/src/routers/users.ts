import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, protectedProcedure, adminProcedure } from '../trpc.js'
import { users } from '../db/schema.js'
import { MAX_ID, MAX_USERNAME } from '../lib/limits.js'

export const usersRouter = router({
  search: protectedProcedure
    .input(z.object({ username: z.string().max(MAX_USERNAME) }))
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
    .input(z.object({ userId: z.string().max(MAX_ID), isAdmin: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.userId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot change your own admin status' })
      }
      await ctx.db.update(users).set({ isAdmin: input.isAdmin }).where(eq(users.id, input.userId))
      return { ok: true }
    }),

  // Revoke all of a user's outstanding tokens by bumping their tokenVersion.
  // Every existing session (password logins and approved devices) is invalidated;
  // the user must log in again, and paired devices must be re-approved.
  revokeSessions: adminProcedure
    .input(z.object({ userId: z.string().max(MAX_ID) }))
    .mutation(async ({ ctx, input }) => {
      const [user] = await ctx.db.select({ tokenVersion: users.tokenVersion }).from(users).where(eq(users.id, input.userId))
      if (!user) throw new TRPCError({ code: 'NOT_FOUND' })
      await ctx.db.update(users).set({ tokenVersion: user.tokenVersion + 1 }).where(eq(users.id, input.userId))
      return { ok: true }
    }),
})
