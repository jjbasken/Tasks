import { TRPCError } from '@trpc/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { router, publicProcedure, protectedProcedure } from '../trpc.js'
import { users, lists, listMemberships } from '../db/schema.js'
import { signToken } from '../lib/jwt.js'

export const authRouter = router({
  getLoginChallenge: publicProcedure
    .input(z.object({ username: z.string() }))
    .query(async ({ ctx, input }) => {
      const [user] = await ctx.db.select().from(users).where(eq(users.username, input.username))
      if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' })
      return {
        kdfSalt: user.kdfSalt,
        encryptedPrivateKey: user.encryptedPrivateKey,
        encryptedPersonalListKey: user.encryptedPersonalListKey,
      }
    }),

  register: publicProcedure
    .input(z.object({
      username: z.string().min(2).max(40),
      email: z.string().email(),
      passwordHash: z.string(),
      publicKey: z.string(),
      kdfSalt: z.string(),
      encryptedPrivateKey: z.string(),
      encryptedPersonalListKey: z.string(),
      encryptedPersonalListName: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.select().from(users).where(eq(users.username, input.username))
      if (existing.length > 0) throw new TRPCError({ code: 'CONFLICT', message: 'Username taken' })
      const passwordHash = await Bun.password.hash(input.passwordHash, { algorithm: 'argon2id' })
      const userId = randomUUID()
      const now = Date.now()
      await ctx.db.insert(users).values({
        id: userId,
        username: input.username,
        email: input.email,
        passwordHash,
        publicKey: input.publicKey,
        kdfSalt: input.kdfSalt,
        encryptedPrivateKey: input.encryptedPrivateKey,
        encryptedPersonalListKey: input.encryptedPersonalListKey,
        createdAt: now,
      })
      // Create the user's personal list + membership so lists.list() works immediately after login
      const listId = randomUUID()
      await ctx.db.insert(lists).values({ id: listId, ownerId: userId, encryptedName: input.encryptedPersonalListName, isShared: false, createdAt: now })
      await ctx.db.insert(listMemberships).values({ id: randomUUID(), listId, userId, encryptedListKey: input.encryptedPersonalListKey, invitedBy: null, createdAt: now })
      return { userId }
    }),

  login: publicProcedure
    .input(z.object({ username: z.string(), passwordHash: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [user] = await ctx.db.select().from(users).where(eq(users.username, input.username))
      if (!user) throw new TRPCError({ code: 'UNAUTHORIZED' })
      const valid = await Bun.password.verify(input.passwordHash, user.passwordHash)
      if (!valid) throw new TRPCError({ code: 'UNAUTHORIZED' })
      const token = await signToken(user.id)
      return { token }
    }),

  logout: protectedProcedure.mutation(() => {
    return { ok: true }
  }),
})
