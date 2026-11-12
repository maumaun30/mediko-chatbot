/**
 * alertScheduler.js - "unanswered conversation" alerts.
 * One alert per unanswered stretch: alerted_at must be older than the
 * customer's latest message (new_conversation also sets alerted_at).
 */
import * as sessions from './sessionService.js'
import { getUnansweredMinutes as realMinutes } from './settingsService.js'
import { postChatEvent as realPost } from './gatewayNotifier.js'
import { maskId } from './redact.js'

const MIN_MS = 60_000

export function shouldAlert(row, minutes, now) {
  if (!sessions.isUnanswered(row)) return false
  const last = sessions.parseDbTime(row.last_customer_at)
  if (now.getTime() - last < minutes * MIN_MS) return false
  const alerted = sessions.parseDbTime(row.alerted_at)
  return alerted === null || alerted < last
}

/** One pass over candidates. A failure on one row never stops the others. */
export async function runAlertTick(d = {}) {
  const log = d.log || console.error
  const find = d.findAlertCandidates || sessions.findAlertCandidates
  const getMinutes = d.getUnansweredMinutes || realMinutes
  const getSession = d.getSession || sessions.getSession
  const post = d.postChatEvent || realPost
  const markAlerted = d.markAlerted || sessions.markAlerted
  const now = (d.now || (() => new Date()))()

  const rows = await find()
  const minutes = await getMinutes()
  for (const row of rows) {
    try {
      if (!shouldAlert(row, minutes, now)) continue
      const s = (await getSession(row.id)) || row
      const ok = await post('unanswered', {
        sessionId: row.id, name: s.customer_name ?? null, email: s.customer_email ?? null,
        phone: s.customer_phone ?? null, text: sessions.stripAgentPrefix(s.last_message) ?? ''
      })
      if (ok) await markAlerted(row.id, now)
    } catch (err) {
      log(`[alerts] ${maskId(row.id)} failed: ${err?.message}`)
    }
  }
}

/** @returns {() => void} stop function. Timer is unref'd; ticks never overlap. */
export function startUnansweredAlerts({
  intervalMs = 60_000, tick = runAlertTick, log = console.error,
  setIntervalImpl = setInterval, clearIntervalImpl = clearInterval
} = {}) {
  let running = false
  const timer = setIntervalImpl(async () => {
    if (running) return
    running = true
    try { await tick() } catch (err) { log(`[alerts] tick failed: ${err?.message}`) } finally { running = false }
  }, intervalMs)
  timer?.unref?.()
  return () => clearIntervalImpl(timer)
}
