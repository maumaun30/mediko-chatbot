/**
 * hours.js - pure office-hours helpers (no DB).
 * Wall-clock time in the configured timezone comes from Intl parts.
 */
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

function localParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false, weekday: 'short',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric'
  }).formatToParts(date)
  const get = (t) => parts.find(p => p.type === t).value
  return {
    day:    get('weekday').slice(0, 3).toLowerCase(),
    year:   Number(get('year')),
    month:  Number(get('month')),
    dayOfMonth: Number(get('day')),
    minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute'))
  }
}

const toMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0) }

export function isOpenAt(bh, date) {
  if (!bh || bh.enabled === false) return true
  const p = localParts(date, bh.timezone || 'Asia/Manila')
  const h = bh.hours?.[p.day]
  if (!h?.open) return false
  return p.minutes >= toMin(h.start) && p.minutes < toMin(h.end)
}

export function nextOpenAt(bh, date) {
  if (!bh || bh.enabled === false) return null
  const tz = bh.timezone || 'Asia/Manila'
  const p = localParts(date, tz)
  // Offset between local wall clock and UTC at `date`, in ms.
  const localAsUtc = Date.UTC(p.year, p.month - 1, p.dayOfMonth, 0, 0) + p.minutes * 60000
  const offset = localAsUtc - Math.floor(date.getTime() / 60000) * 60000
  const startIdx = DAYS.indexOf(p.day)
  for (let k = 0; k <= 7; k++) {
    const h = bh.hours?.[DAYS[(startIdx + k) % 7]]
    if (!h?.open) continue
    const startMin = toMin(h.start)
    if (k === 0 && startMin <= p.minutes) continue
    return new Date(Date.UTC(p.year, p.month - 1, p.dayOfMonth + k, 0, startMin) - offset)
  }
  return null
}

const SCHEDULE_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Office schedule the widget can show (Mon→Sun), or null when office hours are
 * off (chat treated as always open). Only open/start/end leave the server.
 */
export function publicSchedule(bh) {
  if (!bh || bh.enabled === false) return null
  return {
    timezone: bh.timezone || 'Asia/Manila',
    days: SCHEDULE_DAYS.map(day => {
      const h = bh.hours?.[day] || {}
      const open = !!h.open && HHMM.test(h.start || '') && HHMM.test(h.end || '')
      return { day, open, start: open ? h.start : null, end: open ? h.end : null }
    })
  }
}
