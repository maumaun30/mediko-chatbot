import { randomUUID } from 'crypto'
import { query, queryOne } from '../db/mysql.js'
import { aiEnabled } from './settingsService.js'

const HISTORY_LIMIT = 10

// ── Helpers ──────────────────────────────────────────────────

const AGENT_PREFIX = '[Agent] '

/** Remove the legacy "[Agent] " prefix from message content. */
export function stripAgentPrefix(content) {
  return typeof content === 'string' && content.startsWith(AGENT_PREFIX)
    ? content.slice(AGENT_PREFIX.length)
    : content
}

// DB timestamps come back as 'YYYY-MM-DD HH:MM:SS(.sss)' UTC strings (dateStrings + timezone Z).
export function parseDbTime(v) {
  if (v == null) return null
  if (v instanceof Date) return v.getTime()
  const t = Date.parse(String(v).replace(' ', 'T') + 'Z')
  return Number.isNaN(t) ? null : t
}

/** True when the customer wrote last and no agent has replied since (open sessions only). */
export function isUnanswered({ status, last_customer_at, last_agent_at } = {}) {
  if (status !== 'open') return false
  const c = parseDbTime(last_customer_at)
  if (c === null) return false
  const a = parseDbTime(last_agent_at)
  return a === null || a < c
}

function dbTimeString(d) {
  return d.toISOString().replace('T', ' ').replace('Z', '')
}

// ── Session creation ─────────────────────────────────────────

/**
 * Create a new session for any channel.
 * @param {object} opts
 * @param {string} opts.channel          — 'widget' | 'whatsapp' | 'messenger'
 * @param {string} [opts.channelUserId]  — channel-specific user identifier
 * @param {string} [opts.customerName]
 * @param {string} [opts.customerEmail]
 * @param {string} [opts.customerPhone]
 * @param {object} [opts.metadata]
 * @param {'ai'|'agent'} [opts.mode]     — defaults to 'ai' when AI is enabled, else 'agent'
 * @returns {Promise<string>} sessionId
 */
export async function createSession({
  channel = 'widget', channelUserId, customerName, customerEmail, customerPhone, metadata, mode
} = {}) {
  const id = randomUUID()
  const sessionMode = mode ?? (aiEnabled() ? 'ai' : 'agent')
  try {
    await query(
      `INSERT INTO chat_sessions
         (id, channel, channel_user_id, customer_name, customer_email, customer_phone, metadata, mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, channel, channelUserId ?? null, customerName ?? null, customerEmail ?? null,
        customerPhone ?? null, metadata ? JSON.stringify(metadata) : null, sessionMode
      ]
    )
  } catch (err) {
    throw new Error(`createSession: ${err.message}`)
  }
  return id
}

/**
 * Find an existing session for a channel user, or create a new one.
 * Used by WhatsApp and Messenger adapters on every inbound message.
 *
 * @param {object} opts
 * @param {string} opts.channel
 * @param {string} opts.channelUserId
 * @returns {Promise<string>} sessionId
 */
export async function findOrCreateSessionByChannelUser({ channel, channelUserId }) {
  const existing = await queryOne(
    `SELECT id FROM chat_sessions
     WHERE channel = ? AND channel_user_id = ?
     ORDER BY last_active DESC LIMIT 1`,
    [channel, channelUserId]
  )
  if (existing?.id) return existing.id

  // None found — create a fresh session
  return createSession({ channel, channelUserId })
}

// ── Session reads ────────────────────────────────────────────

export async function sessionExists(sessionId) {
  const row = await queryOne('SELECT id FROM chat_sessions WHERE id = ?', [sessionId])
  return !!row
}

// Latest message content per session, for the inbox preview.
const LAST_MESSAGE_SQL =
  `(SELECT m.content FROM chat_messages m WHERE m.session_id = chat_sessions.id ORDER BY m.seq DESC LIMIT 1) AS last_message`

export async function getSession(sessionId) {
  return queryOne(`SELECT chat_sessions.*, ${LAST_MESSAGE_SQL} FROM chat_sessions WHERE id = ?`, [sessionId])
}

/**
 * Get the current mode ('ai' | 'agent') for a session.
 * @param {string} sessionId
 * @returns {Promise<'ai'|'agent'>}
 */
export async function getSessionMode(sessionId) {
  const row = await queryOne('SELECT mode FROM chat_sessions WHERE id = ?', [sessionId])
  if (!row) throw new Error('getSessionMode: session not found')
  return row.mode
}

// ── Session writes ───────────────────────────────────────────

export async function touchSession(sessionId) {
  await query('UPDATE chat_sessions SET last_active = ? WHERE id = ?', [new Date(), sessionId])
}

/**
 * Set the mode of a session and optionally record handoff metadata.
 * Returns the updated session row (channel + channel_user_id needed by dispatcher).
 *
 * @param {string} sessionId
 * @param {'ai'|'agent'} mode
 * @param {object} [opts]
 * @param {string} [opts.handoffAt]   — ISO timestamp of handoff request
 * @param {boolean} [opts.clearAgent] — true when returning to AI (clears assigned_agent)
 * @returns {Promise<object>} updated session row
 */
export async function setSessionMode(sessionId, mode, { handoffAt, clearAgent } = {}) {
  const sets   = ['mode = ?']
  const params = [mode]
  if (handoffAt)  { sets.push('handoff_at = ?');     params.push(new Date(handoffAt)) }
  if (clearAgent) { sets.push('assigned_agent = NULL') }
  params.push(sessionId)

  await query(`UPDATE chat_sessions SET ${sets.join(', ')} WHERE id = ?`, params)

  const row = await queryOne(
    'SELECT id, channel, channel_user_id, mode FROM chat_sessions WHERE id = ?',
    [sessionId]
  )
  if (!row) throw new Error('setSessionMode: session not found')
  return row
}

// ── Message history ──────────────────────────────────────────

export async function loadHistory(sessionId) {
  const rows = await query(
    `SELECT role, content FROM chat_messages
     WHERE session_id = ?
     ORDER BY seq DESC LIMIT ${HISTORY_LIMIT * 2}`,
    [sessionId]
  )
  return rows.reverse().map(({ role, content }) => ({ role: role === 'agent' ? 'assistant' : role, content }))
}

/**
 * Save a user + assistant message pair after an AI response.
 * Pass null for assistantMessage when the user message is forwarded to an agent.
 */
export async function saveMessagePair(sessionId, userMessage, assistantMessage, tokensUsed) {
  // Inserted in order; the AUTO_INCREMENT seq column preserves user → assistant ordering.
  await query(
    `INSERT INTO chat_messages (id, session_id, role, content) VALUES (?, ?, 'user', ?)`,
    [randomUUID(), sessionId, userMessage]
  )

  if (assistantMessage !== null && assistantMessage !== undefined) {
    await query(
      `INSERT INTO chat_messages (id, session_id, role, content, tokens_used)
       VALUES (?, ?, 'assistant', ?, ?)`,
      [randomUUID(), sessionId, assistantMessage, tokensUsed ?? null]
    )
  }
}

async function insertMessage(sessionId, role, content, at) {
  const id = randomUUID()
  await query(
    `INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)`,
    [id, sessionId, role, content, at]
  )
  return { id, role, content, created_at: dbTimeString(at) }
}

/**
 * Save a customer message and update session activity (reopens the session).
 * @returns {Promise<{ message: object, isFirst: boolean }>}
 */
export async function recordCustomerMessage(sessionId, text) {
  const prior = await queryOne(
    `SELECT COUNT(*) AS n FROM chat_messages WHERE session_id = ? AND role = 'user'`,
    [sessionId]
  )
  const now = new Date()
  const message = await insertMessage(sessionId, 'user', text, now)
  await query(
    `UPDATE chat_sessions SET last_customer_at = ?, last_active = ?, status = 'open' WHERE id = ?`,
    [now, now, sessionId]
  )
  return { message, isFirst: Number(prior.n) === 0 }
}

/**
 * Save a message sent by a human agent (role 'agent', no prefix).
 * @returns {Promise<object>} message
 */
export async function saveAgentMessage(sessionId, text) {
  const now = new Date()
  const message = await insertMessage(sessionId, 'agent', text, now)
  await query(
    `UPDATE chat_sessions SET last_agent_at = ?, last_active = ? WHERE id = ?`,
    [now, now, sessionId]
  )
  return message
}

/** @param {'open'|'closed'} status */
export async function setStatus(sessionId, status) {
  if (status !== 'open' && status !== 'closed') throw new Error('setStatus: invalid status')
  await query('UPDATE chat_sessions SET status = ? WHERE id = ?', [status, sessionId])
}

const UNANSWERED_SQL =
  `status = 'open' AND last_customer_at IS NOT NULL AND (last_agent_at IS NULL OR last_agent_at < last_customer_at)`

/**
 * List conversations for the agent inbox, newest activity first.
 * @param {object} opts
 * @param {'open'|'unanswered'|'closed'} opts.status
 * @param {string} [opts.q]       — substring match on name, email, phone
 * @param {number} [opts.limit=50]
 * @param {string|Date} [opts.before] — last_active cursor
 */
export async function listConversations({ status = 'open', q, limit = 50, before } = {}) {
  const where = []
  const params = []
  if (status === 'unanswered') where.push(UNANSWERED_SQL)
  else if (status === 'open' || status === 'closed') { where.push('status = ?'); params.push(status) }
  else throw new Error('listConversations: invalid status')
  if (q) {
    const like = `%${String(q).replace(/[\\%_]/g, '\\$&')}%`
    where.push('(customer_name LIKE ? OR customer_email LIKE ? OR customer_phone LIKE ?)')
    params.push(like, like, like)
  }
  if (before) { where.push('last_active < ?'); params.push(before instanceof Date ? before : new Date(before)) }
  const lim = Math.max(1, Math.min(parseInt(limit, 10) || 50, 200))
  return query(
    `SELECT chat_sessions.*, ${LAST_MESSAGE_SQL} FROM chat_sessions WHERE ${where.join(' AND ')} ORDER BY last_active DESC LIMIT ${lim}`,
    params
  )
}

/** Open sessions that have had a customer message (alert job filters with isUnanswered). */
export async function findAlertCandidates() {
  return query(`SELECT * FROM chat_sessions WHERE status = 'open' AND last_customer_at IS NOT NULL`)
}

export async function markAlerted(id, at) {
  await query('UPDATE chat_sessions SET alerted_at = ? WHERE id = ?', [at, id])
}

/** Agent replies written after the later of the customer's last message and the last email. */
export async function agentMessagesToEmail(sessionId) {
  const rows = await query(
    `SELECT m.content FROM chat_messages m
     JOIN chat_sessions s ON s.id = m.session_id
     WHERE m.session_id = ? AND m.role = 'agent'
       AND m.created_at > GREATEST(COALESCE(s.last_customer_at, '1970-01-01 00:00:00'), COALESCE(s.customer_emailed_at, '1970-01-01 00:00:00'))
     ORDER BY m.seq ASC`,
    [sessionId]
  )
  return rows.map(r => r.content)
}

export async function markEmailed(id, at) {
  await query('UPDATE chat_sessions SET customer_emailed_at = ? WHERE id = ?', [at, id])
}

/** Latest `limit` messages (1..100, default 50) of a session, oldest first. */
export async function getFullHistory(sessionId, limit = 50, { run = query } = {}) {
  const lim = Math.max(1, Math.min(parseInt(limit, 10) || 50, 100))
  return run(
    `SELECT id, role, content, created_at FROM (
       SELECT id, role, content, created_at, seq FROM chat_messages
       WHERE session_id = ?
       ORDER BY seq DESC LIMIT ${lim}
     ) AS latest
     ORDER BY latest.seq ASC`,
    [sessionId]
  )
}
