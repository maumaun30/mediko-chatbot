import 'dotenv/config'
import Fastify from 'fastify'
import securityPlugins          from './plugins/security.js'
import chatRoutes               from './routes/chat.js'
import webhookRoutes            from './routes/webhooks.js'
import productRoutes            from './routes/products.js'
import requireAgentPlugin       from './plugins/requireAgent.js'
import agentRoutes              from './routes/agent.js'
import keywordRoutes            from './routes/keywords.js'
import analyticsRoutes          from './routes/analytics.js'
import { setupAgentWebSocket, isOnline } from './services/agentService.js'
import { hooks }                from './services/chatEvents.js'
import { createOfflineReplyQueue, createOfflineSender, installNotificationHooks } from './services/offlineReplyQueue.js'
import { startUnansweredAlerts } from './services/alertScheduler.js'
import staticPlugin             from './plugins/static.js'
import { migrate }              from './db/migrate.js'
import { serverOptions }        from './serverOptions.js'

const PORT    = parseInt(process.env.PORT || '3001', 10)
const HOST    = process.env.HOST          || '0.0.0.0'
const IS_PROD = process.env.NODE_ENV === 'production'

const fastify = Fastify(serverOptions({ isProd: IS_PROD }))

await fastify.register(securityPlugins)
await fastify.register(requireAgentPlugin)
await fastify.register(staticPlugin)

fastify.get('/health', async () => ({ status: 'ok', service: 'mediko-chat-api', version: '6.0.0' }))

await fastify.register(chatRoutes,       { prefix: '/api/chat' })
await fastify.register(webhookRoutes,    { prefix: '/api/webhooks' })
await fastify.register(productRoutes,    { prefix: '/api/products' })
await fastify.register(agentRoutes,      { prefix: '/api/agent' })
await fastify.register(keywordRoutes,    { prefix: '/api/keywords' })
await fastify.register(analyticsRoutes, { prefix: '/api/analytics' })

if (!IS_PROD) {
  const { default: metaSetupRoutes } = await import('./routes/metaSetup.js')
  await fastify.register(metaSetupRoutes, { prefix: '/api/meta' })
}

try {
  await migrate()
  const offlineQueue = createOfflineReplyQueue({ isOnline, send: createOfflineSender(), log: (m) => fastify.log.error(m) })
  installNotificationHooks(hooks, { isOnline, queue: offlineQueue, log: (m) => fastify.log.error(m) })
  await fastify.listen({ port: PORT, host: HOST })
  setupAgentWebSocket(fastify.server)
  startUnansweredAlerts({ log: (m) => fastify.log.error(m) })
  fastify.log.info(`Mediko Chat API v6  →  http://${HOST}:${PORT}`)
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
}
