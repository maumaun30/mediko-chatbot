/**
 * conversationManager.js
 *
 * Processes a NormalizedMessage and returns a ConversationDecision.
 * Phase 3 addition: fetches Shopify product + order context before
 * routing to the AI pipeline.
 *
 * @typedef {'ai'|'agent'|'handoff_requested'|'handoff_returned'} DecisionType
 *
 * @typedef {Object} ConversationDecision
 * @property {DecisionType} type
 * @property {string}       sessionId
 * @property {string}       channel
 * @property {string}       channelUserId
 * @property {string}       text
 * @property {string}       mode
 * @property {Array}        [products]   — Shopify products for AI context
 * @property {object|null}  [order]      — Shopify order info for AI context
 */

import {
  sessionExists,
  getSessionMode,
  setSessionMode,
  touchSession,
  loadHistory,
  saveMessagePair
} from './sessionService.js'
import { dispatchHandoffAck, dispatchHandoffReturn } from './responseDispatcher.js'
import { notifyAgentInbox } from './agentService.js'
import {
  getProductContextForMessage,
  lookupOrder,
  extractOrderQuery
} from './shopifyService.js'

// ── Handoff keyword detection ────────────────────────────────

const HANDOFF_TRIGGERS = [
  'agent', 'human', 'tao', 'ahente', 'representative',
  'help', 'tulong', 'support', 'admin', 'staff'
]

const RETURN_TO_AI_TRIGGERS = [
  'return to ai', 'back to ai', 'ai na', 'medi na'
]

export function isHandoffRequest(text) {
  const lower = text.toLowerCase().trim()
  return HANDOFF_TRIGGERS.some(
    kw => lower === kw || lower.startsWith(kw + ' ') || lower.includes(' ' + kw)
  )
}

export function isReturnToAiRequest(text) {
  const lower = text.toLowerCase().trim()
  return RETURN_TO_AI_TRIGGERS.some(kw => lower.includes(kw))
}

// ── Main decision function ───────────────────────────────────

export async function processMessage(msg) {
  const { sessionId, channel, channelUserId, text } = msg

  const valid = await sessionExists(sessionId)
  if (!valid) {
    throw Object.assign(new Error('Session not found'), { code: 'SESSION_NOT_FOUND' })
  }

  await touchSession(sessionId)

  const currentMode = await getSessionMode(sessionId)

  // Return-to-AI keyword
  if (currentMode === 'agent' && isReturnToAiRequest(text)) {
    await setSessionMode(sessionId, 'ai', { clearAgent: true })
    await dispatchHandoffReturn(channel, channelUserId)
    await notifyAgentInbox({ type: 'mode_changed', sessionId, mode: 'ai' })
    return { type: 'handoff_returned', sessionId, channel, channelUserId, text, mode: 'ai' }
  }

  // Handoff trigger keyword
  if (currentMode === 'ai' && isHandoffRequest(text)) {
    await setSessionMode(sessionId, 'agent', { handoffAt: new Date().toISOString() })
    await dispatchHandoffAck(channel, channelUserId)
    await notifyAgentInbox({ type: 'handoff_requested', sessionId, channel, channelUserId, text })
    return { type: 'handoff_requested', sessionId, channel, channelUserId, text, mode: 'agent' }
  }

  // Agent mode — forward to inbox
  if (currentMode === 'agent') {
    await notifyAgentInbox({ type: 'customer_message', sessionId, channel, channelUserId, text })
    await saveMessagePair(sessionId, text, null)
    return { type: 'agent', sessionId, channel, channelUserId, text, mode: 'agent' }
  }

  // ── AI mode — fetch Shopify context in parallel ──────────
  const [products, orderContext] = await Promise.all([
    getProductContextForMessage(text),
    resolveOrderContext(text)
  ])

  return {
    type: 'ai',
    sessionId,
    channel,
    channelUserId,
    text,
    mode: 'ai',
    products,
    order: orderContext
  }
}

/**
 * If the message looks like an order inquiry (has order number + email),
 * fetch the order from Shopify. Otherwise return null.
 */
async function resolveOrderContext(text) {
  const orderQuery = extractOrderQuery(text)
  if (!orderQuery) return null

  try {
    return await lookupOrder(orderQuery.orderName, orderQuery.email)
  } catch {
    return null   // non-fatal
  }
}

export { loadHistory }
