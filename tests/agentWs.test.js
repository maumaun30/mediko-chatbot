import { test } from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'

const S = 'z'.repeat(32)
process.env.CHAT_AGENT_SECRET = S

const { authorizeUpgrade, createPresence, handleAgentCommand, broadcast, isOnline, subscribeWidget, unsubscribeWidget } =
  await import('../src/services/agentService.js')

const token = jwt.sign({ sub: '42' }, S, { algorithm: 'HS256', issuer: 'mediko-gateway', audience: 'mediko-chat', expiresIn: 300 })
const O = 'https://mediko-gateway.quailshack.com'

test('authorizeUpgrade requires origin + token', () => {
  const ok = { url: `/api/agent/ws?token=${token}`, headers: { origin: O } }
  assert.deepEqual(authorizeUpgrade(ok, { secret: S, gatewayOrigin: O }), { sub: '42' })
  assert.equal(authorizeUpgrade({ ...ok, headers: { origin: 'https://evil.example' } }, { secret: S, gatewayOrigin: O }), null)
  assert.equal(authorizeUpgrade({ ...ok, headers: {} }, { secret: S, gatewayOrigin: O }), null)
  assert.equal(authorizeUpgrade({ ...ok, url: '/api/agent/ws' }, { secret: S, gatewayOrigin: O }), null)
  assert.equal(authorizeUpgrade({ ...ok, url: `/api/agent/ws?token=bad` }, { secret: S, gatewayOrigin: O }), null)
  assert.equal(authorizeUpgrade({ ...ok, url: `/other?token=${token}` }, { secret: S, gatewayOrigin: O }), null)
})

test('authorizeUpgrade fails closed when gatewayOrigin is unset', () => {
  const req = { url: `/api/agent/ws?token=${token}`, headers: {} }
  assert.equal(authorizeUpgrade(req, { secret: S, gatewayOrigin: undefined }), null)
  assert.equal(authorizeUpgrade(req, { secret: S, gatewayOrigin: '' }), null)
})

test('presence: two tabs, one closes → still online', () => {
  const p = createPresence(), a = {}, b = {}
  p.add('s1', a); p.add('s1', b); p.remove('s1', a)
  assert.equal(p.isOnline('s1'), true)
  p.remove('s1', b)
  assert.equal(p.isOnline('s1'), false)
})

test('presence.each visits every subscriber', () => {
  const p = createPresence(), a = {}, b = {}, seen = []
  p.add('s1', a); p.add('s1', b)
  p.each('s1', (r) => seen.push(r)); p.each('nope', () => assert.fail())
  assert.deepEqual(seen, [a, b])
})

test('subscribeWidget/unsubscribeWidget report online transitions and feed isOnline', () => {
  const a = {}, b = {}
  assert.equal(subscribeWidget('t1', a), true)
  assert.equal(subscribeWidget('t1', b), false)
  assert.equal(isOnline('t1'), true)
  assert.equal(unsubscribeWidget('t1', a), false)
  assert.equal(unsubscribeWidget('t1', b), true)
  assert.equal(isOnline('t1'), false)
})

function deps(over = {}) {
  const calls = { broadcast: [], push: [], saved: [], status: [], hook: [], dispatched: [] }
  const row = { id: 's1', channel: 'widget', channel_user_id: null, status: 'open', customer_name: 'Ana' }
  return {
    calls,
    deps: {
      getSession: async (id) => (id === 's1' ? row : null),
      saveAgentMessage: async (id, text) => { const m = { id: 9, role: 'agent', content: text, created_at: 'x' }; calls.saved.push([id, text]); return m },
      setStatus: async (id, st) => { calls.status.push([id, st]) },
      dispatchReply: async (...a) => { calls.dispatched.push(a) },
      broadcast: (e) => calls.broadcast.push(e),
      pushToWidget: (id, e) => calls.push.push([id, e]),
      onAgentMessage: async (...a) => { calls.hook.push(a) },
      ...over
    }
  }
}

test('agent_message saves, hooks, broadcasts agent_sent and pushes to widget', async () => {
  const { calls, deps: d } = deps()
  await handleAgentCommand({ type: 'agent_message', sessionId: 's1', text: 'hello' }, d)
  assert.deepEqual(calls.saved, [['s1', 'hello']])
  assert.equal(calls.hook.length, 1)
  assert.equal(calls.hook[0][1].content, 'hello')
  assert.ok(calls.broadcast.some(e => e.type === 'agent_sent' && e.sessionId === 's1' && e.message.content === 'hello'))
  assert.ok(calls.broadcast.some(e => e.type === 'session_updated' && e.conversation.id === 's1'))
  assert.equal(calls.push[0][0], 's1')
  assert.equal(calls.push[0][1].type, 'agent_message')
  assert.equal(calls.push[0][1].message.role, 'agent')
})

test('invalid commands throw validation errors and have no side effects', async () => {
  const bad = [
    { type: 'take_over', sessionId: 's1' },
    { type: 'return_to_ai', sessionId: 's1' },
    { type: 'nope', sessionId: 's1' },
    { type: 'agent_message', text: 'hi' },
    { type: 'agent_message', sessionId: 'ghost', text: 'hi' },
    { type: 'agent_message', sessionId: 's1' },
    { type: 'agent_message', sessionId: 's1', text: '' },
    { type: 'agent_message', sessionId: 's1', text: '   ' },
    { type: 'agent_message', sessionId: 's1', text: 'x'.repeat(2001) },
    { type: 'agent_message', sessionId: 's1', text: 5 },
    { type: 'close', sessionId: {} },
    { type: 'reopen', sessionId: 'ghost' },
    null, 'str'
  ]
  for (const cmd of bad) {
    const { calls, deps: d } = deps()
    await assert.rejects(() => handleAgentCommand(cmd, d), (e) => e.expose === true, JSON.stringify(cmd))
    assert.equal(calls.saved.length + calls.status.length + calls.push.length + calls.broadcast.length, 0)
  }
  const { deps: d } = deps()
  await handleAgentCommand({ type: 'agent_message', sessionId: 's1', text: 'x'.repeat(2000) }, d)
})

test('typing pushes agent_typing to widget; close/reopen set status and broadcast session_updated', async () => {
  const { calls, deps: d } = deps()
  await handleAgentCommand({ type: 'typing', sessionId: 's1', value: true }, d)
  assert.deepEqual(calls.push, [['s1', { type: 'agent_typing', value: true }]])
  await handleAgentCommand({ type: 'close', sessionId: 's1' }, d)
  await handleAgentCommand({ type: 'reopen', sessionId: 's1' }, d)
  assert.deepEqual(calls.status, [['s1', 'closed'], ['s1', 'open']])
  assert.equal(calls.broadcast.filter(e => e.type === 'session_updated').length, 2)
})

test('hook failure does not stop the reply', async () => {
  const { calls, deps: d } = deps({ onAgentMessage: async () => { throw new Error('boom') } })
  await handleAgentCommand({ type: 'agent_message', sessionId: 's1', text: 'hi' }, d)
  assert.ok(calls.broadcast.some(e => e.type === 'agent_sent'))
})

test('hooks broadcast customer_message and customer_typing', async () => {
  const { hooks } = await import('../src/services/chatEvents.js')
  const sent = []
  const ws = { readyState: 1, send: (s) => sent.push(JSON.parse(s)) }
  const { registerAgentSocket } = await import('../src/services/agentService.js')
  const off = registerAgentSocket(ws)
  const row = { id: 's1', status: 'open', customer_name: 'Ana', last_customer_at: 'a', last_agent_at: null }
  await hooks.onCustomerMessage(row, { id: 1, role: 'user', content: 'hey' }, true)
  await hooks.onCustomerTyping('s1')
  off()
  const cm = sent.find(e => e.type === 'customer_message')
  assert.equal(cm.sessionId, 's1'); assert.equal(cm.message.content, 'hey'); assert.equal(cm.conversation.lastMessage, 'hey')
  assert.deepEqual(sent.find(e => e.type === 'customer_typing').sessionId, 's1')
  broadcast({ type: 'x' }) // no sockets left, must not throw
})

test('customerMessageEvent pins the customer_message contract', async () => {
  const { customerMessageEvent } = await import('../src/services/agentService.js')
  const ev = customerMessageEvent({ id: 's1', status: 'open', customer_name: 'Ana' }, { id: 3, role: 'user', content: 'hi', created_at: 'x' })
  assert.deepEqual(Object.keys(ev).sort(), ['conversation', 'message', 'sessionId', 'type'])
  assert.equal(ev.type, 'customer_message'); assert.equal(ev.sessionId, 's1')
  assert.equal(ev.message.content, 'hi')
  assert.equal(ev.conversation.id, 's1'); assert.equal(ev.conversation.lastMessage, 'hi')
})

test('conversationManager no longer emits legacy-shaped events', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/services/conversationManager.js', import.meta.url), 'utf8')
  assert.ok(!/broadcast\(/.test(src))
})

test('toConversation maps last_message and strips legacy [Agent] prefix', async () => {
  const { toConversation } = await import('../src/services/conversationView.js')
  assert.equal(toConversation({ id: 's', status: 'open', last_message: 'hello' }).lastMessage, 'hello')
  assert.equal(toConversation({ id: 's', status: 'open', last_message: '[Agent] hello' }).lastMessage, 'hello')
  assert.equal(toConversation({ id: 's', status: 'open' }).lastMessage, null)
})
