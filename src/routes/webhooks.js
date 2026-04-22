/**
 * webhooks.js
 *
 * Meta Cloud API webhook endpoints for WhatsApp and Messenger.
 * Phase 4: full production-ready flow with typing indicators,
 * read receipts, deduplication, and structured error handling.
 *
 * ── Setup checklist ──────────────────────────────────────────
 * 1. Create a Meta App at developers.facebook.com (Business type)
 * 2. Add WhatsApp and Messenger products to the app
 * 3. Set META_WEBHOOK_VERIFY_TOKEN in .env (any secret string you choose)
 * 4. Expose your local server with:  npx localtunnel --port 3001
 *    OR deploy to Railway/Render and use the live URL
 * 5. Register webhook URLs in Meta App Dashboard:
 *      https://your-domain.com/api/webhooks/whatsapp
 *      https://your-domain.com/api/webhooks/messenger
 * 6. Subscribe to the "messages" field on both products
 */

import { fromWhatsAppWebhook, markAsRead }  from '../channels/whatsappAdapter.js'
import { fromMessengerWebhook }             from '../channels/messengerAdapter.js'
import { sendTypingIndicator }              from '../services/metaHelpers.js'
import { processMessage }                   from '../services/conversationManager.js'
import { dispatchReply, dispatchHandoffAck, dispatchHandoffReturn } from '../services/responseDispatcher.js'
import { loadHistory, saveMessagePair }     from '../services/sessionService.js'
import { buildMessages }                    from '../services/promptService.js'
import { streamChat }                       from '../services/openaiService.js'

const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN

// ── WhatsApp ─────────────────────────────────────────────────

export default async function webhookRoutes(fastify) {

  /**
   * GET /api/webhooks/whatsapp
   * Meta webhook verification handshake.
   */
  fastify.get('/whatsapp', async (request, reply) => {
    const {
      'hub.mode':         mode,
      'hub.verify_token': token,
      'hub.challenge':    challenge
    } = request.query

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      fastify.log.info('WhatsApp webhook verified successfully')
      return reply.status(200).send(challenge)
    }

    fastify.log.warn({ token }, 'WhatsApp webhook verification failed — token mismatch')
    return reply.status(403).send('Forbidden')
  })


  /**
   * POST /api/webhooks/whatsapp
   * Inbound WhatsApp messages from Meta Cloud API.
   *
   * IMPORTANT: Must respond 200 within 5 seconds or Meta will retry.
   * Processing is done asynchronously after the 200 reply.
   */
  fastify.post('/whatsapp', async (request, reply) => {
    reply.status(200).send('EVENT_RECEIVED')

    try {
      const msg = await fromWhatsAppWebhook(request.body)
      if (!msg) return   // status update, duplicate, or non-text

      // Mark as read immediately (double blue tick)
      const messageId = request.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id
      if (messageId) markAsRead(messageId)  // fire-and-forget

      await handleInboundMessage(msg, fastify.log)
    } catch (err) {
      fastify.log.error({ err: err.message, stack: err.stack }, 'WhatsApp webhook error')
    }
  })


  // ── Messenger ──────────────────────────────────────────────

  /**
   * GET /api/webhooks/messenger
   * Meta webhook verification handshake.
   */
  fastify.get('/messenger', async (request, reply) => {
    const {
      'hub.mode':         mode,
      'hub.verify_token': token,
      'hub.challenge':    challenge
    } = request.query

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      fastify.log.info('Messenger webhook verified successfully')
      return reply.status(200).send(challenge)
    }

    fastify.log.warn({ token }, 'Messenger webhook verification failed — token mismatch')
    return reply.status(403).send('Forbidden')
  })


  /**
   * POST /api/webhooks/messenger
   * Inbound Messenger messages from Meta.
   */
  fastify.post('/messenger', async (request, reply) => {
    reply.status(200).send('EVENT_RECEIVED')

    try {
      const msg = await fromMessengerWebhook(request.body)
      if (!msg) return

      await handleInboundMessage(msg, fastify.log)
    } catch (err) {
      fastify.log.error({ err: err.message, stack: err.stack }, 'Messenger webhook error')
    }
  })

}

// ── Shared inbound message handler ───────────────────────────

/**
 * Full pipeline for any inbound message from WhatsApp or Messenger:
 *   1. Conversation manager (mode check, handoff detection, Shopify context)
 *   2. Show typing indicator
 *   3. AI pipeline (stream → collect → dispatch)  OR  agent inbox
 *   4. Save to Supabase
 *
 * @param {import('../channels/normalizedMessage.js').NormalizedMessage} msg
 * @param {object} log — fastify logger
 */
async function handleInboundMessage(msg, log) {
  const { channel, channelUserId, sessionId } = msg

  // ── 1. Conversation manager ────────────────────────────────
  const decision = await processMessage(msg)

  switch (decision.type) {

    case 'handoff_requested':
      // dispatchHandoffAck already called inside processMessage
      log.info({ sessionId, channel }, 'Handoff requested by customer')
      break

    case 'agent':
      // Message queued in agent inbox — no automated reply
      log.info({ sessionId, channel }, 'Message forwarded to agent inbox')
      break

    case 'handoff_returned':
      // dispatchHandoffReturn already called inside processMessage
      log.info({ sessionId, channel }, 'Session returned to AI')
      break

    case 'off_topic':
      await dispatchReply(channel, channelUserId, decision.replyText)
      break

    case 'ai': {
      // AI kill-switch — when off, return a static fallback instead of calling OpenAI.
      if (process.env.AI_ENABLED === 'false') {
        const fallback = process.env.AI_DISABLED_MESSAGE
          || "Pasensya na po, ang aming AI assistant ay pansamantalang hindi available. Paki-click po ang 'Talk to agent' button para makausap ang aming team."
        await dispatchReply(channel, channelUserId, fallback)
        await saveMessagePair(decision.sessionId, decision.text, fallback, 0)
        log.info({ sessionId, channel }, 'AI disabled — sent fallback')
        break
      }

      // ── 2. Show typing indicator ─────────────────────────
      await sendTypingIndicator(channel, channelUserId)

      try {
        // ── 3. Run AI pipeline ──────────────────────────────
        const history  = await loadHistory(decision.sessionId)
        const messages = buildMessages({
          userMessage: decision.text,
          history,
          products:    decision.products ?? [],
          order:       decision.order    ?? null
        })

        // Collect full streamed text — async channels get one complete reply
        let fullText    = ''
        let totalTokens = 0

        for await (const event of streamChat(messages)) {
          if (event.type === 'chunk') fullText    += event.text
          if (event.type === 'done')  totalTokens  = event.totalTokens
        }

        // ── 4. Send reply ────────────────────────────────────
        await dispatchReply(channel, channelUserId, fullText)

        // ── 5. Persist ───────────────────────────────────────
        await saveMessagePair(
          decision.sessionId,
          decision.text,
          fullText,
          totalTokens || undefined
        )

        log.info({ sessionId, channel, tokens: totalTokens }, 'AI reply sent')

      } catch (err) {
        log.error({ err: err.message, sessionId, channel }, 'AI pipeline error in webhook')
        await dispatchReply(
          channel,
          channelUserId,
          'Paumanhin po, may nangyaring mali. Subukan ulit po o i-type ang "agent" para makausap ang aming team.'
        )
      }
      break
    }
  }
}
