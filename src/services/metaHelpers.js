/**
 * metaHelpers.js
 *
 * Shared utilities for WhatsApp and Messenger:
 *   - Typing indicator  (shows "..." while AI is thinking)
 *   - Message chunking  (split long AI responses into platform-safe sizes)
 *   - Send with retry   (exponential backoff on 5xx errors)
 */

// ── Platform limits ──────────────────────────────────────────

export const LIMITS = {
  whatsapp:  4096,   // WhatsApp max text message length
  messenger: 2000    // Messenger max text message length
}

// ── Message chunking ─────────────────────────────────────────

/**
 * Split a long text into chunks that fit within a platform's character limit.
 * Splits on sentence boundaries (. ! ?) where possible, otherwise on spaces.
 *
 * @param {string} text
 * @param {'whatsapp'|'messenger'} channel
 * @returns {string[]}
 */
export function chunkMessage(text, channel) {
  const limit = LIMITS[channel] ?? 2000
  if (text.length <= limit) return [text]

  const chunks = []
  let remaining = text

  while (remaining.length > limit) {
    // Try to split at the last sentence end before the limit
    let splitAt = remaining.lastIndexOf('. ', limit)
    if (splitAt === -1) splitAt = remaining.lastIndexOf('! ', limit)
    if (splitAt === -1) splitAt = remaining.lastIndexOf('? ', limit)
    // Fall back to last space
    if (splitAt === -1) splitAt = remaining.lastIndexOf(' ', limit)
    // Hard cut if no space found
    if (splitAt === -1) splitAt = limit

    chunks.push(remaining.slice(0, splitAt + 1).trim())
    remaining = remaining.slice(splitAt + 1).trim()
  }

  if (remaining.length > 0) chunks.push(remaining)
  return chunks
}

// ── Typing indicator ─────────────────────────────────────────

const META_GRAPH_BASE = 'https://graph.facebook.com/v19.0'

/**
 * Send a "typing on" indicator to a Messenger user.
 * WhatsApp does not support typing indicators via Cloud API — no-op there.
 *
 * @param {string} channel
 * @param {string} channelUserId  — PSID for Messenger
 */
export async function sendTypingIndicator(channel, channelUserId) {
  if (channel !== 'messenger') return

  const pageToken = process.env.MESSENGER_PAGE_ACCESS_TOKEN
  if (!pageToken) return

  try {
    await fetch(`${META_GRAPH_BASE}/me/messages?access_token=${pageToken}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient:     { id: channelUserId },
        sender_action: 'typing_on'
      })
    })
  } catch {
    // Non-critical — ignore errors
  }
}

/**
 * Turn off the typing indicator.
 * @param {string} channel
 * @param {string} channelUserId
 */
export async function clearTypingIndicator(channel, channelUserId) {
  if (channel !== 'messenger') return

  const pageToken = process.env.MESSENGER_PAGE_ACCESS_TOKEN
  if (!pageToken) return

  try {
    await fetch(`${META_GRAPH_BASE}/me/messages?access_token=${pageToken}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient:     { id: channelUserId },
        sender_action: 'typing_off'
      })
    })
  } catch { }
}

// ── Send with retry ──────────────────────────────────────────

/**
 * Wrap a send function with simple exponential backoff.
 * Retries up to 3 times on network or 5xx errors.
 *
 * @param {() => Promise<any>} sendFn
 * @param {number} [maxRetries=3]
 */
export async function withRetry(sendFn, maxRetries = 3) {
  let lastError
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await sendFn()
    } catch (err) {
      lastError = err
      // Only retry on network errors or 5xx (not 4xx config errors)
      if (err.message?.includes('4')) throw err
      const delay = Math.pow(2, attempt) * 500   // 500ms, 1s, 2s
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw lastError
}
