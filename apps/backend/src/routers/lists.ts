import { TRPCError } from '@trpc/server'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { router, protectedProcedure } from '../router.js'
import { lists, listMemberships, tasks, users } from '../db/schema.js'
import { MAX_ID, MAX_KEY_BLOB, MAX_NAME_BLOB, MAX_USERNAME } from '../lib/limits.js'

/** SQLite surfaces a unique-index collision as a message, not a typed error. */
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message)
}

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
      isPersonal: m.list.isPersonal,
      isOwner: m.list.ownerId === ctx.userId,
      encryptedListKey: m.encryptedListKey,
    }))
  }),

  create: protectedProcedure
    .input(z.object({ encryptedName: z.string().max(MAX_NAME_BLOB), encryptedListKey: z.string().max(MAX_KEY_BLOB) }))
    .mutation(async ({ ctx, input }) => {
      const listId = randomUUID()
      const now = Date.now()
      await ctx.db.insert(lists).values({ id: listId, ownerId: ctx.userId, encryptedName: input.encryptedName, isShared: false, createdAt: now })
      await ctx.db.insert(listMemberships).values({ id: randomUUID(), listId, userId: ctx.userId, encryptedListKey: input.encryptedListKey, invitedBy: null, createdAt: now })
      return { id: listId }
    }),

  // Owner-only migration path for legacy names that were encrypted with the
  // owner's stretch key. New names are encrypted with the list key so every
  // member can decrypt the same metadata.
  updateEncryptedName: protectedProcedure
    .input(z.object({ listId: z.string().max(MAX_ID), encryptedName: z.string().max(MAX_NAME_BLOB) }))
    .mutation(async ({ ctx, input }) => {
      const [list] = await ctx.db.select({ ownerId: lists.ownerId }).from(lists).where(eq(lists.id, input.listId))
      if (!list || list.ownerId !== ctx.userId) throw new TRPCError({ code: 'FORBIDDEN' })
      await ctx.db.update(lists).set({ encryptedName: input.encryptedName }).where(eq(lists.id, input.listId))
      return { ok: true }
    }),

  // Owner-only. Every member holds the plaintext list key, so a member who could
  // invite would be able to widen the audience of someone else's list — handing a
  // third party a membership row the owner never approved and cannot see the
  // origin of. Membership alone is not authority to share.
  invite: protectedProcedure
    .input(z.object({
      listId: z.string().max(MAX_ID),
      inviteeUsername: z.string().min(2).max(MAX_USERNAME),
      encryptedListKey: z.string().max(MAX_KEY_BLOB),
    }))
    .mutation(async ({ ctx, input }) => {
      const [list] = await ctx.db.select().from(lists).where(eq(lists.id, input.listId))
      if (!list || list.ownerId !== ctx.userId) throw new TRPCError({ code: 'FORBIDDEN' })
      if (list.isPersonal) throw new TRPCError({ code: 'FORBIDDEN', message: 'The personal list cannot be shared' })

      const [invitee] = await ctx.db.select().from(users).where(eq(users.username, input.inviteeUsername))
      if (!invitee) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' })
      if (invitee.id === ctx.userId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'You are already on this list' })

      const [existing] = await ctx.db.select({ id: listMemberships.id }).from(listMemberships)
        .where(and(eq(listMemberships.listId, input.listId), eq(listMemberships.userId, invitee.id)))
      if (existing) throw new TRPCError({ code: 'CONFLICT', message: 'Already a member of this list' })

      try {
        await ctx.db.insert(listMemberships).values({ id: randomUUID(), listId: input.listId, userId: invitee.id, encryptedListKey: input.encryptedListKey, invitedBy: ctx.userId, createdAt: Date.now() })
      } catch (err) {
        // Lost a race with a concurrent invite; the unique index is the authority.
        if (isUniqueViolation(err)) throw new TRPCError({ code: 'CONFLICT', message: 'Already a member of this list' })
        throw err
      }
      await ctx.db.update(lists).set({ isShared: true }).where(eq(lists.id, input.listId))
    }),

  delete: protectedProcedure
    .input(z.object({ listId: z.string().max(MAX_ID) }))
    .mutation(async ({ ctx, input }) => {
      const [list] = await ctx.db.select().from(lists).where(eq(lists.id, input.listId))
      if (!list || list.ownerId !== ctx.userId) throw new TRPCError({ code: 'FORBIDDEN' })
      if (list.isPersonal) throw new TRPCError({ code: 'FORBIDDEN', message: 'The personal list cannot be deleted' })
      // Foreign keys are enforced, so children go first; one transaction keeps a
      // partial failure from leaving orphaned tasks or memberships behind.
      ctx.db.transaction(tx => {
        tx.delete(tasks).where(eq(tasks.listId, input.listId)).run()
        tx.delete(listMemberships).where(eq(listMemberships.listId, input.listId)).run()
        tx.delete(lists).where(eq(lists.id, input.listId)).run()
      })
    }),

  leave: protectedProcedure
    .input(z.object({ listId: z.string().max(MAX_ID) }))
    .mutation(async ({ ctx, input }) => {
      const [list] = await ctx.db.select().from(lists).where(eq(lists.id, input.listId))
      if (!list || list.ownerId === ctx.userId) throw new TRPCError({ code: 'FORBIDDEN' })
      const [membership] = await ctx.db.select().from(listMemberships).where(and(eq(listMemberships.listId, input.listId), eq(listMemberships.userId, ctx.userId)))
      if (!membership) throw new TRPCError({ code: 'FORBIDDEN' })
      await ctx.db.delete(listMemberships).where(and(eq(listMemberships.listId, input.listId), eq(listMemberships.userId, ctx.userId)))
    }),

  removeMember: protectedProcedure
    .input(z.object({ listId: z.string().max(MAX_ID), userId: z.string().max(MAX_ID) }))
    .mutation(async ({ ctx, input }) => {
      const [list] = await ctx.db.select().from(lists).where(eq(lists.id, input.listId))
      if (!list || list.ownerId !== ctx.userId) throw new TRPCError({ code: 'FORBIDDEN' })
      await ctx.db.delete(listMemberships).where(and(eq(listMemberships.listId, input.listId), eq(listMemberships.userId, input.userId)))
    }),
})
