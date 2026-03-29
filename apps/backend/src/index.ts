import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { appRouter } from './router.js'
import { createContext } from './context.js'
import { db } from './db/index.js'
import { migrate } from './db/migrate.js'

migrate(db)

const app = new Hono()

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET environment variable must be set')

const corsOrigin = process.env.CORS_ORIGIN
if (!corsOrigin) throw new Error('CORS_ORIGIN environment variable must be set')
app.use('/api/*', cors({ origin: corsOrigin, credentials: true }))

app.all('/api/trpc/*', c =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req: c.req.raw,
    router: appRouter,
    createContext,
  })
)

app.get('/health', c => c.json({ ok: true }))

export default { port: 3001, fetch: app.fetch }
