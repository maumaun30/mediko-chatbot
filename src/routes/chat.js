import { createSession, sessionExists, getSessionMode, loadHistory, saveMessagePair, getFullHistory, recordCustomerMessage } from '../services/sessionService.js'
import { isWithinBusinessHours, getBusinessHours, getAwayMessage, aiEnabled, nextOpenAt } from '../services/settingsService.js'
import { normalizePhMobile } from '../services/phone.js'
import { verifyChatLink } from '../services/agentAuth.js'
import { hooks } from '../services/chatEvents.js'
import { processMessage } from '../services/conversationManager.js'
import { buildMessages }  from '../services/promptService.js'
import { streamChat }     from '../services/geminiService.js'
import { fromWidgetRequest } from '../channels/widgetAdapter.js'
import { subscribeWidget, unsubscribeWidget } from '../services/agentService.js'
import { spamCheck, consumeAiQuota, throttleMessage } from '../services/aiRateLimit.js'

// Open an SSE stream with the right CORS header (reply.raw bypasses @fastify/cors).
function openSSE(request, reply) {
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
  return (data) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
}

const sessionCreateSchema = {
  body: {
    type: 'object',
    required: ['customerName', 'customerEmail', 'customerPhone'],
    properties: {
      customerName:  { type: 'string', minLength: 1, maxLength: 100 },
      customerEmail: { type: 'string', format: 'email' },
      customerPhone: { type: 'string', minLength: 1, maxLength: 40 },
      metadata:      { type: 'object' }
    }
  },
  response: { 201: { type: 'object', properties: { sessionId: { type: 'string' } } } }
}

const messageSchema = {
  body: {
    type: 'object',
    required: ['message', 'sessionId'],
    properties: {
      message:   { type: 'string', minLength: 1, maxLength: 2000 },
      sessionId: { type: 'string', format: 'uuid' }
    }
  }
}

const typingSchema = {
  body: {
    type: 'object',
    required: ['sessionId'],
    properties: { sessionId: { type: 'string', format: 'uuid' } }
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
  params:      { type: 'object', required: ['sessionId'], properties: { sessionId: { type: 'string', format: 'uuid' } } },
  querystring: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 } } }
}

export default async function chatRoutes(fastify) {

  // GET /api/chat/config - public widget config
  fastify.get('/config', async (_request, reply) => {
    const bh     = await getBusinessHours()
    const online = await isWithinBusinessHours()
    const next   = online ? null : nextOpenAt(bh, new Date())
    return reply.send({
      aiEnabled:   aiEnabled(),
      online,
      nextOpenAt:  next ? next.toISOString() : null,
      awayMessage: await getAwayMessage()
    })
  })


  // POST /api/chat/session
  fastify.post('/session', { schema: sessionCreateSchema }, async (request, reply) => {
    const { customerName, customerEmail, customerPhone, metadata } = request.body
    const phone = normalizePhMobile(customerPhone)
    if (!phone) {
      return reply.status(400).send({ error: 'Pakilagay po ang tamang mobile number (09XXXXXXXXX).' })
    }
    const sessionId = await createSession({
      channel: 'widget', customerName: customerName.trim(), customerEmail, customerPhone: phone, metadata
    })
    return reply.status(201).send({ sessionId })
  })


  // POST /api/chat/message - customer message to the human team
  fastify.post('/message', {
    schema: messageSchema,
    config: { rateLimit: { max: 15, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const { sessionId, message } = request.body

    const spam = spamCheck(sessionId, message)
    if (spam.blocked) {
      return reply.status(429).send({ error: throttleMessage(spam.reason) })
    }

    if (!(await sessionExists(sessionId))) {
      return reply.status(404).send({ error: 'Session not found. Please refresh the page.' })
    }

    const { message: saved, isFirst } = await recordCustomerMessage(sessionId, message)
    try {
      await hooks.onCustomerMessage({ sessionId, message: saved, isFirst })
    } catch (err) {
      fastify.log.error({ err: err.message, sessionId }, 'onCustomerMessage hook failed')
    }

    const online = await isWithinBusinessHours()
    return reply.send({ message: saved, away: online ? null : await getAwayMessage() })
  })


  // POST /api/chat/typing
  fastify.post('/typing', { schema: typingSchema }, async (request, reply) => {
    try {
      await hooks.onCustomerTyping(request.body.sessionId)
    } catch (err) {
      fastify.log.error({ err: err.message }, 'onCustomerTyping hook failed')
    }
    return reply.status(204).send()
  })


  // GET /api/chat/resume?t=<signed link token>
  fastify.get('/resume', async (request, reply) => {
    const sessionId = verifyChatLink(String(request.query?.t || ''))
    if (!sessionId) return reply.status(410).send({ error: 'expired' })
    return reply.send({ sessionId })
  })


  // POST /api/chat  — widget SSE streaming endpoint
  // Per-IP rate limit (tighter than the global default) on the expensive route.
  fastify.post('/', {
    schema: chatSchema,
    config: { rateLimit: { max: 15, timeWindow: '1 minute' } }
  }, async (request, reply) => {

    if (!aiEnabled()) return reply.status(409).send({ error: 'AI is off' })

    // ── 1. Normalise to channel-agnostic format ──────────────
    let msg
    try {
      msg = fromWidgetRequest(request.body)
    } catch (err) {
      return reply.status(400).send({ error: err.message })
    }

    // ── 1b. Spam guard — block bursts / duplicate floods before any work ─
    const spam = spamCheck(msg.sessionId, msg.text)
    if (spam.blocked) {
      const send = openSSE(request, reply)
      send({ type: 'chunk', text: throttleMessage(spam.reason) })
      send({ type: 'done', tokens: 0 })
      reply.raw.end()
      return
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

    // ── 3. Open SSE stream ───────────────────────────────────
    const send = openSSE(request, reply)

    // ── 4. Handle off-topic, handoff, and agent cases ──────────
    if (decision.type === 'off_topic') {
      send({ type: 'chunk', text: decision.replyText })
      send({ type: 'done', tokens: 0 })
      reply.raw.end()
      return
    }

    if (decision.type === 'handoff_requested') {
      const isOpen = await isWithinBusinessHours()
      if (!isOpen) {
        const bh = await getBusinessHours()
        const awayMsg = bh?.awayMessage || 'Pasensya na po, wala pa kaming available na agent ngayon. Maaari kayong mag-iwan ng mensahe at babalik kami sa inyo sa susunod na araw ng negosyo.'
        send({ type: 'chunk', text: awayMsg })
        send({ type: 'done', tokens: 0 })
      } else {
        send({ type: 'handoff', message: 'Sandali lang po. Ikinokonekta ko kayo sa aming team. Maaaring may ilang minuto bago sumagot ang ahente.' })
      }
      reply.raw.end()
      return
    }

    if (decision.type === 'agent') {
      // Session is in agent mode — message forwarded silently to agent inbox.
      // No confirmation message here to avoid spam; the initial handoff message
      // already told the customer an agent is handling the conversation.
      send({ type: 'agent_ack' })
      reply.raw.end()
      return
    }

    if (decision.type === 'handoff_returned') {
      send({ type: 'chunk', text: 'Naibalik na po kayo sa aming Mediko Assistant. Paano ko pa kayo matutulungan?' })
      send({ type: 'done', tokens: 0 })
      reply.raw.end()
      return
    }

    // ── 5. AI mode — stream Gemini response ─────────────────
    // Global Gemini free-tier quota guard (RPM/RPD across all channels).
    const quota = consumeAiQuota()
    if (!quota.ok) {
      send({ type: 'chunk', text: throttleMessage(quota.reason) })
      send({ type: 'done', tokens: 0 })
      await saveMessagePair(decision.sessionId, decision.text, null)
      reply.raw.end()
      return
    }

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
