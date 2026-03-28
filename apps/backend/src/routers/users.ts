import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { router, protectedProcedure } from '../router.js'
import { users } from '../db/schema.js'

export const usersRouter = router({
  search: protectedProcedure
    .input(z.object({ username: z.string() }))
    .query(async ({ ctx, input }) => {
      const [user] = await ctx.db.select({ userId: users.id, username: users.username, publicKey: users.publicKey }).from(users).where(eq(users.username, input.username))
      return user ?? null
    }),

  me: protectedProcedure.query(async ({ ctx }) => {
    const [user] = await ctx.db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, ctx.userId))
    return { isAdmin: user?.isAdmin ?? false }
  }),
})
