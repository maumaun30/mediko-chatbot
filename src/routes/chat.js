import { createSession, sessionExists, getSessionMode, loadHistory, saveMessagePair, getFullHistory } from '../services/sessionService.js'
import { processMessage } from '../services/conversationManager.js'
import { buildMessages }  from '../services/promptService.js'
import { streamChat }     from '../services/openaiService.js'
import { fromWidgetRequest } from '../channels/widgetAdapter.js'

const sessionCreateSchema = {
  body: {
    type: 'object',
    properties: {
      customerEmail: { type: 'string', format: 'email' },
      metadata:      { type: 'object' }
    }
  },
  response: { 201: { type: 'object', properties: { sessionId: { type: 'string' } } } }
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
  params:      { type: 'object', required: ['sessionId'], properties: { sessionId: { type: 'string', format: 'uuid' } } },
  querystring: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 } } }
}

export default async function chatRoutes(fastify) {

  // POST /api/chat/session
  fastify.post('/session', { schema: sessionCreateSchema }, async (request, reply) => {
    const { customerEmail, metadata } = request.body || {}
    const sessionId = await createSession({ channel: 'widget', customerEmail, metadata })
    return reply.status(201).send({ sessionId })
  })


  // POST /api/chat  — widget SSE streaming endpoint
  fastify.post('/', { schema: chatSchema }, async (request, reply) => {

    // ── 1. Normalise to channel-agnostic format ──────────────
    let msg
    try {
      msg = fromWidgetRequest(request.body)
    } catch (err) {
      return reply.status(400).send({ error: err.message })
    }

    // ── 2. Conversation manager — check mode, detect handoff ─
    let decision
    try {
      decision = await processMessage(msg)
    } catch (err) {
      if (err.code === 'SESSION_NOT_FOUND') {
        return reply.status(404).send({ error: 'Session not found. Please refresh the page.' })
      }
      throw err
    }

    // ── 3. SSE headers ───────────────────────────────────────
    // Must set CORS header manually here — reply.raw.writeHead() bypasses
    // @fastify/cors because it writes directly to the Node http response.
    const allowedOrigin = process.env.WIDGET_ALLOWED_ORIGIN || '*'
    const requestOrigin = request.headers.origin || ''
    const corsOrigin = allowedOrigin === '*'
      ? '*'
      : (requestOrigin === allowedOrigin ? requestOrigin : '')

    reply.raw.writeHead(200, {
      'Content-Type':                'text/event-stream',
      'Cache-Control':               'no-cache, no-transform',
      'Connection':                  'keep-alive',
      'X-Accel-Buffering':           'no',
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Headers':'Content-Type'
    })

    const send = (data) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)

    // ── 4. Handle off-topic, handoff, and agent cases ──────────
    if (decision.type === 'off_topic') {
      send({ type: 'chunk', text: decision.replyText })
      send({ type: 'done', tokens: 0 })
      reply.raw.end()
      return
    }

    if (decision.type === 'handoff_requested') {
      send({ type: 'handoff', message: 'Sandali lang po. Ikinokonekta ko kayo sa aming team. Maaaring may ilang minuto bago sumagot ang ahente.' })
      reply.raw.end()
      return
    }

    if (decision.type === 'agent') {
      send({ type: 'agent_mode', message: 'Ang inyong mensahe ay natanggap ng aming team. Makikipag-ugnayan kami sa inyo sa lalong madaling panahon.' })
      reply.raw.end()
      return
    }

    if (decision.type === 'handoff_returned') {
      send({ type: 'chunk', text: 'Naibalik na po kayo sa aming AI assistant na si Medi. Paano ko pa kayo matutulungan?' })
      send({ type: 'done', tokens: 0 })
      reply.raw.end()
      return
    }

    // ── 5. AI mode — stream OpenAI response ─────────────────
    try {
      const history  = await loadHistory(decision.sessionId)
      const messages = buildMessages({ userMessage: decision.text, history, products: decision.products ?? [], order: decision.order ?? null, channel: 'widget' })

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

      await saveMessagePair(decision.sessionId, decision.text, fullText, totalTokens || undefined)

      send({ type: 'done', tokens: totalTokens })
      reply.raw.end()

    } catch (err) {
      fastify.log.error({ err: err.message, stack: err.stack, sessionId: decision.sessionId }, 'Chat stream error')
      send({ type: 'error', message: 'May nangyaring mali. Subukan ulit po.' })
      reply.raw.end()
    }
  })


  // GET /api/chat/history/:sessionId
  fastify.get('/history/:sessionId', { schema: historySchema }, async (request, reply) => {
    const { sessionId } = request.params
    const { limit }     = request.query

    const valid = await sessionExists(sessionId)
    if (!valid) return reply.status(404).send({ error: 'Session not found.' })

    const messages = await getFullHistory(sessionId, limit)
    return reply.send({ sessionId, messages })
  })


  /**
   * GET /api/chat/mode/:sessionId
   * Returns the current mode of a session — used by the widget on reload
   * to decide whether to open the agent listen stream.
   */
  fastify.get('/mode/:sessionId', async (request, reply) => {
    const { sessionId } = request.params
    const valid = await sessionExists(sessionId)
    if (!valid) return reply.status(404).send({ error: 'Session not found' })
    const mode = await getSessionMode(sessionId)
    return reply.send({ sessionId, mode })
  })


  /**
   * GET /api/chat/listen/:sessionId
   *
   * Long-lived SSE stream the widget subscribes to when in agent/handoff mode.
   * The server pushes:
   *   { type: 'agent_message', text }   — agent reply
   *   { type: 'mode_changed',  mode }   — mode switched (e.g. back to AI)
   *   { type: 'ping' }                  — keepalive every 25s
   */
  fastify.get('/listen/:sessionId', async (request, reply) => {
    const { sessionId } = request.params

    const valid = await sessionExists(sessionId)
    if (!valid) return reply.status(404).send({ error: 'Session not found' })

    // Always allow the configured origin (same logic as /api/chat)
    const allowedOrigin = process.env.WIDGET_ALLOWED_ORIGIN || '*'
    const requestOrigin = request.headers.origin || ''
    const corsOrigin = (allowedOrigin === '*' || !allowedOrigin)
      ? '*'
      : requestOrigin === allowedOrigin ? requestOrigin : allowedOrigin

    reply.raw.writeHead(200, {
      'Content-Type':                  'text/event-stream',
      'Cache-Control':                 'no-cache, no-transform',
      'Connection':                    'keep-alive',
      'X-Accel-Buffering':             'no',
      'Access-Control-Allow-Origin':   corsOrigin,
      'Access-Control-Allow-Headers':  'Content-Type',
    })

    const raw = reply.raw

    // Send an immediate connected event so the widget knows the stream is live
    raw.write('data: {"type":"connected"}\n\n')

    subscribeWidget(sessionId, raw)

    // Keepalive ping every 20s
    const ping = setInterval(() => {
      try {
        raw.write('data: {"type":"ping"}\n\n')
        // Explicitly flush for Node.js streams behind proxies
        if (typeof raw.flush === 'function') raw.flush()
      } catch { cleanup() }
    }, 20000)

    function cleanup() {
      clearInterval(ping)
      unsubscribeWidget(sessionId, raw)
      try { raw.end() } catch {}
    }

    raw.on('close', cleanup)
    raw.on('error', cleanup)
  })
}
