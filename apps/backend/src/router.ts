import { authRouter } from './routers/auth.js'
import { tasksRouter } from './routers/tasks.js'
import { listsRouter } from './routers/lists.js'
import { devicesRouter } from './routers/devices.js'
import { usersRouter } from './routers/users.js'
import { router } from './trpc.js'

export { router, publicProcedure, protectedProcedure, adminProcedure } from './trpc.js'

export const appRouter = router({
  auth: authRouter,
  tasks: tasksRouter,
  lists: listsRouter,
  devices: devicesRouter,
  users: usersRouter,
})

export type AppRouter = typeof appRouter
