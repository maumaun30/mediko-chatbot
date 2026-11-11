/**
 * settingsService.js
 * Reads/writes settings from the chat_settings table.
 */
import { query, queryOne } from '../db/mysql.js'
import { isOpenAt, nextOpenAt } from './hours.js'

export { isOpenAt, nextOpenAt }

const cache = {}
const TTL   = 60_000

async function getSetting(key) {
  if (cache[key] && Date.now() - cache[key].ts < TTL) return cache[key].val
  const row = await queryOne('SELECT value FROM chat_settings WHERE `key` = ?', [key])
  if (!row) return null
  // mysql2 parses JSON columns into JS objects automatically.
  const val = typeof row.value === 'string' ? JSON.parse(row.value) : row.value
  cache[key] = { val, ts: Date.now() }
  return val
}

async function setSetting(key, value) {
  await query(
    `INSERT INTO chat_settings (\`key\`, value, updated_at)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)`,
    [key, JSON.stringify(value), new Date()]
  )
  cache[key] = { val: value, ts: Date.now() }
}

export async function getBusinessHours()    { return await getSetting('business_hours') }
export async function saveBusinessHours(v)  { return await setSetting('business_hours', v) }

export async function isWithinBusinessHours() {
  return isOpenAt(await getBusinessHours(), new Date())
}

/** Minutes a customer message may sit unanswered before an alert. Default 10 (row may be absent). */
export async function getUnansweredMinutes() {
  const s = await getSetting('unanswered_minutes')
  return s?.value ?? 10
}
export async function saveUnansweredMinutes(n) { return await setSetting('unanswered_minutes', { value: n }) }

export async function getAwayMessage() {
  const bh = await getBusinessHours()
  return bh?.awayMessage || 'Pasensya na po, wala kaming available na agent sa ngayon. Subukan ulit mamaya.'
}

/** AI replies are on only when AI_ENABLED is exactly the string 'true'. */
export function aiEnabled() {
  return process.env.AI_ENABLED === 'true'
}
