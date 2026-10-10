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
    .input(z.object({ taskId: z.string().uuid().optional(), listId: z.string().max(MAX_ID), encryptedPayload: z.string().max(MAX_TASK_PAYLOAD) }))
    .mutation(async ({ ctx, input }) => {
      await assertListAccess(ctx.db, input.listId, ctx.userId)
      const id = input.taskId ?? randomUUID()
      return ctx.db.transaction(tx => {
        // Retrying an offline creation after a lost response must not duplicate it
        // or overwrite an already edited task. An id collision in another list
        // never grants access to that task.
        const [existing] = tx.select().from(tasks).where(eq(tasks.id, id)).all()
        if (existing) {
          if (existing.listId !== input.listId) throw new TRPCError({ code: 'CONFLICT' })
          return { id }
        }
        const now = Date.now()
        tx.insert(tasks).values({ id, listId: input.listId, encryptedPayload: input.encryptedPayload, createdAt: now, updatedAt: now }).run()
        return { id }
      }, { behavior: 'immediate' })
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
