/**
 * messengerAdapter.js
 *
 * Parses Meta Messenger webhook payloads and sends replies.
 * Phase 4: deduplication, typing indicators, message chunking, retry.
 */

import { normalizeMessage } from './normalizedMessage.js'
import { findOrCreateSessionByChannelUser } from '../services/sessionService.js'
import { isDuplicate }      from '../services/deduplicationStore.js'
import { chunkMessage, sendTypingIndicator, clearTypingIndicator, withRetry } from '../services/metaHelpers.js'

const META_GRAPH_BASE = 'https://graph.facebook.com/v19.0'

// ── Payload parsing ──────────────────────────────────────────

/**
 * Extract the first text message from a Messenger webhook body.
 * Returns null for delivery receipts, reads, postbacks, echoes.
 *
 * @param {object} body
 * @returns {{ psid: string, text: string, mid: string } | null}
 */
export function extractMessengerMessage(body) {
  try {
    const messaging = body?.entry?.[0]?.messaging?.[0]
    if (!messaging?.message?.text) return null
    if (messaging.message.is_echo)  return null

    return {
      psid: messaging.sender.id,
      text: messaging.message.text,
      mid:  messaging.message.mid
    }
  } catch {
    return null
  }
}

/**
 * Convert a Messenger webhook payload into a NormalizedMessage.
 * Returns null for duplicates or non-text events.
 *
 * @param {object} body
 * @returns {Promise<import('./normalizedMessage.js').NormalizedMessage | null>}
 */
export async function fromMessengerWebhook(body) {
  const extracted = extractMessengerMessage(body)
  if (!extracted) return null

  const { psid, text, mid } = extracted

  if (isDuplicate(mid)) return null

  const sessionId = await findOrCreateSessionByChannelUser({
    channel:       'messenger',
    channelUserId: psid
  })

  return normalizeMessage({
    sessionId,
    channel:       'messenger',
    channelUserId: psid,
    text,
    raw: { ...body, _mid: mid }
  })
}

// ── Sending ──────────────────────────────────────────────────

/**
 * Send a single text message to a Messenger user.
 */
async function sendSingle(psid, text) {
  const pageToken = process.env.MESSENGER_PAGE_ACCESS_TOKEN
  if (!pageToken) { console.warn('[Messenger] MESSENGER_PAGE_ACCESS_TOKEN not set — skipping send'); return null }

  const res = await fetch(
    `${META_GRAPH_BASE}/me/messages?access_token=${pageToken}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: psid },
        message:   { text }
      })
    }
  )

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Messenger send failed (${res.status}): ${err?.error?.message ?? 'unknown'}`)
  }

  return res.json()
}

/**
 * Send a (potentially long) reply to a Messenger user.
 * Shows typing indicator while composing, then sends chunked messages.
 *
 * @param {string} psid
 * @param {string} text
 */
export async function sendMessengerMessage(psid, text) {
  await sendTypingIndicator('messenger', psid)

  const chunks = chunkMessage(text, 'messenger')

  for (const chunk of chunks) {
    await withRetry(() => sendSingle(psid, chunk))
    if (chunks.length > 1) {
      await new Promise(r => setTimeout(r, 400))
    }
  }

  await clearTypingIndicator('messenger', psid)
}
