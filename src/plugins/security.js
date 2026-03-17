import fp from 'fastify-plugin'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'

export default fp(async function plugins(fastify) {

  // ── CORS ─────────────────────────────────────────────────
  // Only allow requests from the Mediko Shopify storefront.
  // Set WIDGET_ALLOWED_ORIGIN=https://store.mediko.ph in production.
  const allowedOrigin = process.env.WIDGET_ALLOWED_ORIGIN || '*'

  await fastify.register(cors, {
    origin: allowedOrigin === '*'
      ? true
      : (origin, callback) => {
          if (!origin || origin === allowedOrigin) {
            callback(null, true)
          } else {
            callback(new Error(`Origin ${origin} not allowed`), false)
          }
        },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false
  })

  // ── Rate limiting ────────────────────────────────────────
  // 20 requests per minute per IP — prevents abuse of the OpenAI endpoint.
  await fastify.register(rateLimit, {
    max: 20,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      error: 'Masyadong maraming mensahe. Pakihintay ng ilang segundo bago subukang muli.'
    })
  })

})
