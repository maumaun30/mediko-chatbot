import 'dotenv/config'
import Fastify from 'fastify'
import securityPlugins from './plugins/security.js'
import chatRoutes from './routes/chat.js'

const PORT = parseInt(process.env.PORT || '3001', 10)
const HOST = process.env.HOST || '0.0.0.0'

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    ...(process.env.NODE_ENV === 'development' && {
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' }
      }
    })
  }
})

// ── Plugins ──────────────────────────────────────────────────
await fastify.register(securityPlugins)

// ── Routes ───────────────────────────────────────────────────
fastify.get('/health', async () => ({ status: 'ok', service: 'mediko-chat-api' }))

await fastify.register(chatRoutes, { prefix: '/api/chat' })

// ── Start ────────────────────────────────────────────────────
try {
  await fastify.listen({ port: PORT, host: HOST })
  fastify.log.info(`Mediko Chat API running on http://${HOST}:${PORT}`)
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
}
