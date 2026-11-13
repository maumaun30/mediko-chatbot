import test from 'node:test'
import assert from 'node:assert/strict'
import { lookupOrderStatus, createAttemptLimiter } from '../src/services/orderLookup.js'
import { signEvent } from '../src/services/agentAuth.js'

const S = 'x'.repeat(40)

test('lookupOrderStatus signs ts.body to /internal/order-status and returns the gateway answer', async () => {
  process.env.GATEWAY_URL = 'https://gw.test/'; process.env.CHAT_AGENT_SECRET = S
  let seen
  const out = await lookupOrderStatus({ order: '#1042', contact: '09171234567' }, {
    now: () => 1000,
    fetchImpl: async (url, o) => { seen = { url, o }; return { ok: true, json: async () => ({ found: true, status: { order: '#1042', state: 'shipped' } }) } }
  })
  assert.equal(seen.url, 'https://gw.test/internal/order-status')
  assert.equal(seen.o.headers['X-Mediko-Signature'], signEvent(seen.o.body, '1000', S))
  assert.deepEqual(JSON.parse(seen.o.body), { order: '#1042', contact: '09171234567' })
  assert.deepEqual(out, { ok: true, found: true, status: { order: '#1042', state: 'shipped' } })
})

test('lookupOrderStatus: not found, gateway errors and misconfig never throw', async () => {
  process.env.GATEWAY_URL = 'https://gw.test'; process.env.CHAT_AGENT_SECRET = S
  assert.deepEqual(await lookupOrderStatus({ order: '1', contact: 'x' }, { fetchImpl: async () => ({ ok: true, json: async () => ({ found: false }) }), log: () => {} }), { ok: true, found: false, status: null })
  assert.deepEqual(await lookupOrderStatus({ order: '1', contact: 'x' }, { fetchImpl: async () => ({ ok: false, status: 500 }), log: () => {} }), { ok: false })
  assert.deepEqual(await lookupOrderStatus({ order: '1', contact: 'x' }, { fetchImpl: async () => { throw new Error('down') }, log: () => {} }), { ok: false })
  delete process.env.GATEWAY_URL
  assert.deepEqual(await lookupOrderStatus({ order: '1', contact: 'x' }, { log: () => {} }), { ok: false })
})

test('createAttemptLimiter: max tries per key per window', () => {
  let t = 0
  const lim = createAttemptLimiter({ max: 3, windowMs: 1000, now: () => t })
  assert.equal(lim.hit('1042'), true); assert.equal(lim.hit('1042'), true); assert.equal(lim.hit('1042'), true)
  assert.equal(lim.hit('1042'), false)
  assert.equal(lim.hit('2000'), true)
  t = 1001
  assert.equal(lim.hit('1042'), true)
})

test('POST /api/chat/order-status validates, limits per order and hides not-found vs mismatch', async () => {
  const { default: Fastify } = await import('fastify')
  const { default: chatRoutes } = await import('../src/routes/chat.js')
  const calls = []
  const app = Fastify()
  await app.register(chatRoutes, {
    prefix: '/api/chat',
    orderAttempts: createAttemptLimiter({ max: 2, windowMs: 60_000 }),
    lookupOrderStatus: async (q) => { calls.push(q); return q.order === '1042' && q.contact === '09171234567'
      ? { ok: true, found: true, status: { order: '#1042', state: 'shipped' } } : { ok: true, found: false } }
  })
  await app.ready()
  const post = (payload) => app.inject({ method: 'POST', url: '/api/chat/order-status', payload })
  assert.equal((await post({ order: 'abc', contact: '09171234567' })).statusCode, 400)
  assert.equal((await post({ order: '#1042', contact: 'nope' })).statusCode, 400)
  const ok = await post({ order: 'Order #1042', contact: '09171234567' })
  assert.deepEqual(ok.json(), { found: true, status: { order: '#1042', state: 'shipped' } })
  assert.deepEqual(calls[0], { order: '1042', contact: '09171234567' })
  assert.deepEqual((await post({ order: '#1042', contact: 'x@y.ph' })).json(), { found: false })
  assert.equal((await post({ order: '#1042', contact: '09171234567' })).statusCode, 429)
  await app.close()
})

test('POST /api/chat/typing ignores unknown sessions (no agent broadcast)', async () => {
  const { default: Fastify } = await import('fastify')
  const { default: chatRoutes } = await import('../src/routes/chat.js')
  const { hooks } = await import('../src/services/chatEvents.js')
  const seen = []
  const prev = hooks.onCustomerTyping
  hooks.onCustomerTyping = async (id) => { seen.push(id) }
  const app = Fastify()
  await app.register(chatRoutes, { prefix: '/api/chat', sessionExists: async (id) => id === '11111111-1111-4111-8111-111111111111' })
  await app.ready()
  const post = (sessionId) => app.inject({ method: 'POST', url: '/api/chat/typing', payload: { sessionId } })
  assert.equal((await post('22222222-2222-4222-8222-222222222222')).statusCode, 204)
  assert.equal((await post('11111111-1111-4111-8111-111111111111')).statusCode, 204)
  assert.deepEqual(seen, ['11111111-1111-4111-8111-111111111111'])
  hooks.onCustomerTyping = prev
  await app.close()
})
