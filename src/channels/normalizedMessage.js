/**
 * normalizedMessage.js
 *
 * The single internal format that ALL channels produce.
 * Every channel adapter (widget, WhatsApp, Messenger) must return one of these.
 * The conversation manager and AI pipeline only ever see this shape.
 *
 * @typedef {Object} NormalizedMessage
 * @property {string}   sessionId      — Supabase chat_sessions.id (UUID)
 * @property {string}   channel        — 'widget' | 'whatsapp' | 'messenger' | 'sms'
 * @property {string}   channelUserId  — channel-specific user ID (phone, PSID, etc.)
 * @property {string}   text           — the raw message text
 * @property {string}   [mediaUrl]     — optional image/file URL (future use)
 * @property {object}   [raw]          — original payload for debugging
 */

/**
 * Build a NormalizedMessage. Throws if required fields are missing.
 * @param {Partial<NormalizedMessage>} fields
 * @returns {NormalizedMessage}
 */
export function normalizeMessage({ sessionId, channel, channelUserId, text, mediaUrl, raw }) {
  if (!channel)       throw new Error('normalizeMessage: channel is required')
  if (!channelUserId) throw new Error('normalizeMessage: channelUserId is required')
  if (!text?.trim())  throw new Error('normalizeMessage: text is required')

  return {
    sessionId:     sessionId     ?? null,   // null = new session (widget will create one first)
    channel,
    channelUserId: String(channelUserId),
    text:          text.trim(),
    mediaUrl:      mediaUrl ?? null,
    raw:           raw ?? null
  }
}
