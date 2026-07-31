import { TRPCError } from '@trpc/server'
import { eq, count } from 'drizzle-orm'
import { z } from 'zod'
import { randomUUID, createHmac } from 'crypto'
import { router, publicProcedure, protectedProcedure, bootstrapOrAdminProcedure } from '../trpc.js'
import { users, lists, listMemberships } from '../db/schema.js'
import { signToken } from '../lib/jwt.js'

// Deterministic decoy salt for unknown usernames so the pre-auth challenge does not
// reveal which accounts exist. Same shape as generateKdfSalt (16 bytes, base64).
function decoyKdfSalt(username: string): string {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET env var not set')
  return createHmac('sha256', secret).update(`kdf-salt:${username}`).digest().subarray(0, 16).toString('base64')
}

export const authRouter = router({
  isBootstrap: publicProcedure.query(async ({ ctx }) => {
    const [{ value: userCount }] = await ctx.db.select({ value: count() }).from(users)
    return { bootstrap: userCount === 0 }
  }),

  getLoginChallenge: publicProcedure
    .input(z.object({ username: z.string() }))
    .query(async ({ ctx, input }) => {
      const [user] = await ctx.db.select({ kdfSalt: users.kdfSalt }).from(users).where(eq(users.username, input.username))
      // Return only the KDF salt (needed to derive the login key). Encrypted key
      // material is handed out by `login`, after the password has been verified.
      // Unknown usernames receive a stable decoy salt to prevent account enumeration.
      return { kdfSalt: user?.kdfSalt ?? decoyKdfSalt(input.username) }
    }),

  register: bootstrapOrAdminProcedure
    .input(z.object({
      username: z.string().min(2).max(40),
      email: z.string().email(),
      passwordHash: z.string(),
      publicKey: z.string(),
      kdfSalt: z.string(),
      encryptedPrivateKey: z.string(),
      encryptedPersonalListKey: z.string(),
      encryptedPersonalListName: z.string(),
      isAdmin: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.select().from(users).where(eq(users.username, input.username))
      if (existing.length > 0) throw new TRPCError({ code: 'CONFLICT', message: 'Username taken' })
      const passwordHash = await Bun.password.hash(input.passwordHash, { algorithm: 'argon2id' })
      const userId = randomUUID()
      const now = Date.now()
      // Bootstrap: first user always becomes admin
      const [{ value: userCount }] = await ctx.db.select({ value: count() }).from(users)
      const isBootstrap = userCount === 0
      await ctx.db.insert(users).values({
        id: userId,
        username: input.username,
        email: input.email,
        passwordHash,
        publicKey: input.publicKey,
        kdfSalt: input.kdfSalt,
        encryptedPrivateKey: input.encryptedPrivateKey,
        encryptedPersonalListKey: input.encryptedPersonalListKey,
        isAdmin: isBootstrap || (input.isAdmin ?? false),
        createdAt: now,
      })
      // Create the user's personal list + membership so lists.list() works immediately after login
      const listId = randomUUID()
      await ctx.db.insert(lists).values({ id: listId, ownerId: userId, encryptedName: input.encryptedPersonalListName, isShared: false, isPersonal: true, createdAt: now })
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
      const token = await signToken(user.id, user.tokenVersion)
      return {
        token,
        encryptedPrivateKey: user.encryptedPrivateKey,
        encryptedPersonalListKey: user.encryptedPersonalListKey,
      }
    }),

  logout: protectedProcedure.mutation(() => {
    return { ok: true }
  }),
})
