import {
  createSession,
  sessionExists,
  touchSession,
  loadHistory,
  saveMessagePair,
  getFullHistory
} from '../services/sessionService.js'
import { buildMessages } from '../services/promptService.js'
import { streamChat } from '../services/openaiService.js'

// ── Validation schemas ───────────────────────────────────────

const sessionCreateSchema = {
  body: {
    type: 'object',
    properties: {
      customerEmail: { type: 'string', format: 'email' },
      metadata: { type: 'object' }
    }
  },
  response: {
    201: {
      type: 'object',
      properties: { sessionId: { type: 'string' } }
    }
  }
}

const chatSchema = {
  body: {
    type: 'object',
    required: ['message', 'sessionId'],
    properties: {
      message:   { type: 'string', minLength: 1, maxLength: 2000 },
      sessionId: { type: 'string', format: 'uuid' }
    }
  }
}

const historySchema = {
  params: {
    type: 'object',
    required: ['sessionId'],
    properties: { sessionId: { type: 'string', format: 'uuid' } }
  },
  querystring: {
    type: 'object',
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 }
    }
  }
}

// ── Route plugin ─────────────────────────────────────────────

export default async function chatRoutes(fastify) {

  /**
   * POST /api/chat/session
   * Create a new session. Called once when the widget initialises.
   */
  fastify.post('/session', { schema: sessionCreateSchema }, async (request, reply) => {
    const { customerEmail, metadata } = request.body || {}
    const sessionId = await createSession({ customerEmail, metadata })
    return reply.status(201).send({ sessionId })
  })


  /**
   * POST /api/chat
   * Main chat endpoint — streams the AI response via SSE.
   *
   * Response format (text/event-stream):
   *   data: {"type":"chunk","text":"..."}           — streamed text delta
   *   data: {"type":"done","tokens":123}             — end of stream
   *   data: {"type":"error","message":"..."}         — error then stream closes
   */
  fastify.post('/', { schema: chatSchema }, async (request, reply) => {
    const { message, sessionId } = request.body

    // ── 1. Validate session ──────────────────────────────────
    const valid = await sessionExists(sessionId)
    if (!valid) {
      return reply.status(404).send({ error: 'Session not found. Please refresh the page.' })
    }

    // ── 2. Set SSE headers — bypass Fastify serialisation ────
    reply.raw.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no'   // disable Nginx buffering
    })

    const send = (data) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)

    try {
      // ── 3. Load history ──────────────────────────────────
      const history = await loadHistory(sessionId)

      // ── 4. Build prompt ──────────────────────────────────
      // products/order empty in Phase 1 — Phase 2 will populate these
      const messages = buildMessages({ userMessage: message, history })

      // ── 5. Stream from OpenAI ────────────────────────────
      let fullText    = ''
      let totalTokens = 0

      for await (const event of streamChat(messages)) {
        if (event.type === 'chunk') {
          send({ type: 'chunk', text: event.text })
        } else if (event.type === 'done') {
          fullText    = event.fullText
          totalTokens = event.totalTokens
        }
      }

      // ── 6. Persist to Supabase ───────────────────────────
      await saveMessagePair(sessionId, message, fullText, totalTokens || undefined)
      await touchSession(sessionId)

      // ── 7. Close stream ──────────────────────────────────
      send({ type: 'done', tokens: totalTokens })
      reply.raw.end()

    } catch (err) {
      fastify.log.error({ err: err.message, stack: err.stack, sessionId }, 'Chat stream error')
      send({ type: 'error', message: 'May nangyaring mali. Subukan ulit po.' })
      reply.raw.end()
    }
  })


  /**
   * GET /api/chat/history/:sessionId
   * Returns saved messages for a session (widget reload / page refresh).
   */
  fastify.get('/history/:sessionId', { schema: historySchema }, async (request, reply) => {
    const { sessionId } = request.params
    const { limit }     = request.query

    const valid = await sessionExists(sessionId)
    if (!valid) {
      return reply.status(404).send({ error: 'Session not found.' })
    }

    const messages = await getFullHistory(sessionId, limit)
    return reply.send({ sessionId, messages })
  })

}
