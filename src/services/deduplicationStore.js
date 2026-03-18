/**
 * deduplicationStore.js
 *
 * Meta Cloud API delivers webhooks at-least-once — the same message
 * can arrive 2–3 times if your server is slow to respond.
 *
 * We keep a short-lived in-memory set of processed message IDs.
 * TTL: 10 minutes (well beyond any realistic retry window).
 *
 * For multi-instance deployments, swap this for a Redis SET with EXPIRE.
 */

/** @type {Map<string, number>} messageId → timestamp */
const seen = new Map()

const TTL_MS      = 10 * 60 * 1000   // 10 minutes
const CLEANUP_EVERY = 5 * 60 * 1000  // clean up every 5 minutes

/**
 * Check if a message ID has already been processed.
 * If not seen, marks it as seen and returns false.
 * If already seen, returns true (caller should skip processing).
 *
 * @param {string} messageId
 * @returns {boolean} true = duplicate, skip it
 */
export function isDuplicate(messageId) {
  if (seen.has(messageId)) return true
  seen.set(messageId, Date.now())
  return false
}

// Periodic cleanup of expired entries
setInterval(() => {
  const cutoff = Date.now() - TTL_MS
  for (const [id, ts] of seen.entries()) {
    if (ts < cutoff) seen.delete(id)
  }
}, CLEANUP_EVERY)
