import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizePhMobile } from '../src/services/phone.js'
import { stripAgentPrefix, isUnanswered } from '../src/services/sessionService.js'
import { aiEnabled } from '../src/services/settingsService.js'

test('normalizePhMobile', () => {
  assert.equal(normalizePhMobile('0917 123-4567'), '639171234567')
  assert.equal(normalizePhMobile('+639171234567'), '639171234567')
  assert.equal(normalizePhMobile('12345'), null)
})
test('stripAgentPrefix', () => {
  assert.equal(stripAgentPrefix('[Agent] Hello po'), 'Hello po')
  assert.equal(stripAgentPrefix('Hello'), 'Hello')
})
test('isUnanswered', () => {
  assert.equal(isUnanswered({ status: 'open', last_customer_at: '2026-11-11 01:00:00', last_agent_at: null }), true)
  assert.equal(isUnanswered({ status: 'open', last_customer_at: '2026-11-11 01:00:00', last_agent_at: '2026-11-11 01:05:00' }), false)
  assert.equal(isUnanswered({ status: 'closed', last_customer_at: '2026-11-11 01:00:00', last_agent_at: null }), false)
  assert.equal(isUnanswered({ status: 'open', last_customer_at: null, last_agent_at: null }), false)
})
test('aiEnabled only for exact "true"', () => {
  process.env.AI_ENABLED = 'TRUE'; assert.equal(aiEnabled(), false)
  process.env.AI_ENABLED = 'true'; assert.equal(aiEnabled(), true)
  delete process.env.AI_ENABLED;  assert.equal(aiEnabled(), false)
})
test('getFullHistory returns the latest N messages in chronological order', async () => {
  const { getFullHistory } = await import('../src/services/sessionService.js')
  const calls = []
  const rows = [{ id: 'a', role: 'user', content: 'hi', created_at: 'x' }]
  const run = async (sql, params) => { calls.push({ sql, params }); return rows }
  const out = await getFullHistory('s1', 20, { run })
  assert.deepEqual(out, [{ ...rows[0], preview: null }])
  assert.equal(calls.length, 1)
  const sql = calls[0].sql.replace(/\s+/g, ' ')
  assert.deepEqual(calls[0].params, ['s1'])
  // Inner query picks the newest N, outer query restores chronological order.
  assert.match(sql, /\(\s*SELECT .*FROM chat_messages WHERE session_id = \? ORDER BY seq DESC LIMIT 20\s*\)/)
  assert.match(sql, /\)\s*\w*\s*(AS\s+\w+\s+)?ORDER BY \w*\.?seq ASC\s*$/i)
  // Limit clamps to 1..100
  await getFullHistory('s1', 999, { run })
  assert.match(calls[1].sql, /LIMIT 100\b/)
  await getFullHistory('s1', undefined, { run })
  assert.match(calls[2].sql, /LIMIT 50\b/)
})
