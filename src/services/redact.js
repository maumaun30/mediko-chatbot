/**
 * redact.js - keep chat credentials out of logs.
 *
 * A widget session id is enough to read and post to a conversation, and the
 * `t` / `mdk_chat` link token embeds it, so neither may appear in full in a
 * log line. maskId keeps an 8-char prefix for correlating log lines.
 */

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const SECRET_PARAMS = ['t', 'mdk_chat', 'token']

/** 'abcd1234-....' -> 'abcd1234…'; anything falsy -> the value itself. */
export function maskId(id) {
  if (!id) return id
  const s = String(id)
  return s.length <= 8 ? '…' : `${s.slice(0, 8)}…`
}

/** Mask UUIDs in the path and drop the token query params. */
export function redactUrl(url) {
  if (typeof url !== 'string' || !url) return url
  const q = url.indexOf('?')
  const path = (q === -1 ? url : url.slice(0, q)).replace(UUID_RE, ':id')
  if (q === -1) return path
  const params = new URLSearchParams(url.slice(q + 1))
  for (const p of SECRET_PARAMS) params.delete(p)
  const rest = params.toString()
  return rest ? `${path}?${rest}` : path
}
