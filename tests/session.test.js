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
