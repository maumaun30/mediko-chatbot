import 'dotenv/config'
import Fastify from 'fastify'
import securityPlugins        from './plugins/security.js'
import chatRoutes             from './routes/chat.js'
import webhookRoutes          from './routes/webhooks.js'
import productRoutes          from './routes/products.js'
import adminRoutes            from './routes/admin.js'
import keywordRoutes          from './routes/keywords.js'
import quickReplyRoutes       from './routes/quickReplies.js'
import dashboardRoutes        from './routes/dashboard.js'
import { setupAgentWebSocket } from './services/agentService.js'
import staticPlugin          from './plugins/static.js'

const PORT   = parseInt(process.env.PORT   || '3001', 10)
const HOST   = process.env.HOST            || '0.0.0.0'
const IS_PROD = process.env.NODE_ENV === 'production'

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    ...(!IS_PROD && {
      transport: {
        target:  'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' }
      }
    })
  }
})

await fastify.register(securityPlugins)
await fastify.register(staticPlugin)

// ── Routes ───────────────────────────────────────────────────
fastify.get('/health', async () => ({
  status: 'ok', service: 'mediko-chat-api', version: '5.0.0'
}))

await fastify.register(chatRoutes,      { prefix: '/api/chat' })
await fastify.register(webhookRoutes,   { prefix: '/api/webhooks' })
await fastify.register(productRoutes,   { prefix: '/api/products' })
await fastify.register(adminRoutes,     { prefix: '/api/admin' })
await fastify.register(keywordRoutes,   { prefix: '/api/keywords' })
await fastify.register(quickReplyRoutes, { prefix: '/api/quick-replies' })
await fastify.register(dashboardRoutes)

// Meta setup routes — dev only
if (!IS_PROD) {
  const { default: metaSetupRoutes } = await import('./routes/metaSetup.js')
  await fastify.register(metaSetupRoutes, { prefix: '/api/meta' })
}

// ── Start ────────────────────────────────────────────────────
try {
  await fastify.listen({ port: PORT, host: HOST })
  setupAgentWebSocket(fastify.server)

  fastify.log.info(`Mediko Chat API v5  →  http://${HOST}:${PORT}`)
  fastify.log.info(`Agent dashboard     →  http://localhost:${PORT}/dashboard`)
  if (process.env.ADMIN_SECRET) {
    fastify.log.info(`Dashboard URL       →  http://localhost:${PORT}/dashboard?secret=${process.env.ADMIN_SECRET}`)
  }
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
}
