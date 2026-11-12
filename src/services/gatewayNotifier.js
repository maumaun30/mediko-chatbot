/**
 * gatewayNotifier.js - signed server-to-server events to the gateway
 * (POST ${GATEWAY_URL}/internal/chat-events). Never throws.
 */
import { signEvent } from './agentAuth.js'

const TIMEOUT_MS = 10_000

/**
 * @param {'new_conversation'|'unanswered'|'offline_reply'} type
 * @param {object} payload
 * @returns {Promise<boolean>} true when the gateway accepted the event
 */
export async function postChatEvent(type, payload, { fetchImpl = fetch, now = Date.now, log = console.error } = {}) {
  try {
    const base = process.env.GATEWAY_URL
    const secret = process.env.CHAT_AGENT_SECRET
    if (!base || !secret || secret.length < 32) {
      log(`[gatewayNotifier] ${type} skipped: GATEWAY_URL or CHAT_AGENT_SECRET not configured`)
      return false
    }
    const body = JSON.stringify({ type, ...payload })
    const ts = String(now())
    const res = await fetchImpl(`${base.replace(/\/+$/, '')}/internal/chat-events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Mediko-Timestamp': ts,
        'X-Mediko-Signature': signEvent(body, ts, secret)
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!res?.ok) {
      log(`[gatewayNotifier] ${type} rejected: HTTP ${res?.status}`)
      return false
    }
    return true
  } catch (err) {
    log(`[gatewayNotifier] ${type} failed: ${err?.message}`)
    return false
  }
}
