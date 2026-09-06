import { TRPCError } from '@trpc/server'
import { eq, and, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { router, protectedProcedure } from '../router.js'
import { tasks, listMemberships } from '../db/schema.js'
import { MAX_ID, MAX_TASK_IDS, MAX_TASK_PAYLOAD } from '../lib/limits.js'

async function assertListAccess(db: any, listId: string, userId: string) {
  const [membership] = await db
    .select()
    .from(listMemberships)
    .where(and(eq(listMemberships.listId, listId), eq(listMemberships.userId, userId)))
  if (!membership) throw new TRPCError({ code: 'FORBIDDEN' })
}

export const tasksRouter = router({
  list: protectedProcedure
    .input(z.object({ listId: z.string().max(MAX_ID) }))
    .query(async ({ ctx, input }) => {
      await assertListAccess(ctx.db, input.listId, ctx.userId)
      return ctx.db.select().from(tasks).where(eq(tasks.listId, input.listId))
    }),

  create: protectedProcedure
    .input(z.object({ listId: z.string().max(MAX_ID), encryptedPayload: z.string().max(MAX_TASK_PAYLOAD) }))
    .mutation(async ({ ctx, input }) => {
      await assertListAccess(ctx.db, input.listId, ctx.userId)
      const id = randomUUID()
      const now = Date.now()
      await ctx.db.insert(tasks).values({ id, listId: input.listId, encryptedPayload: input.encryptedPayload, createdAt: now, updatedAt: now })
      return { id }
    }),

  update: protectedProcedure
    .input(z.object({ taskId: z.string().max(MAX_ID), encryptedPayload: z.string().max(MAX_TASK_PAYLOAD) }))
    .mutation(async ({ ctx, input }) => {
      const [task] = await ctx.db.select().from(tasks).where(eq(tasks.id, input.taskId))
      if (!task) throw new TRPCError({ code: 'NOT_FOUND' })
      await assertListAccess(ctx.db, task.listId, ctx.userId)
      await ctx.db.update(tasks).set({ encryptedPayload: input.encryptedPayload, updatedAt: Date.now() }).where(eq(tasks.id, input.taskId))
    }),

  delete: protectedProcedure
    .input(z.object({ taskId: z.string().max(MAX_ID) }))
    .mutation(async ({ ctx, input }) => {
      const [task] = await ctx.db.select().from(tasks).where(eq(tasks.id, input.taskId))
      if (!task) throw new TRPCError({ code: 'NOT_FOUND' })
      await assertListAccess(ctx.db, task.listId, ctx.userId)
      await ctx.db.delete(tasks).where(eq(tasks.id, input.taskId))
    }),

  clearDone: protectedProcedure
    .input(z.object({ listId: z.string().max(MAX_ID), taskIds: z.array(z.string().max(MAX_ID)).max(MAX_TASK_IDS) }))
    .mutation(async ({ ctx, input }) => {
      if (input.taskIds.length === 0) return
      await assertListAccess(ctx.db, input.listId, ctx.userId)
      await ctx.db.delete(tasks).where(and(eq(tasks.listId, input.listId), inArray(tasks.id, input.taskIds)))
    }),
})
