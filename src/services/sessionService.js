import { randomUUID } from 'crypto'
import { query, queryOne } from '../db/mysql.js'

const HISTORY_LIMIT = 10

// ── Session creation ─────────────────────────────────────────

/**
 * Create a new session for any channel.
 * @param {object} opts
 * @param {string} opts.channel          — 'widget' | 'whatsapp' | 'messenger'
 * @param {string} [opts.channelUserId]  — channel-specific user identifier
 * @param {string} [opts.customerEmail]
 * @param {object} [opts.metadata]
 * @returns {Promise<string>} sessionId
 */
export async function createSession({ channel = 'widget', channelUserId, customerEmail, metadata } = {}) {
  const id = randomUUID()
  try {
    await query(
      `INSERT INTO chat_sessions (id, channel, channel_user_id, customer_email, metadata, mode)
       VALUES (?, ?, ?, ?, ?, 'ai')`,
      [id, channel, channelUserId ?? null, customerEmail ?? null, metadata ? JSON.stringify(metadata) : null]
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
  return rows.reverse().map(({ role, content }) => ({ role, content }))
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

/**
 * Save a message sent by a human agent.
 * Stored with role 'assistant' so it appears in the conversation history
 * that the AI sees when control is returned.
 */
export async function saveAgentMessage(sessionId, text) {
  await query(
    `INSERT INTO chat_messages (id, session_id, role, content)
     VALUES (?, ?, 'assistant', ?)`,
    [randomUUID(), sessionId, `[Agent] ${text}`]
  )
}

export async function getFullHistory(sessionId, limit = 50) {
  const lim = Math.max(1, Math.min(parseInt(limit, 10) || 50, 100))
  return query(
    `SELECT id, role, content, created_at FROM chat_messages
     WHERE session_id = ?
     ORDER BY seq ASC LIMIT ${lim}`,
    [sessionId]
  )
}
