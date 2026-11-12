import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'

const ISSUER = 'mediko-gateway'
const AUDIENCE = 'mediko-chat'
const DAY_MS = 864e5

function usable(secret) {
  return typeof secret === 'string' && secret.length >= 32 ? secret : null
}

function hmac(secret, data, enc) {
  return crypto.createHmac('sha256', secret).update(data).digest(enc)
}

export function verifyAgentToken(token, secret = process.env.CHAT_AGENT_SECRET) {
  const key = usable(secret)
  if (!key || typeof token !== 'string' || !token) return null
  try {
    const p = jwt.verify(token, key, { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE })
    // jsonwebtoken has no required-claims option: require exp and sub here.
    if (!p || typeof p.exp !== 'number' || p.sub == null || p.sub === '') return null
    return { sub: String(p.sub) }
  } catch {
    return null
  }
}

export function bearerFrom(header) {
  if (typeof header !== 'string') return null
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim())
  return m ? m[1] : null
}

export function signChatLink(sessionId, { secret = process.env.CHAT_AGENT_SECRET, now = Date.now(), ttlDays = 14 } = {}) {
  const key = usable(secret)
  if (!key) throw new Error('CHAT_AGENT_SECRET missing or too short')
  const exp = Math.floor((now + ttlDays * DAY_MS) / 1000)
  const body = `${sessionId}.${exp}`
  return `${body}.${hmac(key, body, 'base64url')}`
}

export function verifyChatLink(token, { secret = process.env.CHAT_AGENT_SECRET, now = Date.now() } = {}) {
  const key = usable(secret)
  if (!key || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [sessionId, expStr, sig] = parts
  if (!sessionId || !/^\d+$/.test(expStr)) return null
  const expected = Buffer.from(hmac(key, `${sessionId}.${expStr}`, 'base64url'))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null
  if (Number(expStr) * 1000 < now) return null
  return sessionId
}

export function signEvent(rawBody, timestamp, secret = process.env.CHAT_AGENT_SECRET) {
  return hmac(secret, `${timestamp}.${rawBody}`, 'hex')
}
