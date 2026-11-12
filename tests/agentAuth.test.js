import { test } from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import { verifyAgentToken, bearerFrom, signChatLink, verifyChatLink, signEvent } from '../src/services/agentAuth.js'

const S = 'x'.repeat(32)
test('verifyAgentToken accepts gateway token', () => {
  const t = jwt.sign({ sub: '42' }, S, { algorithm: 'HS256', issuer: 'mediko-gateway', audience: 'mediko-chat', expiresIn: 300 })
  assert.deepEqual(verifyAgentToken(t, S), { sub: '42' })
})
test('verifyAgentToken rejects wrong aud, expired, short secret', () => {
  const bad = jwt.sign({ sub: '1' }, S, { issuer: 'mediko-gateway', audience: 'mediko-admin' })
  assert.equal(verifyAgentToken(bad, S), null)
  const old = jwt.sign({ sub: '1', exp: Math.floor(Date.now()/1000) - 10 }, S, { issuer: 'mediko-gateway', audience: 'mediko-chat' })
  assert.equal(verifyAgentToken(old, S), null)
  assert.equal(verifyAgentToken('anything', 'short'), null)
})
test('chat link round-trips and expires after 14 days', () => {
  const id = '3f1c2a4e-0000-4000-8000-000000000000', now = Date.UTC(2026, 10, 11)
  const t = signChatLink(id, { secret: S, now })
  assert.equal(verifyChatLink(t, { secret: S, now: now + 13 * 864e5 }), id)
  assert.equal(verifyChatLink(t, { secret: S, now: now + 15 * 864e5 }), null)
  assert.equal(verifyChatLink(t.replace(/.$/, c => c === 'A' ? 'B' : 'A'), { secret: S, now }), null)
})
test('signEvent is hex HMAC of ts.body', () => {
  const expect = crypto.createHmac('sha256', S).update('123.{"a":1}').digest('hex')
  assert.equal(signEvent('{"a":1}', '123', S), expect)
})
test('bearerFrom extracts token', () => {
  assert.equal(bearerFrom('Bearer abc'), 'abc')
  assert.equal(bearerFrom('bearer abc'), 'abc')
  assert.equal(bearerFrom('Basic abc'), null)
  assert.equal(bearerFrom(undefined), null)
})
test('verifyAgentToken rejects tokens without exp', () => {
  const t = jwt.sign({ sub: '1' }, S, { algorithm: 'HS256', issuer: 'mediko-gateway', audience: 'mediko-chat' })
  assert.equal(verifyAgentToken(t, S), null)
})
