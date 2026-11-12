import test from 'node:test'
import assert from 'node:assert/strict'
import { isUnread, getFullHistory, messageFromRow } from '../src/services/sessionService.js'
import { toConversation } from '../src/services/conversationView.js'

test('isUnread: customer wrote after the last time an agent opened the chat', () => {
  assert.equal(isUnread({ last_customer_at: '2026-11-12 01:00:00', agent_seen_at: null }), true)
  assert.equal(isUnread({ last_customer_at: '2026-11-12 01:00:00', agent_seen_at: '2026-11-12 01:00:05' }), false)
  assert.equal(isUnread({ last_customer_at: '2026-11-12 01:10:00', agent_seen_at: '2026-11-12 01:00:05' }), true)
  assert.equal(isUnread({ last_customer_at: null, agent_seen_at: null }), false)
})

test('toConversation exposes unread separately from unanswered', () => {
  const row = { id: 's', status: 'open', last_customer_at: '2026-11-12 01:00:00', last_agent_at: null, agent_seen_at: '2026-11-12 01:00:05' }
  const c = toConversation(row, false)
  assert.equal(c.unread, false)
  assert.equal(c.unanswered, true)
})

test('getFullHistory selects meta so previews come back with history', async () => {
  let sql = ''
  await getFullHistory('s', 50, { run: async (q) => { sql = q; return [] } })
  assert.match(sql, /\bmeta\b/)
})

test('messageFromRow lifts meta.preview and drops raw meta', () => {
  const p = { url: 'https://store.mediko.ph/products/x', title: 'X' }
  assert.deepEqual(messageFromRow({ id: 1, role: 'agent', content: 'hi', created_at: 't', meta: { preview: p } }),
    { id: 1, role: 'agent', content: 'hi', created_at: 't', preview: p })
  assert.deepEqual(messageFromRow({ id: 2, role: 'user', content: 'yo', created_at: 't', meta: null }),
    { id: 2, role: 'user', content: 'yo', created_at: 't', preview: null })
  assert.equal(messageFromRow({ id: 3, role: 'agent', content: 'z', created_at: 't', meta: '{"preview":{"url":"u","title":"T"}}' }).preview.title, 'T')
})
