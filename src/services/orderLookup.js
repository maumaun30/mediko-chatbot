/**
 * orderLookup.js - "Track my order" for the widget.
 *
 * The widget can't reach Shopify, so the chat service relays the request to
 * Gateway over the signed internal channel (same HMAC as chat events). Gateway
 * answers { found, status } and only when the email/mobile matches the order.
 * Never throws: { ok: false } means "lookup unavailable".
 */
import { signEvent } from './agentAuth.js'

const TIMEOUT_MS = 10_000

export async function lookupOrderStatus({ order, contact }, { fetchImpl = fetch, now = Date.now, log = console.error } = {}) {
  try {
    const base = process.env.GATEWAY_URL
    const secret = process.env.CHAT_AGENT_SECRET
    if (!base || !secret || secret.length < 32) {
      log('[orderLookup] skipped: GATEWAY_URL or CHAT_AGENT_SECRET not configured')
      return { ok: false }
    }
    const body = JSON.stringify({ order, contact })
    const ts = String(now())
    const res = await fetchImpl(`${base.replace(/\/+$/, '')}/internal/order-status`, {
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
      log(`[orderLookup] gateway HTTP ${res?.status}`)
      return { ok: false }
    }
    const json = await res.json()
    return { ok: true, found: json?.found === true, status: json?.found === true ? json.status ?? null : null }
  } catch (err) {
    log(`[orderLookup] failed: ${err?.message}`)
    return { ok: false }
  }
}

/**
 * At most `max` lookups per key (order number) per window, so one order's
 * email/mobile can't be guessed by retrying from many IPs. In memory (single process).
 */
export function createAttemptLimiter({ max = 10, windowMs = 60 * 60 * 1000, now = Date.now } = {}) {
  const hits = new Map() // key → { count, resetAt }
  return {
    hit(key) {
      const t = now()
      const cur = hits.get(key)
      if (!cur || t > cur.resetAt) {
        hits.set(key, { count: 1, resetAt: t + windowMs })
        if (hits.size > 10_000) for (const [k, v] of hits) if (t > v.resetAt) hits.delete(k)
        return true
      }
      if (cur.count >= max) return false
      cur.count += 1
      return true
    }
  }
}
