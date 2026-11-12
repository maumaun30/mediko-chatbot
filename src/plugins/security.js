import fp from 'fastify-plugin'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { verifyAgentToken, bearerFrom } from '../services/agentAuth.js'

/** Allowed browser origins: ALLOWED_ORIGINS (comma list), else [WIDGET_ALLOWED_ORIGIN]. */
export function allowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS || process.env.WIDGET_ALLOWED_ORIGIN || ''
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

/** The origin itself when allowed, else ''. A literal '*' entry (local dev only) allows any origin. */
export function corsOriginFor(origin) {
  const list = allowedOrigins()
  if (list.includes('*')) return origin || '*'
  return origin && list.includes(origin) ? origin : ''
}

export default fp(async function plugins(fastify) {

  await fastify.register(cors, {
    origin: (origin, callback) => {
      // No Origin header = server-to-server / same-origin; otherwise must be allow-listed.
      if (!origin || corsOriginFor(origin)) callback(null, true)
      else callback(new Error(`CORS: origin ${origin} not allowed`), false)
    },
    methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Type', 'Cache-Control'],
    credentials:    false,
    preflightContinue: false,
    optionsSuccessStatus: 204,
    maxAge: 600
  })

  await fastify.register(rateLimit, {
    max: 20,
    timeWindow: '1 minute',
    // Authenticated agents are exempt from the customer-facing limit.
    allowList: (req) => !!verifyAgentToken(bearerFrom(req.headers.authorization)),
    // The plugin throws this object, so it needs statusCode (else Fastify answers 500).
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'Too many messages. Please wait a few seconds and try again.'
    })
  })

})
