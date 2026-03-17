import { supabase } from '../db/supabase.js'

const HISTORY_LIMIT = 10 // message pairs to load as context

// ── Sessions ────────────────────────────────────────────────

/**
 * Create a new chat session. Called when the widget loads for the first time.
 * @param {object} opts
 * @param {string} [opts.customerEmail]
 * @param {object} [opts.metadata]   e.g. { url, userAgent }
 * @returns {Promise<string>} sessionId (UUID)
 */
export async function createSession({ customerEmail, metadata } = {}) {
  const { data, error } = await supabase
    .from('chat_sessions')
    .insert({ customer_email: customerEmail, metadata })
    .select('id')
    .single()

  if (error) throw new Error(`createSession: ${error.message}`)
  return data.id
}

/**
 * Touch last_active timestamp on a session.
 * @param {string} sessionId
 */
export async function touchSession(sessionId) {
  await supabase
    .from('chat_sessions')
    .update({ last_active: new Date().toISOString() })
    .eq('id', sessionId)
  // non-critical — ignore errors
}

/**
 * Verify a session exists. Returns true/false.
 * @param {string} sessionId
 */
export async function sessionExists(sessionId) {
  const { data } = await supabase
    .from('chat_sessions')
    .select('id')
    .eq('id', sessionId)
    .single()
  return !!data
}

// ── Message History ─────────────────────────────────────────

/**
 * Load the last N message pairs for a session.
 * Returns messages in chronological order (oldest first) ready for OpenAI.
 * @param {string} sessionId
 * @returns {Promise<Array<{role: string, content: string}>>}
 */
export async function loadHistory(sessionId) {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('role, content, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT * 2) // *2 because each pair = user + assistant

  if (error) throw new Error(`loadHistory: ${error.message}`)

  // Reverse so oldest-first for OpenAI context
  return (data || []).reverse().map(({ role, content }) => ({ role, content }))
}

/**
 * Persist a user + assistant message pair after a successful chat turn.
 * @param {string} sessionId
 * @param {string} userMessage
 * @param {string} assistantMessage
 * @param {number} [tokensUsed]
 */
export async function saveMessagePair(sessionId, userMessage, assistantMessage, tokensUsed) {
  const now = new Date()
  const userTime = now.toISOString()
  const assistantTime = new Date(now.getTime() + 1).toISOString() // 1ms later to preserve order

  const { error } = await supabase
    .from('chat_messages')
    .insert([
      {
        session_id: sessionId,
        role: 'user',
        content: userMessage,
        created_at: userTime
      },
      {
        session_id: sessionId,
        role: 'assistant',
        content: assistantMessage,
        created_at: assistantTime,
        tokens_used: tokensUsed ?? null
      }
    ])

  if (error) throw new Error(`saveMessagePair: ${error.message}`)
}

/**
 * Return full message history for the widget's history endpoint.
 * @param {string} sessionId
 * @param {number} [limit=50]
 */
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
