/**
 * aiRateLimit.js
 *
 * Two layers of protection, both in-memory (single instance):
 *
 *  1. GLOBAL Gemini quota guard — caps total AI calls per minute (RPM) and
 *     per UTC day (RPD) across ALL channels (widget + WhatsApp + Messenger),
 *     so we never blow the Gemini free-tier quota and get 429s from Google.
 *     Set the limits a little BELOW Google's actual caps for headroom.
 *
 *  2. PER-SESSION spam guard — blocks bursts, duplicate floods, and a single
 *     user draining the daily quota, before any Gemini/Shopify/DB work.
 *
 * For a multi-instance deployment, back these with Redis (INCR + EXPIRE).
 */

// ── Config (env-overridable) ─────────────────────────────────
// Gemini free tier for gemini-2.5-flash is roughly ~10 RPM / ~250 RPD, but
// Google changes these — check https://ai.google.dev/gemini-api/docs/rate-limits
// and keep these a bit lower than your actual quota.
const RPM_LIMIT          = parseInt(process.env.GEMINI_RPM_LIMIT      || '10',  10)
const RPD_LIMIT          = parseInt(process.env.GEMINI_RPD_LIMIT      || '200', 10)

// Per-session spam thresholds
const BURST_MAX          = parseInt(process.env.SESSION_BURST_MAX     || '6',   10)  // msgs
const BURST_WINDOW_MS    = parseInt(process.env.SESSION_BURST_WINDOW  || '15',  10) * 1000
const SESSION_DAILY_MAX  = parseInt(process.env.SESSION_DAILY_MAX     || '60',  10)
const DUP_WINDOW_MS      = 60_000   // identical message within 60s = duplicate

const utcDay = () => new Date().toISOString().slice(0, 10)

// ── 1. Global Gemini quota ───────────────────────────────────

let callTimes = []        // timestamps of AI calls in the last 60s (rolling RPM)
let dayKey    = utcDay()
let dayCount  = 0

/**
 * Reserve one global AI call. Call this right before streamChat().
 * @returns {{ ok: boolean, reason?: 'minute'|'daily', retryAfter?: number }}
 */
export function consumeAiQuota() {
  const now = Date.now()

  // Rolling 1-minute window
  callTimes = callTimes.filter(t => now - t < 60_000)

  // Daily window (UTC)
  const dk = utcDay()
  if (dk !== dayKey) { dayKey = dk; dayCount = 0 }

  if (dayCount >= RPD_LIMIT) return { ok: false, reason: 'daily' }
  if (callTimes.length >= RPM_LIMIT) {
    const retryAfter = Math.ceil((60_000 - (now - callTimes[0])) / 1000)
    return { ok: false, reason: 'minute', retryAfter: Math.max(1, retryAfter) }
  }

  callTimes.push(now)
  dayCount++
  return { ok: true }
}

/** Current global quota usage — handy for /health or logging. */
export function aiQuotaStatus() {
  const now = Date.now()
  callTimes = callTimes.filter(t => now - t < 60_000)
  if (utcDay() !== dayKey) { dayKey = utcDay(); dayCount = 0 }
  return { rpm: callTimes.length, rpmLimit: RPM_LIMIT, rpd: dayCount, rpdLimit: RPD_LIMIT }
}

// ── 2. Per-session spam guard ────────────────────────────────

/** @type {Map<string, { times: number[], lastText: string, lastAt: number, dayKey: string, dayCount: number }>} */
const sessions = new Map()

/**
 * Check whether this message should be blocked as spam. Does NOT touch the
 * Gemini quota — call this first, before consumeAiQuota().
 *
 * @param {string} key   — sessionId (widget) or channelUserId (Meta)
 * @param {string} text
 * @returns {{ blocked: boolean, reason?: 'burst'|'duplicate'|'session_daily' }}
 */
export function spamCheck(key, text) {
  if (!key) return { blocked: false }
  const now = Date.now()

  let s = sessions.get(key)
  if (!s) { s = { times: [], lastText: '', lastAt: 0, dayKey: utcDay(), dayCount: 0 }; sessions.set(key, s) }

  // Daily reset
  if (s.dayKey !== utcDay()) { s.dayKey = utcDay(); s.dayCount = 0 }

  // Burst — too many messages in a short window
  s.times = s.times.filter(t => now - t < BURST_WINDOW_MS)
  if (s.times.length >= BURST_MAX) return { blocked: true, reason: 'burst' }

  // Duplicate — same text repeated quickly
  const norm = (text || '').trim().toLowerCase()
  if (norm && norm === s.lastText && now - s.lastAt < DUP_WINDOW_MS) {
    return { blocked: true, reason: 'duplicate' }
  }

  // Per-session daily cap — stops one user draining the global RPD
  if (s.dayCount >= SESSION_DAILY_MAX) return { blocked: true, reason: 'session_daily' }

  // Record
  s.times.push(now)
  s.lastText = norm
  s.lastAt   = now
  s.dayCount++
  return { blocked: false }
}

/** Friendly Tagalog message for a blocked/throttled state. */
export function throttleMessage(reason) {
  switch (reason) {
    case 'burst':
      return 'Sandali lang po — masyadong mabilis ang mga mensahe. Maghintay po ng ilang segundo bago magpadala ulit. 🙏'
    case 'duplicate':
      return 'Naitanong nyo na po ito kani-kanina lang. 😊 May iba pa po ba akong maitutulong?'
    case 'session_daily':
      return 'Naabot na po ang limitasyon ng mensahe para ngayong araw. Maaari po kayong bumalik bukas, o pindutin ang "Kausapin ang Ahente" para sa tulong ng aming team.'
    case 'minute':
      return 'Sandali lang po — marami pong kasalukuyang gumagamit ng aming AI assistant. Subukan po ulit pagkaraan ng ilang segundo, o pindutin ang "Kausapin ang Ahente".'
    case 'daily':
      return 'Pasensya na po, abala na sa ngayon ang aming AI assistant. Pindutin po ang "Kausapin ang Ahente" para matulungan kayo ng aming team, o subukan ulit bukas.'
    default:
      return 'Sandali lang po at subukan ulit.'
  }
}

// Periodic cleanup of idle sessions (avoid unbounded growth)
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  for (const [k, s] of sessions.entries()) {
    if (s.lastAt < cutoff && (!s.times.length || s.times[s.times.length - 1] < cutoff)) {
      sessions.delete(k)
    }
  }
}, 60 * 60 * 1000).unref?.()
