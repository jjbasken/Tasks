import { TRPCError } from '@trpc/server'
import { eq, lt, count } from 'drizzle-orm'
import { z } from 'zod'
import { randomUUID, createHmac } from 'crypto'
import { router, publicProcedure, protectedProcedure, bootstrapOrAdminProcedure } from '../trpc.js'
import { users, lists, listMemberships, revokedTokens } from '../db/schema.js'
import { signToken } from '../lib/jwt.js'

// Argon2id hash of a random value, verified against when the username is unknown so
// a failed login costs the same work whether or not the account exists. Without it
// the missing-user path returns in microseconds and leaks which usernames are real.
let dummyHash: Promise<string> | null = null
function getDummyHash(): Promise<string> {
  dummyHash ??= Bun.password.hash(randomUUID(), { algorithm: 'argon2id' })
  return dummyHash
}

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
      if (!user) {
        // Burn the same Argon2id work as a real verification before failing.
        await Bun.password.verify(input.passwordHash, await getDummyHash())
        throw new TRPCError({ code: 'UNAUTHORIZED' })
      }
      const valid = await Bun.password.verify(input.passwordHash, user.passwordHash)
      if (!valid) throw new TRPCError({ code: 'UNAUTHORIZED' })
      const token = await signToken(user.id, user.tokenVersion)
      return {
        token,
        encryptedPrivateKey: user.encryptedPrivateKey,
        encryptedPersonalListKey: user.encryptedPersonalListKey,
      }
    }),

  // Revokes the calling session's own token. Clearing localStorage alone leaves a
  // year-long token valid for anyone who captured it, so the token id goes on the
  // revocation list that createContext checks on every request.
  logout: protectedProcedure.mutation(async ({ ctx }) => {
    if (!ctx.tokenId) return { ok: true }
    const now = Date.now()
    // Expired entries can never match a live token again — drop them as we go.
    await ctx.db.delete(revokedTokens).where(lt(revokedTokens.expiresAt, now))
    await ctx.db
      .insert(revokedTokens)
      .values({ jti: ctx.tokenId, expiresAt: ctx.tokenExpiresAt ?? now })
      .onConflictDoNothing()
    return { ok: true }
  }),
})
