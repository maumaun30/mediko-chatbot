import { supabase } from '../db/supabase.js'

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
  const { data, error } = await supabase
    .from('chat_sessions')
    .insert({
      channel,
      channel_user_id: channelUserId ?? null,
      customer_email:  customerEmail ?? null,
      metadata:        metadata ?? null,
      mode:            'ai'
    })
    .select('id')
    .single()

  if (error) throw new Error(`createSession: ${error.message}`)
  return data.id
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
  // Look for an existing open session for this user on this channel
  const { data: existing } = await supabase
    .from('chat_sessions')
    .select('id')
    .eq('channel', channel)
    .eq('channel_user_id', channelUserId)
    .order('last_active', { ascending: false })
    .limit(1)
    .single()

  if (existing?.id) return existing.id

  // None found — create a fresh session
  return createSession({ channel, channelUserId })
}

// ── Session reads ────────────────────────────────────────────

export async function sessionExists(sessionId) {
  const { data } = await supabase
    .from('chat_sessions')
    .select('id')
    .eq('id', sessionId)
    .single()
  return !!data
}

/**
 * Get the current mode ('ai' | 'agent') for a session.
 * @param {string} sessionId
 * @returns {Promise<'ai'|'agent'>}
 */
export async function getSessionMode(sessionId) {
  const { data, error } = await supabase
    .from('chat_sessions')
    .select('mode')
    .eq('id', sessionId)
    .single()

  if (error) throw new Error(`getSessionMode: ${error.message}`)
  return data.mode
}

// ── Session writes ───────────────────────────────────────────

export async function touchSession(sessionId) {
  await supabase
    .from('chat_sessions')
    .update({ last_active: new Date().toISOString() })
    .eq('id', sessionId)
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
  const updates = { mode }
  if (handoffAt)   updates.handoff_at      = handoffAt
  if (clearAgent)  updates.assigned_agent  = null

  const { data, error } = await supabase
    .from('chat_sessions')
    .update(updates)
    .eq('id', sessionId)
    .select('id, channel, channel_user_id, mode')
    .single()

  if (error) throw new Error(`setSessionMode: ${error.message}`)
  return data
}

// ── Message history ──────────────────────────────────────────

export async function loadHistory(sessionId) {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('role, content, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT * 2)

  if (error) throw new Error(`loadHistory: ${error.message}`)
  return (data || []).reverse().map(({ role, content }) => ({ role, content }))
}

/**
 * Save a user + assistant message pair after an AI response.
 * Pass null for assistantMessage when the user message is forwarded to an agent.
 */
export async function saveMessagePair(sessionId, userMessage, assistantMessage, tokensUsed) {
  const rows = [{
    session_id: sessionId,
    role:       'user',
    content:    userMessage,
    created_at: new Date().toISOString()
  }]

  if (assistantMessage !== null && assistantMessage !== undefined) {
    rows.push({
      session_id:  sessionId,
      role:        'assistant',
      content:     assistantMessage,
      created_at:  new Date(Date.now() + 1).toISOString(),
      tokens_used: tokensUsed ?? null
    })
  }

  const { error } = await supabase.from('chat_messages').insert(rows)
  if (error) throw new Error(`saveMessagePair: ${error.message}`)
}

/**
 * Save a message sent by a human agent.
 * Stored with role 'assistant' so it appears in the conversation history
 * that the AI sees when control is returned.
 */
export async function saveAgentMessage(sessionId, text) {
  const { error } = await supabase
    .from('chat_messages')
    .insert({
      session_id: sessionId,
      role:       'assistant',
      content:    `[Agent] ${text}`,
      created_at: new Date().toISOString()
    })

  if (error) throw new Error(`saveAgentMessage: ${error.message}`)
}

export async function getFullHistory(sessionId, limit = 50) {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, role, content, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) throw new Error(`getFullHistory: ${error.message}`)
  return data || []
}
