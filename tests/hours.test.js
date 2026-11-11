import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isOpenAt, nextOpenAt } from '../src/services/hours.js'

const wk = { open: true, start: '08:00', end: '17:00' }
const bh = { enabled: true, timezone: 'Asia/Manila', hours: {
  mon: wk, tue: wk, wed: wk, thu: wk, fri: wk, sat: { open: false }, sun: { open: false } } }

test('open Wed 10:00 Manila', () => assert.equal(isOpenAt(bh, new Date('2026-11-11T02:00:00Z')), true))
test('closed Wed 17:00 Manila', () => assert.equal(isOpenAt(bh, new Date('2026-11-11T09:00:00Z')), false))
test('Sat 21:00 -> next open Mon 08:00 Manila', () =>
  assert.equal(nextOpenAt(bh, new Date('2026-11-14T13:00:00Z')).toISOString(), '2026-11-16T00:00:00.000Z'))
test('Wed 07:00 -> same day 08:00', () =>
  assert.equal(nextOpenAt(bh, new Date('2026-11-10T23:00:00Z')).toISOString(), '2026-11-11T00:00:00.000Z'))
test('disabled hours = always open, no nextOpenAt', () => {
  assert.equal(isOpenAt({ ...bh, enabled: false }, new Date('2026-11-14T13:00:00Z')), true)
  assert.equal(nextOpenAt({ ...bh, enabled: false }, new Date()), null)
})
test('no open day -> null', () => {
  const none = { ...bh, hours: {} }
  assert.equal(nextOpenAt(none, new Date('2026-11-11T02:00:00Z')), null)
})
