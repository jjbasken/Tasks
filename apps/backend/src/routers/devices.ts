import { TRPCError } from '@trpc/server'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { router, publicProcedure, protectedProcedure } from '../router.js'
import { devices, users } from '../db/schema.js'
import { signToken } from '../lib/jwt.js'

export const devicesRouter = router({
  requestApproval: publicProcedure
    .input(z.object({ username: z.string(), name: z.string(), devicePublicKey: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [user] = await ctx.db.select().from(users).where(eq(users.username, input.username))
      if (!user) throw new TRPCError({ code: 'NOT_FOUND' })
      const id = randomUUID()
      const pendingToken = randomUUID()
      await ctx.db.insert(devices).values({ id, userId: user.id, publicKey: input.devicePublicKey, name: input.name, status: 'pending', pendingToken, createdAt: Date.now() })
      return { deviceId: id, pendingToken }
    }),

  listPending: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.select({ id: devices.id, name: devices.name, publicKey: devices.publicKey, createdAt: devices.createdAt })
      .from(devices)
      .where(and(eq(devices.userId, ctx.userId), eq(devices.status, 'pending')))
  }),

  approve: protectedProcedure
    .input(z.object({ deviceId: z.string(), sealedUserPrivateKey: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [device] = await ctx.db.select().from(devices).where(and(eq(devices.id, input.deviceId), eq(devices.userId, ctx.userId)))
      if (!device) throw new TRPCError({ code: 'NOT_FOUND' })
      await ctx.db.update(devices).set({ status: 'approved', sealedUserPrivateKey: input.sealedUserPrivateKey, approvedBy: ctx.userId, approvedAt: Date.now() }).where(eq(devices.id, input.deviceId))
    }),

  checkApproval: publicProcedure
    .input(z.object({ deviceId: z.string(), pendingToken: z.string() }))
    .query(async ({ ctx, input }) => {
      const [device] = await ctx.db.select().from(devices).where(and(eq(devices.id, input.deviceId), eq(devices.pendingToken, input.pendingToken)))
      if (!device || device.status !== 'approved' || !device.sealedUserPrivateKey) return null
      const token = await signToken(device.userId)
      return { token, sealedUserPrivateKey: device.sealedUserPrivateKey }
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.select({ id: devices.id, name: devices.name, approvedAt: devices.approvedAt })
      .from(devices)
      .where(and(eq(devices.userId, ctx.userId), eq(devices.status, 'approved')))
  }),

  revoke: protectedProcedure
    .input(z.object({ deviceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [device] = await ctx.db.select().from(devices).where(and(eq(devices.id, input.deviceId), eq(devices.userId, ctx.userId)))
      if (!device) throw new TRPCError({ code: 'NOT_FOUND' })
      await ctx.db.update(devices).set({ status: 'revoked' }).where(eq(devices.id, input.deviceId))
    }),
})
