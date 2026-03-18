import fp from 'fastify-plugin'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'

export default fp(async function plugins(fastify) {

  const allowedOrigin = process.env.WIDGET_ALLOWED_ORIGIN || '*'

  await fastify.register(cors, {
    origin: (origin, callback) => {
      // Allow: no origin (server-to-server), wildcard mode, or exact match
      if (!origin || allowedOrigin === '*' || origin === allowedOrigin) {
        callback(null, true)
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`), false)
      }
    },
    methods:        ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Secret'],
    exposedHeaders: ['Content-Type', 'Cache-Control', 'Access-Control-Allow-Origin'],
    credentials:    false,
    // Respond to OPTIONS preflight with 204
    preflightContinue: false,
    optionsSuccessStatus: 204,
    maxAge: 600
  })

  await fastify.register(rateLimit, {
    max: 20,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      error: 'Masyadong maraming mensahe. Pakihintay ng ilang segundo bago subukang muli.'
    })
  })

})
