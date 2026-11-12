/**
 * Launch hardening: client IP / rate-limit buckets, log redaction, the
 * requireAgent gate, the agent WebSocket upgrade, heartbeat and ping/pong,
 * and the legacy-session backfill. No database needed.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { Writable } from 'node:stream'
import Fastify from 'fastify'
import jwt from 'jsonwebtoken'
import WebSocket from 'ws'

const SECRET = 'h'.repeat(32)
const ORIGIN = 'https://gateway.test'
process.env.CHAT_AGENT_SECRET = SECRET
process.env.GATEWAY_ORIGIN = ORIGIN
process.env.ALLOWED_ORIGINS = 'https://store.test'

const { parseTrustProxy, serverOptions } = await import('../src/serverOptions.js')
const { redactUrl, maskId } = await import('../src/services/redact.js')
const { default: securityPlugins } = await import('../src/plugins/security.js')
const { default: requireAgentPlugin } = await import('../src/plugins/requireAgent.js')
const { default: chatRoutes } = await import('../src/routes/chat.js')
const { default: agentRoutes } = await import('../src/routes/agent.js')
const { default: keywordRoutes } = await import('../src/routes/keywords.js')
const { default: analyticsRoutes } = await import('../src/routes/analytics.js')
const { setupAgentWebSocket, heartbeatTick, handleAgentCommand } = await import('../src/services/agentService.js')
const { migrate } = await import('../src/db/migrate.js')

const SID = '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f'
const agentToken = (claims = {}, opts = {}) => jwt.sign({ sub: '42', ...claims }, SECRET, {
  algorithm: 'HS256', issuer: 'mediko-gateway', audience: 'mediko-chat', expiresIn: 300, ...opts
})

// ── I1: trustProxy + rate-limit buckets ─────────────────────

test('parseTrustProxy: default loopback, booleans, hop count, lists', () => {
  assert.equal(parseTrustProxy(undefined), 'loopback')
  assert.equal(parseTrustProxy(''), 'loopback')
  assert.equal(parseTrustProxy('true'), true)
  assert.equal(parseTrustProxy('false'), false)
  assert.equal(parseTrustProxy('1'), 1)
  assert.equal(parseTrustProxy('loopback,172.16.0.0/12'), 'loopback,172.16.0.0/12')
  delete process.env.TRUST_PROXY
  assert.equal(serverOptions({ isProd: true }).trustProxy, 'loopback')
})

async function chatApp() {
  const app = Fastify({ trustProxy: parseTrustProxy('loopback') })
  await app.register(securityPlugins)
  await app.register(chatRoutes, { prefix: '/api/chat' })
  await app.ready()
  return app
}

test('behind a local proxy each customer IP gets its own global bucket', async () => {
  const app = await chatApp()
  try {
    const hit = (ip) => app.inject({ url: '/api/chat/resume?t=x', headers: { 'x-forwarded-for': ip } })
    for (let i = 0; i < 20; i++) assert.equal((await hit('203.0.113.1')).statusCode, 410)
    assert.equal((await hit('203.0.113.1')).statusCode, 429, 'first customer is limited')
    assert.equal((await hit('203.0.113.2')).statusCode, 410, 'second customer is not')
  } finally { await app.close() }
})

test('/typing has its own 60/min limit and does not drain the global bucket', async () => {
  const app = await chatApp()
  try {
    const headers = { 'x-forwarded-for': '198.51.100.7' }
    const typing = () => app.inject({ method: 'POST', url: '/api/chat/typing', headers, payload: { sessionId: SID } })
    for (let i = 0; i < 60; i++) assert.equal((await typing()).statusCode, 204, `typing #${i + 1}`)
    assert.equal((await typing()).statusCode, 429)
    const other = await app.inject({ url: '/api/chat/resume?t=x', headers })
    assert.equal(other.statusCode, 410, 'global bucket untouched by typing')
  } finally { await app.close() }
})

// ── I4: log redaction ───────────────────────────────────────

test('redactUrl masks UUIDs and strips link tokens; maskId keeps a short prefix', () => {
  assert.equal(redactUrl(`/api/chat/history/${SID}?limit=50`), '/api/chat/history/:id?limit=50')
  assert.equal(redactUrl(`/api/chat/listen/${SID.toUpperCase()}`), '/api/chat/listen/:id')
  assert.equal(redactUrl(`/api/chat/resume?t=${SID}.123.sig`), '/api/chat/resume')
  assert.equal(redactUrl(`/page?mdk_chat=${SID}.1.s&x=1`), '/page?x=1')
  assert.equal(redactUrl('/api/agent/ws?token=abc'), '/api/agent/ws')
  assert.equal(redactUrl('/health'), '/health')
  assert.equal(maskId(SID), '3f2a9c1e…')
  assert.equal(maskId(null), null)
})

test('Fastify request log carries no session id or token', async () => {
  const lines = []
  const stream = new Writable({ write(chunk, _e, cb) { lines.push(chunk.toString()); cb() } })
  const opts = serverOptions({ isProd: true })
  const app = Fastify({ ...opts, logger: { ...opts.logger, level: 'info', stream } })
  app.get('/api/chat/history/:sessionId', async () => ({ ok: true }))
  app.get('/api/chat/resume', async () => ({ ok: true }))
  await app.ready()
  try {
    await app.inject({ url: `/api/chat/history/${SID}?limit=5` })
    await app.inject({ url: `/api/chat/resume?t=${SID}.99.sig` })
    const out = lines.join('')
    assert.ok(out.includes('incoming request'), 'request logs are on')
    assert.ok(out.includes('/api/chat/history/:id?limit=5'))
    assert.ok(!out.includes(SID), out)
    assert.ok(!out.includes('99.sig'))
  } finally { await app.close() }
})

// ── requireAgent gate on every agent-only prefix ────────────

test('requireAgent: agent, keyword and analytics routes refuse missing or wrong tokens', async () => {
  const app = Fastify()
  await app.register(requireAgentPlugin)
  await app.register(agentRoutes, { prefix: '/api/agent' })
  await app.register(keywordRoutes, { prefix: '/api/keywords' })
  await app.register(analyticsRoutes, { prefix: '/api/analytics' })
  await app.ready()
  try {
    const routes = [
      ['GET', '/api/agent/conversations'],
      ['GET', `/api/agent/conversations/${SID}`],
      ['GET', '/api/agent/settings'],
      ['GET', '/api/keywords'],
      ['POST', '/api/keywords'],
      ['DELETE', '/api/keywords/abc'],
      ['GET', '/api/analytics/overview']
    ]
    const wrongAud = agentToken({}, { audience: 'mediko-admin' })
    for (const [method, url] of routes) {
      const none = await app.inject({ method, url })
      assert.equal(none.statusCode, 401, `${method} ${url} without token`)
      assert.deepEqual(none.json(), { error: 'Unauthorized' })
      const bad = await app.inject({ method, url, headers: { authorization: `Bearer ${wrongAud}` } })
      assert.equal(bad.statusCode, 401, `${method} ${url} wrong audience`)
    }
  } finally { await app.close() }
})

// ── Agent WebSocket: upgrade 401, ping/pong, heartbeat ──────

async function wsServer(opts) {
  const server = http.createServer((_q, r) => { r.statusCode = 404; r.end() })
  const ws = setupAgentWebSocket(server, opts)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()
  return {
    port,
    async close() { ws.close(); await new Promise((r) => server.close(r)) }
  }
}

function rawUpgrade(port, { path, origin }) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1')
    let data = ''
    sock.on('data', (d) => { data += d })
    sock.on('close', () => resolve(data))
    sock.on('error', reject)
    sock.write([
      `GET ${path} HTTP/1.1`, 'Host: localhost', 'Upgrade: websocket', 'Connection: Upgrade',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version: 13',
      ...(origin ? [`Origin: ${origin}`] : []), '', ''
    ].join('\r\n'))
  })
}

let srv
before(async () => { srv = await wsServer({ heartbeatMs: 40 }) })
after(async () => { await srv.close() })

test('upgrade listener writes 401 for a bad token, wrong origin or missing origin', async () => {
  const good = agentToken()
  const cases = [
    { path: '/api/agent/ws?token=garbage', origin: ORIGIN },
    { path: '/api/agent/ws', origin: ORIGIN },
    { path: `/api/agent/ws?token=${good}`, origin: 'https://evil.test' },
    { path: `/api/agent/ws?token=${good}` },
    { path: `/api/agent/ws?token=${agentToken({}, { expiresIn: -10 })}`, origin: ORIGIN }
  ]
  for (const c of cases) {
    const res = await rawUpgrade(srv.port, c)
    assert.match(res, /^HTTP\/1\.1 401 Unauthorized\r\n/, JSON.stringify(c))
  }
  assert.equal(await rawUpgrade(srv.port, { path: '/other', origin: ORIGIN }), '', 'other paths are dropped')
})

function openAgent(port, wsOpts = {}) {
  const sock = new WebSocket(`ws://127.0.0.1:${port}/api/agent/ws?token=${agentToken()}`, { origin: ORIGIN, ...wsOpts })
  const events = []
  const waiters = []
  sock.on('message', (d) => {
    const e = JSON.parse(d.toString())
    events.push(e)
    for (const w of [...waiters]) if (w.pred(e)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(e) }
  })
  const next = (pred) => {
    const seen = events.find(pred)
    if (seen) return Promise.resolve(seen)
    return new Promise((resolve) => waiters.push({ pred, resolve }))
  }
  return { sock, next }
}

test('valid agent connects; app-level ping gets pong; bad command echoes clientId', async () => {
  const { sock, next } = openAgent(srv.port)
  try {
    await next((e) => e.type === 'connected')
    sock.send(JSON.stringify({ type: 'ping' }))
    await next((e) => e.type === 'pong')
    sock.send(JSON.stringify({ type: 'nope', sessionId: SID, clientId: 'c-1' }))
    const err = await next((e) => e.type === 'error')
    assert.equal(err.clientId, 'c-1')
  } finally { sock.terminate() }
})

test('server terminates a socket that stops answering protocol pings', async () => {
  const { sock, next } = openAgent(srv.port, { autoPong: false })
  await next((e) => e.type === 'connected')
  const code = await new Promise((r) => sock.on('close', (c) => r(c)))
  assert.equal(code, 1006, 'terminated, not closed cleanly')
})

test('a socket that answers pings stays open across heartbeats', async () => {
  const { sock, next } = openAgent(srv.port)
  try {
    await next((e) => e.type === 'connected')
    await new Promise((r) => setTimeout(r, 200))
    assert.equal(sock.readyState, WebSocket.OPEN)
  } finally { sock.terminate() }
})

test('heartbeatTick pings live sockets and terminates ones that missed a pong', () => {
  const mk = (isAlive) => ({ isAlive, pinged: 0, killed: 0, ping() { this.pinged++ }, terminate() { this.killed++ } })
  const live = mk(true), dead = mk(false)
  heartbeatTick([live, dead])
  assert.deepEqual([live.pinged, live.killed, live.isAlive], [1, 0, false])
  assert.deepEqual([dead.pinged, dead.killed], [0, 1])
})

test('agent_sent echoes a short clientId and ignores a bad one', async () => {
  const sent = []
  const d = {
    getSession: async () => ({ id: 's1', channel: 'widget', status: 'open' }),
    saveAgentMessage: async (_id, text) => ({ id: 1, role: 'agent', content: text }),
    dispatchReply: async () => {}, onAgentMessage: async () => {},
    broadcast: (e) => sent.push(e), pushToWidget: () => {}
  }
  await handleAgentCommand({ type: 'agent_message', sessionId: 's1', text: 'hi', clientId: 'abc' }, d)
  await handleAgentCommand({ type: 'agent_message', sessionId: 's1', text: 'yo', clientId: 'x'.repeat(65) }, d)
  const echoes = sent.filter((e) => e.type === 'agent_sent')
  assert.equal(echoes[0].clientId, 'abc')
  assert.equal('clientId' in echoes[1], false)
})

// ── Legacy-session backfill ─────────────────────────────────

test('migrate closes legacy open sessions that have no last_customer_at, every run', async () => {
  const sql = []
  const d = { queryOne: async () => ({ n: 1 }), query: async (s) => { sql.push(s.replace(/\s+/g, ' ').trim()) } }
  await migrate(d)
  await migrate(d)
  const backfill = sql.filter((s) => s.startsWith("UPDATE chat_sessions SET status = 'closed'"))
  assert.equal(backfill.length, 2)
  assert.match(backfill[0], /WHERE last_customer_at IS NULL AND status = 'open'$/)
  assert.ok(!sql.some((s) => s.startsWith('ALTER')), 'existing columns are not re-added')
})
