import { redactUrl } from './services/redact.js'

/**
 * TRUST_PROXY env -> Fastify `trustProxy`. Default 'loopback' (CloudPanel
 * nginx on the same host). 'true'/'false', a hop count, or a comma list of
 * IPs / CIDRs / proxy-addr presets ('loopback', 'uniquelocal', ...).
 */
export function parseTrustProxy(raw = process.env.TRUST_PROXY) {
  const v = String(raw ?? '').trim()
  if (!v) return 'loopback'
  if (v === 'true') return true
  if (v === 'false') return false
  if (/^\d+$/.test(v)) return Number(v)
  return v
}

/** Request log serializer: no session ids or link tokens in logged URLs. */
export function serializeRequest(request) {
  return {
    method:        request.method,
    url:           redactUrl(request.url),
    hostname:      request.hostname,
    remoteAddress: request.ip,
    remotePort:    request.socket?.remotePort
  }
}

export function serverOptions({ isProd = process.env.NODE_ENV === 'production' } = {}) {
  return {
    trustProxy: parseTrustProxy(),
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      serializers: { req: serializeRequest },
      ...(!isProd && {
        transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
      })
    }
  }
}
