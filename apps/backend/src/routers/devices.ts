import { TRPCError } from '@trpc/server'
import { eq, and, gt, lt, count } from 'drizzle-orm'
import { z } from 'zod'
import { randomUUID, timingSafeEqual } from 'crypto'
import { deviceVerificationCode } from '@tasks/shared'
import { router, publicProcedure, protectedProcedure } from '../router.js'
import { devices, users } from '../db/schema.js'
import { MAX_ID, MAX_KEY_BLOB, MAX_KEY_MATERIAL, MAX_USERNAME } from '../lib/limits.js'
import { signToken } from '../lib/jwt.js'
import { recordHit, withinLimits, type RateLimit } from '../lib/rateLimit.js'

/** A pending request older than this can no longer be approved. */
const PENDING_TTL_MS = 10 * 60 * 1000
const REQUEST_WINDOW_MS = 15 * 60 * 1000
const MAX_REQUESTS_PER_SOURCE = 30

function codesMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export const devicesRouter = router({
  requestApproval: publicProcedure
    .input(z.object({ username: z.string().max(MAX_USERNAME), name: z.string().max(100), devicePublicKey: z.string().max(MAX_KEY_MATERIAL) }))
    .mutation(async ({ ctx, input }) => {
      const sourceLimits: RateLimit[] = [{
        key: `device-request:ip:${ctx.clientIp ?? 'missing-proxy-address'}`,
        limit: MAX_REQUESTS_PER_SOURCE,
        windowMs: REQUEST_WINDOW_MS,
      }]
      if (!withinLimits(sourceLimits)) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many device requests. Try again later.' })
      }
      recordHit(sourceLimits)

      const [user] = await ctx.db.select().from(users).where(eq(users.username, input.username))
      // Unknown usernames get a well-formed but unapprovable handle. Returning
      // NOT_FOUND here would confirm which accounts exist, defeating the decoy-salt
      // protection on getLoginChallenge. checkApproval will simply never resolve it.
      if (!user) return { deviceId: randomUUID(), pendingToken: randomUUID() }
      const id = randomUUID()
      const pendingToken = randomUUID()
      const created = ctx.db.transaction(tx => {
        const cutoff = Date.now() - PENDING_TTL_MS
        // Expired requests are unapprovable; remove them before enforcing the quota
        // so anonymous callers cannot permanently consume every enrollment slot.
        tx.delete(devices).where(and(
          eq(devices.userId, user.id),
          eq(devices.status, 'pending'),
          lt(devices.createdAt, cutoff),
        )).run()
        const [{ value: pendingCount }] = tx
          .select({ value: count() })
          .from(devices)
          .where(and(eq(devices.userId, user.id), eq(devices.status, 'pending')))
          .all()
        if (pendingCount >= 5) return false
        tx.insert(devices).values({ id, userId: user.id, publicKey: input.devicePublicKey, name: input.name, status: 'pending', pendingToken, createdAt: Date.now() }).run()
        return true
      })
      // Preserve the response shape for real, full accounts and unknown usernames.
      // The returned decoy handle can never resolve because no row was inserted.
      if (!created) return { deviceId: id, pendingToken }
      return { deviceId: id, pendingToken }
    }),

  listPending: protectedProcedure.query(async ({ ctx }) => {
    // Expired requests are hidden so a stale prompt can't be approved much later.
    return ctx.db.select({ id: devices.id, name: devices.name, publicKey: devices.publicKey, createdAt: devices.createdAt })
      .from(devices)
      .where(and(
        eq(devices.userId, ctx.userId),
        eq(devices.status, 'pending'),
        gt(devices.createdAt, Date.now() - PENDING_TTL_MS),
      ))
  }),

  approve: protectedProcedure
    .input(z.object({
      deviceId: z.string().max(MAX_ID),
      // Read off the requesting device's screen by the person approving.
      verificationCode: z.string().regex(/^\d{6}$/),
      sealedUserPrivateKey: z.string().max(MAX_KEY_BLOB),
    }))
    .mutation(async ({ ctx, input }) => {
      const [device] = await ctx.db.select().from(devices).where(and(eq(devices.id, input.deviceId), eq(devices.userId, ctx.userId)))
      if (!device) throw new TRPCError({ code: 'NOT_FOUND' })
      if (device.status !== 'pending') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Device is not awaiting approval' })
      if (Date.now() - device.createdAt > PENDING_TTL_MS) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'This request has expired — start it again on the new device' })
      }
      // Anyone who knows the username can queue a pending request, so approval alone
      // proves nothing. Requiring the code derived from the device's own public key
      // proves the approver can see the device that generated that key.
      const expected = await deviceVerificationCode(device.publicKey)
      if (!codesMatch(input.verificationCode, expected)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Verification code does not match' })
      }
      await ctx.db.update(devices).set({ status: 'approved', sealedUserPrivateKey: input.sealedUserPrivateKey, approvedBy: ctx.userId, approvedAt: Date.now() }).where(eq(devices.id, input.deviceId))
    }),

  checkApproval: publicProcedure
    .input(z.object({ deviceId: z.string().max(MAX_ID), pendingToken: z.string().max(MAX_ID) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction(async (tx) => {
        const [device] = await tx.select().from(devices)
          .where(and(eq(devices.id, input.deviceId), eq(devices.pendingToken, input.pendingToken)))
        if (!device || device.status !== 'approved' || !device.sealedUserPrivateKey) return null
        const [user] = await tx.select({ tokenVersion: users.tokenVersion }).from(users).where(eq(users.id, device.userId))
        if (!user) return null
        // Clear the pendingToken so it cannot be reused
        await tx.update(devices).set({ pendingToken: null }).where(eq(devices.id, input.deviceId))
        const token = await signToken(device.userId, user.tokenVersion, device.id)
        return { token, sealedUserPrivateKey: device.sealedUserPrivateKey }
      })
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.select({ id: devices.id, name: devices.name, approvedAt: devices.approvedAt })
      .from(devices)
      .where(and(eq(devices.userId, ctx.userId), eq(devices.status, 'approved')))
  }),

  revoke: protectedProcedure
    .input(z.object({ deviceId: z.string().max(MAX_ID) }))
    .mutation(async ({ ctx, input }) => {
      const [device] = await ctx.db.select().from(devices).where(and(eq(devices.id, input.deviceId), eq(devices.userId, ctx.userId)))
      if (!device) throw new TRPCError({ code: 'NOT_FOUND' })
      await ctx.db.update(devices).set({ status: 'revoked' }).where(eq(devices.id, input.deviceId))
    }),
})
