/**
 * settingsService.js
 * Reads/writes settings from the chat_settings table.
 */
import { supabase } from '../db/supabase.js'

const cache = {}
const TTL   = 60_000

async function getSetting(key) {
  if (cache[key] && Date.now() - cache[key].ts < TTL) return cache[key].val
  const { data, error } = await supabase
    .from('chat_settings').select('value').eq('key', key).single()
  if (error) return null
  cache[key] = { val: data.value, ts: Date.now() }
  return data.value
}

async function setSetting(key, value) {
  const { error } = await supabase
    .from('chat_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() })
  if (error) throw new Error(error.message)
  cache[key] = { val: value, ts: Date.now() }
}

export async function getBusinessHours()    { return await getSetting('business_hours') }
export async function saveBusinessHours(v)  { return await setSetting('business_hours', v) }
export async function getIdleMinutes()      { const s = await getSetting('idle_minutes'); return s?.value ?? 30 }
export async function saveIdleMinutes(mins) { return await setSetting('idle_minutes', { value: mins }) }

export async function isWithinBusinessHours() {
  const bh = await getBusinessHours()
  if (!bh?.enabled) return true
  const tz    = bh.timezone || 'Asia/Manila'
  const now   = new Date()
  const local = new Date(now.toLocaleString('en-US', { timeZone: tz }))
  const days  = ['sun','mon','tue','wed','thu','fri','sat']
  const day   = days[local.getDay()]
  const h     = bh.hours?.[day]
  if (!h?.open) return false
  const [sh, sm] = h.start.split(':').map(Number)
  const [eh, em] = h.end.split(':').map(Number)
  const cur = local.getHours() * 60 + local.getMinutes()
  return cur >= sh * 60 + sm && cur < eh * 60 + em
}

export async function getAwayMessage() {
  const bh = await getBusinessHours()
  return bh?.awayMessage || 'Pasensya na po, wala kaming available na agent sa ngayon. Subukan ulit mamaya.'
}
