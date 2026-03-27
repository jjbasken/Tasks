import { TRPCError } from '@trpc/server'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { router, protectedProcedure } from '../router.js'
import { lists, listMemberships, users } from '../db/schema.js'

export const listsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const memberships = await ctx.db
      .select({ list: lists, encryptedListKey: listMemberships.encryptedListKey })
      .from(listMemberships)
      .innerJoin(lists, eq(listMemberships.listId, lists.id))
      .where(eq(listMemberships.userId, ctx.userId))
    return memberships.map(m => ({
      id: m.list.id,
      encryptedName: m.list.encryptedName,
      isShared: m.list.isShared,
      encryptedListKey: m.encryptedListKey,
    }))
  }),

  create: protectedProcedure
    .input(z.object({ encryptedName: z.string(), encryptedListKey: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const listId = randomUUID()
      const now = Date.now()
      await ctx.db.insert(lists).values({ id: listId, ownerId: ctx.userId, encryptedName: input.encryptedName, isShared: false, createdAt: now })
      await ctx.db.insert(listMemberships).values({ id: randomUUID(), listId, userId: ctx.userId, encryptedListKey: input.encryptedListKey, invitedBy: null, createdAt: now })
      return { id: listId }
    }),

  invite: protectedProcedure
    .input(z.object({ listId: z.string(), inviteeUsername: z.string(), encryptedListKey: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [membership] = await ctx.db.select().from(listMemberships).where(and(eq(listMemberships.listId, input.listId), eq(listMemberships.userId, ctx.userId)))
      if (!membership) throw new TRPCError({ code: 'FORBIDDEN' })
      const [invitee] = await ctx.db.select().from(users).where(eq(users.username, input.inviteeUsername))
      if (!invitee) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' })
      await ctx.db.insert(listMemberships).values({ id: randomUUID(), listId: input.listId, userId: invitee.id, encryptedListKey: input.encryptedListKey, invitedBy: ctx.userId, createdAt: Date.now() })
      await ctx.db.update(lists).set({ isShared: true }).where(eq(lists.id, input.listId))
    }),

  removeMember: protectedProcedure
    .input(z.object({ listId: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [list] = await ctx.db.select().from(lists).where(eq(lists.id, input.listId))
      if (!list || list.ownerId !== ctx.userId) throw new TRPCError({ code: 'FORBIDDEN' })
      await ctx.db.delete(listMemberships).where(and(eq(listMemberships.listId, input.listId), eq(listMemberships.userId, input.userId)))
    }),
})
