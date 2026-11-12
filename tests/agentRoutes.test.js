import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import jwt from 'jsonwebtoken'

const SECRET = 'y'.repeat(32)
process.env.CHAT_AGENT_SECRET = SECRET

const { default: requireAgentPlugin } = await import('../src/plugins/requireAgent.js')
const { default: agentRoutes } = await import('../src/routes/agent.js')
const { corsOriginFor, allowedOrigins } = await import('../src/plugins/security.js')

const token = jwt.sign({ sub: '42' }, SECRET, { algorithm: 'HS256', issuer: 'mediko-gateway', audience: 'mediko-chat', expiresIn: 300 })
const auth = { authorization: `Bearer ${token}` }

const saved = { hours: null, mins: null }
const sessions = {
  listConversations: async () => [{ id: 's1', customer_name: null, customer_email: null, customer_phone: null, status: 'open', last_customer_at: '2026-01-01 00:00:00', last_agent_at: null, last_active: '2026-01-01 00:00:00', last_message: 'hi' }],
  getSession: async (id) => id === 's1' ? { id: 's1', customer_name: 'Ana', status: 'open', last_active: '2026-01-01 00:00:00' } : null,
  getFullHistory: async () => [{ id: 1, role: 'agent', content: '[Agent] hello', created_at: 'x' }, { id: 2, role: 'user', content: '[Agent] keep', created_at: 'y' }],
  countConversations: async () => ({ open: 4, unanswered: 2 })
}
const settings = {
  getBusinessHours: async () => saved.hours || { enabled: true },
  saveBusinessHours: async (v) => { saved.hours = v },
  getUnansweredMinutes: async () => saved.mins ?? 10,
  saveUnansweredMinutes: async (n) => { saved.mins = n }
}

let app
before(async () => {
  app = Fastify()
  await app.register(requireAgentPlugin)
  await app.register(agentRoutes, { prefix: '/api/agent', sessions, settings })
  await app.ready()
})
after(() => app.close())

test('GET /api/agent/conversations without token -> 401', async () => {
  const res = await app.inject({ url: '/api/agent/conversations' })
  assert.equal(res.statusCode, 401)
  assert.deepEqual(res.json(), { error: 'Unauthorized' })
})
test('garbage token -> 401', async () => {
  const res = await app.inject({ url: '/api/agent/settings', headers: { authorization: 'Bearer nope' } })
  assert.equal(res.statusCode, 401)
})
test('with valid token -> list mapped, unknown visitor name', async () => {
  const res = await app.inject({ url: '/api/agent/conversations?status=open', headers: auth })
  assert.equal(res.statusCode, 200)
  const c = res.json().conversations[0]
  assert.equal(c.displayName, 'Unknown visitor')
  assert.equal(c.unanswered, true)
  assert.equal(c.online, false)
})
test('conversation detail strips agent prefix on agent rows only', async () => {
  const res = await app.inject({ url: '/api/agent/conversations/s1', headers: auth })
  assert.equal(res.statusCode, 200)
  const { conversation, messages } = res.json()
  assert.equal(conversation.displayName, 'Ana')
  assert.equal(messages[0].content, 'hello')
  assert.equal(messages[1].content, '[Agent] keep')
  const nf = await app.inject({ url: '/api/agent/conversations/zzz', headers: auth })
  assert.equal(nf.statusCode, 404)
})
test('PUT /settings rejects unansweredMinutes 0 and 241', async () => {
  for (const v of [0, 241]) {
    const res = await app.inject({ method: 'PUT', url: '/api/agent/settings', headers: auth, payload: { unansweredMinutes: v } })
    assert.equal(res.statusCode, 400)
  }
})
test('PUT /settings without token -> 401, with token saves', async () => {
  const no = await app.inject({ method: 'PUT', url: '/api/agent/settings', payload: { unansweredMinutes: 5 } })
  assert.equal(no.statusCode, 401)
  const ok = await app.inject({ method: 'PUT', url: '/api/agent/settings', headers: auth, payload: { unansweredMinutes: 5 } })
  assert.equal(ok.statusCode, 200)
  assert.equal(ok.json().unansweredMinutes, 5)
})
test('corsOriginFor', () => {
  process.env.ALLOWED_ORIGINS = 'https://store.mediko.ph,https://mediko-gateway.quailshack.com'
  assert.equal(corsOriginFor('https://store.mediko.ph'), 'https://store.mediko.ph')
  assert.equal(corsOriginFor('https://evil.example'), '')
  assert.equal(corsOriginFor(undefined), '')
  delete process.env.ALLOWED_ORIGINS
  process.env.WIDGET_ALLOWED_ORIGIN = 'https://w.example'
  assert.deepEqual(allowedOrigins(), ['https://w.example'])
})

test('POST /api/chat/session rejects whitespace-only customerName with 400', async () => {
  const { default: chatRoutes } = await import('../src/routes/chat.js')
  const a = Fastify()
  await a.register(chatRoutes)
  const res = await a.inject({
    method: 'POST', url: '/session',
    payload: { customerName: '   ', customerEmail: 'a@b.co', customerPhone: '09171234567' }
  })
  assert.equal(res.statusCode, 400)
  assert.equal(res.json().error, 'Please enter your name.')
  await a.close()
})

test('GET /api/agent/stats returns open/unanswered counts and office-hours flag', async () => {
  assert.equal((await app.inject({ url: '/api/agent/stats' })).statusCode, 401)
  const res = await app.inject({ url: '/api/agent/stats', headers: auth })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.json(), { open: 4, unanswered: 2, officeHoursEnabled: true })
})
