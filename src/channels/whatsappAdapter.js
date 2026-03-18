/**
 * whatsappAdapter.js
 *
 * Parses Meta Cloud API WhatsApp webhook payloads and sends replies.
 * Phase 4: deduplication, message chunking, send with retry.
 */

import { normalizeMessage }  from './normalizedMessage.js'
import { findOrCreateSessionByChannelUser } from '../services/sessionService.js'
import { isDuplicate }       from '../services/deduplicationStore.js'
import { chunkMessage, withRetry } from '../services/metaHelpers.js'

const META_GRAPH_BASE = 'https://graph.facebook.com/v19.0'

// ── Payload parsing ──────────────────────────────────────────

/**
 * Extract the first text message from a Meta WhatsApp webhook body.
 * Returns null for status updates, image messages, etc.
 *
 * @param {object} body
 * @returns {{ waId: string, text: string, messageId: string } | null}
 */
export function extractWhatsAppMessage(body) {
  try {
    const value    = body?.entry?.[0]?.changes?.[0]?.value
    const messages = value?.messages
    if (!messages?.length) return null

    const msg = messages[0]
    if (msg.type !== 'text') return null

    return {
      waId:      value.contacts?.[0]?.wa_id ?? msg.from,
      text:      msg.text.body,
      messageId: msg.id
    }
  } catch {
    return null
  }
}

/**
 * Convert a WhatsApp webhook payload into a NormalizedMessage.
 * Returns null for duplicates or non-text events.
 *
 * @param {object} body
 * @returns {Promise<import('./normalizedMessage.js').NormalizedMessage | null>}
 */
export async function fromWhatsAppWebhook(body) {
  const extracted = extractWhatsAppMessage(body)
  if (!extracted) return null

  const { waId, text, messageId } = extracted

  // Deduplicate — Meta retries on slow responses
  if (isDuplicate(messageId)) return null

  const sessionId = await findOrCreateSessionByChannelUser({
    channel:       'whatsapp',
    channelUserId: waId
  })

  return normalizeMessage({
    sessionId,
    channel:       'whatsapp',
    channelUserId: waId,
    text,
    raw: { ...body, _messageId: messageId }
  })
}

// ── Sending ──────────────────────────────────────────────────

/**
 * Send a single text message to a WhatsApp user.
 * @param {string} to    — recipient WhatsApp number e.g. "639171234567"
 * @param {string} text
 */
async function sendSingle(to, text) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  const token         = process.env.META_ACCESS_TOKEN

  if (!phoneNumberId || !token) {
    console.warn('[WhatsApp] WHATSAPP_PHONE_NUMBER_ID or META_ACCESS_TOKEN not set — skipping send'); return null
  }

  const res = await fetch(
    `${META_GRAPH_BASE}/${phoneNumberId}/messages`,
    {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text, preview_url: false }
      })
    }
  )

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`WhatsApp send failed (${res.status}): ${err?.error?.message ?? 'unknown'}`)
  }

  return res.json()
}

/**
 * Send a (potentially long) text reply to a WhatsApp user.
 * Automatically chunks messages that exceed the 4096-char limit.
 * Uses exponential backoff retry on failures.
 *
 * @param {string} to
 * @param {string} text
 */
export async function sendWhatsAppMessage(to, text) {
  const chunks = chunkMessage(text, 'whatsapp')

  for (const chunk of chunks) {
    await withRetry(() => sendSingle(to, chunk))

    // Small delay between chunks to preserve ordering
    if (chunks.length > 1) {
      await new Promise(r => setTimeout(r, 300))
    }
  }
}

/**
 * Mark an incoming message as read (shows double blue tick).
 * Non-critical — best effort.
 *
 * @param {string} messageId
 */
export async function markAsRead(messageId) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  const token         = process.env.META_ACCESS_TOKEN
  if (!phoneNumberId || !token) return

  try {
    await fetch(`${META_GRAPH_BASE}/${phoneNumberId}/messages`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status:            'read',
        message_id:        messageId
      })
    })
  } catch { }
}
