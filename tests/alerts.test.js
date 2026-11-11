import { test } from 'node:test'
import assert from 'node:assert/strict'

const S = 's'.repeat(32)
process.env.CHAT_AGENT_SECRET = S
const { signEvent } = await import('../src/services/agentAuth.js')
const { postChatEvent } = await import('../src/services/gatewayNotifier.js')
const { shouldAlert, startUnansweredAlerts, runAlertTick } = await import('../src/services/alertScheduler.js')
const { createOfflineReplyQueue, installNotificationHooks, createOfflineSender } = await import('../src/services/offlineReplyQueue.js')

const t = (s) => new Date(`2026-11-11T${s}Z`)
const quiet = { log: () => {} }

test('shouldAlert after N minutes, once per stretch', () => {
  const row = { status: 'open', last_customer_at: '2026-11-11 01:00:00', last_agent_at: null, alerted_at: null }
  assert.equal(shouldAlert(row, 10, t('01:09:00')), false)
  assert.equal(shouldAlert(row, 10, t('01:10:00')), true)
  assert.equal(shouldAlert({ ...row, alerted_at: '2026-11-11 01:10:00' }, 10, t('01:30:00')), false)
  assert.equal(shouldAlert({ ...row, alerted_at: '2026-11-11 01:00:00', last_customer_at: '2026-11-11 01:20:00' }, 10, t('01:30:00')), true)
  assert.equal(shouldAlert({ ...row, last_agent_at: '2026-11-11 01:02:00' }, 10, t('01:30:00')), false)
})

test('offline queue: reconnect within debounce → no send', async () => {
  let fire, online = false, sent = 0
  const q = createOfflineReplyQueue({ isOnline: () => online, send: async () => { sent++ }, setTimer: (f) => { fire = f; return 1 }, clearTimer: () => {} })
  q.enqueue('s1'); q.enqueue('s1')
  online = true; await fire()
  assert.equal(sent, 0)
})

test('offline queue: burst → one send', async () => {
  let fire, sent = 0
  const q = createOfflineReplyQueue({ isOnline: () => false, send: async () => { sent++ }, setTimer: (f) => { fire = f; return 1 }, clearTimer: () => {} })
  q.enqueue('s1'); q.enqueue('s1'); q.enqueue('s1'); await fire()
  assert.equal(sent, 1); assert.equal(q.size(), 0)
})

test('offline queue: failing send does not throw and clears entry', async () => {
  let fire
  const q = createOfflineReplyQueue({ isOnline: () => false, send: async () => { throw new Error('x') }, setTimer: (f) => { fire = f; return 1 }, clearTimer: () => {}, log: () => {} })
  q.enqueue('s1'); await fire()
  assert.equal(q.size(), 0)
})

test('postChatEvent signs ts.body and never throws', async () => {
  process.env.GATEWAY_URL = 'https://gw.test'
  let seen
  const ok = await postChatEvent('unanswered', { sessionId: 'x' }, { now: () => 1000, fetchImpl: async (url, o) => { seen = { url, o }; return { ok: true } } })
  assert.equal(ok, true)
  assert.equal(seen.url, 'https://gw.test/internal/chat-events')
  assert.equal(seen.o.headers['X-Mediko-Signature'], signEvent(seen.o.body, '1000', S))
  assert.equal(seen.o.headers['X-Mediko-Timestamp'], '1000')
  assert.deepEqual(JSON.parse(seen.o.body), { type: 'unanswered', sessionId: 'x' })
  assert.equal(await postChatEvent('unanswered', {}, { fetchImpl: async () => { throw new Error('down') }, log: () => {} }), false)
  assert.equal(await postChatEvent('unanswered', {}, { fetchImpl: async () => ({ ok: false, status: 500 }), log: () => {} }), false)
})

test('postChatEvent returns false without secret/url', async () => {
  process.env.CHAT_AGENT_SECRET = ''
  assert.equal(await postChatEvent('x', {}, { fetchImpl: async () => ({ ok: true }), log: () => {} }), false)
  process.env.CHAT_AGENT_SECRET = S
})

test('runAlertTick alerts only due rows, marks alerted, survives failures', async () => {
  const rows = [
    { id: 'a', status: 'open', last_customer_at: '2026-11-11 01:00:00', last_agent_at: null, alerted_at: null },
    { id: 'b', status: 'open', last_customer_at: '2026-11-11 01:25:00', last_agent_at: null, alerted_at: null },
    { id: 'c', status: 'open', last_customer_at: '2026-11-11 01:00:00', last_agent_at: null, alerted_at: null }
  ]
  const posted = [], marked = []
  await runAlertTick({
    now: () => t('01:30:00'), log: () => {},
    findAlertCandidates: async () => rows, getUnansweredMinutes: async () => 10,
    getSession: async (id) => ({ ...rows.find(r => r.id === id), customer_name: 'N', customer_email: 'e@x.ph', customer_phone: '639', last_message: 'hi' }),
    postChatEvent: async (type, p) => { if (p.sessionId === 'c') throw new Error('boom'); posted.push([type, p]); return true },
    markAlerted: async (id) => { marked.push(id) }
  })
  assert.deepEqual(posted.map(p => p[1].sessionId), ['a'])
  assert.equal(posted[0][0], 'unanswered')
  assert.deepEqual(posted[0][1], { sessionId: 'a', name: 'N', email: 'e@x.ph', phone: '639', text: 'hi' })
  assert.deepEqual(marked, ['a'])
})

test('runAlertTick does not mark alerted when post fails', async () => {
  const marked = []
  await runAlertTick({
    now: () => t('01:30:00'), log: () => {},
    findAlertCandidates: async () => [{ id: 'a', status: 'open', last_customer_at: '2026-11-11 01:00:00', last_agent_at: null, alerted_at: null }],
    getUnansweredMinutes: async () => 10, getSession: async () => ({}),
    postChatEvent: async () => false, markAlerted: async (id) => marked.push(id)
  })
  assert.deepEqual(marked, [])
})

test('startUnansweredAlerts unrefs timer, never overlaps ticks, stops', async () => {
  let fn, unrefd = false, cleared = false, running = 0, maxRunning = 0, release
  const timer = { unref() { unrefd = true } }
  const stop = startUnansweredAlerts({
    intervalMs: 5,
    setIntervalImpl: (f) => { fn = f; return timer },
    clearIntervalImpl: (x) => { cleared = x === timer },
    tick: async () => { running++; maxRunning = Math.max(maxRunning, running); await new Promise(r => { release = r }); running-- }
  })
  assert.equal(unrefd, true)
  fn(); fn(); fn()
  assert.equal(maxRunning, 1)
  release(); await new Promise(r => setImmediate(r))
  fn(); assert.equal(running, 1); release()
  stop(); assert.equal(cleared, true)
})

test('startUnansweredAlerts swallows tick errors', async () => {
  let fn
  startUnansweredAlerts({ setIntervalImpl: (f) => { fn = f; return { unref() {} } }, tick: async () => { throw new Error('x') }, log: () => {} })
  await fn()
})

function harness(over = {}) {
  const calls = { posts: [], alerted: [], enq: [], prev: [], emailed: [] }
  const hooks = {
    onCustomerMessage: async (...a) => { calls.prev.push(['cm', ...a]) },
    onAgentMessage: async (...a) => { calls.prev.push(['am', ...a]) },
    onCustomerTyping: async () => {}
  }
  const queue = { enqueue: (id) => calls.enq.push(id), size: () => 0 }
  installNotificationHooks(hooks, {
    isOnline: () => false, queue, log: () => {}, now: () => t('02:00:00'),
    postChatEvent: async (type, p) => { calls.posts.push([type, p]); return true },
    markAlerted: async (id, at) => { calls.alerted.push([id, at]) },
    ...over
  })
  return { hooks, calls }
}
const sess = { id: 's1', customer_name: 'N', customer_email: 'e@x.ph', customer_phone: '639' }

test('hooks: first customer message → new_conversation + markAlerted, previous handler still runs', async () => {
  const { hooks, calls } = harness()
  await hooks.onCustomerMessage(sess, { content: 'hello' }, true)
  assert.equal(calls.prev.length, 1)
  assert.deepEqual(calls.posts, [['new_conversation', { sessionId: 's1', name: 'N', email: 'e@x.ph', phone: '639', text: 'hello' }]])
  assert.equal(calls.alerted[0][0], 's1')
  await hooks.onCustomerMessage(sess, { content: 'again' }, false)
  assert.equal(calls.posts.length, 1)
})

test('hooks: failed new_conversation post does not mark alerted; errors never escape', async () => {
  const a = harness({ postChatEvent: async () => false })
  await a.hooks.onCustomerMessage(sess, { content: 'x' }, true)
  assert.equal(a.calls.alerted.length, 0)
  const b = harness({ postChatEvent: async () => { throw new Error('net') }, markAlerted: async () => { throw new Error('db') } })
  await b.hooks.onCustomerMessage(sess, { content: 'x' }, true)
})

test('hooks: agent message enqueues only when customer offline', async () => {
  const off = harness()
  await off.hooks.onAgentMessage(sess, { content: 'r' })
  assert.deepEqual(off.calls.enq, ['s1'])
  assert.equal(off.calls.prev.length, 1)
  const on = harness({ isOnline: () => true })
  await on.hooks.onAgentMessage(sess, { content: 'r' })
  assert.deepEqual(on.calls.enq, [])
})

function senderDeps(over = {}) {
  const c = { posts: [], emailed: [] }
  return { c, deps: {
    getSession: async () => ({ id: 's1', customer_name: 'N', customer_email: 'e@x.ph' }),
    agentMessagesToEmail: async () => ['a', 'b'],
    signChatLink: () => 'TOKEN', chatCustomerUrl: 'https://shop.test/p', log: () => {}, now: () => t('03:00:00'),
    postChatEvent: async (type, p) => { c.posts.push([type, p]); return true },
    markEmailed: async (id) => { c.emailed.push(id) }, ...over } }
}

test('offline sender posts offline_reply with link and marks emailed', async () => {
  const { c, deps } = senderDeps()
  await createOfflineSender(deps)('s1')
  assert.deepEqual(c.posts, [['offline_reply', { sessionId: 's1', name: 'N', email: 'e@x.ph', messages: ['a', 'b'], link: 'https://shop.test/p?mdk_chat=TOKEN' }]])
  assert.deepEqual(c.emailed, ['s1'])
})

test('offline sender skips: no email, no messages, signChatLink throws, post fails', async () => {
  for (const over of [
    { getSession: async () => ({ id: 's1', customer_email: null }) },
    { agentMessagesToEmail: async () => [] },
    { signChatLink: () => { throw new Error('secret') } },
    { postChatEvent: async () => false }
  ]) {
    const { c, deps } = senderDeps(over)
    await createOfflineSender(deps)('s1')
    assert.equal(c.emailed.length, 0)
    if (over.postChatEvent === undefined) assert.equal(c.posts.length, 0)
  }
})
