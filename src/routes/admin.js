/**
 * admin.js
 *
 * REST endpoints for the admin dashboard.
 * Served at /api/admin/* — protect with ADMIN_SECRET in production.
 */

import { supabase } from '../db/supabase.js'

// Simple token auth — set ADMIN_SECRET in .env
const ADMIN_SECRET = process.env.ADMIN_SECRET

function requireAuth(request, reply, done) {
  if (!ADMIN_SECRET) return done()   // no secret set = open in dev
  const token = request.headers['x-admin-secret'] ?? request.query.secret
  if (token !== ADMIN_SECRET) {
    reply.status(401).send({ error: 'Unauthorized' })
    return
  }
  done()
}

export default async function adminRoutes(fastify) {

  // Apply auth to all admin routes
  fastify.addHook('onRequest', requireAuth)

  /**
   * GET /api/admin/sessions
   * List sessions with filters: mode, channel, recent.
   */
  fastify.get('/sessions', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          mode:    { type: 'string', enum: ['ai', 'agent', 'all'], default: 'all' },
          channel: { type: 'string', enum: ['widget', 'whatsapp', 'messenger', 'all'], default: 'all' },
          limit:   { type: 'integer', minimum: 1, maximum: 100, default: 30 },
          offset:  { type: 'integer', minimum: 0, default: 0 }
        }
      }
    }
  }, async (request, reply) => {
    const { mode, channel, limit, offset } = request.query

    let query = supabase
      .from('chat_sessions')
      .select(`
        id, mode, channel, channel_user_id, customer_email,
        assigned_agent, handoff_at, last_active, created_at,
        chat_messages ( count )
      `)
      .order('last_active', { ascending: false })
      .range(offset, offset + limit - 1)

    if (mode    !== 'all') query = query.eq('mode',    mode)
    if (channel !== 'all') query = query.eq('channel', channel)

    const { data, error, count } = await query
    if (error) return reply.status(500).send({ error: error.message })

    return reply.send({ sessions: data, total: count, limit, offset })
  })


  /**
   * GET /api/admin/sessions/:sessionId
   * Full session detail with all messages.
   */
  fastify.get('/sessions/:sessionId', async (request, reply) => {
    const { sessionId } = request.params

    const [sessionRes, messagesRes] = await Promise.all([
      supabase
        .from('chat_sessions')
        .select('*')
        .eq('id', sessionId)
        .single(),
      supabase
        .from('chat_messages')
        .select('id, role, content, created_at, tokens_used')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true })
    ])

    if (sessionRes.error) return reply.status(404).send({ error: 'Session not found' })

    return reply.send({
      session:  sessionRes.data,
      messages: messagesRes.data || []
    })
  })


  /**
   * GET /api/admin/stats
   * Summary statistics for the dashboard header.
   */
  fastify.get('/stats', async (request, reply) => {
    const now       = new Date()
    const today     = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
    const last7days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    const [total, waiting, active, todayCount, weekCount] = await Promise.all([
      supabase.from('chat_sessions').select('id', { count: 'exact', head: true }),
      supabase.from('chat_sessions').select('id', { count: 'exact', head: true }).eq('mode', 'agent').is('assigned_agent', null),
      supabase.from('chat_sessions').select('id', { count: 'exact', head: true }).eq('mode', 'agent'),
      supabase.from('chat_sessions').select('id', { count: 'exact', head: true }).gte('created_at', today),
      supabase.from('chat_sessions').select('id', { count: 'exact', head: true }).gte('created_at', last7days)
    ])

    return reply.send({
      total:          total.count   ?? 0,
      waitingForAgent: waiting.count ?? 0,
      activeAgentSessions: active.count ?? 0,
      todaySessions:  todayCount.count  ?? 0,
      last7DaysSessions: weekCount.count ?? 0
    })
  })


  /**
   * POST /api/admin/sessions/:sessionId/assign
   * Assign a session to a specific agent.
   * Body: { agent: "agent-name-or-email" }
   */
  fastify.post('/sessions/:sessionId/assign', {
    schema: {
      body: {
        type: 'object',
        required: ['agent'],
        properties: { agent: { type: 'string' } }
      }
    }
  }, async (request, reply) => {
    const { sessionId } = request.params
    const { agent }     = request.body

    const { error } = await supabase
      .from('chat_sessions')
      .update({ assigned_agent: agent })
      .eq('id', sessionId)

    if (error) return reply.status(500).send({ error: error.message })
    return reply.send({ success: true, sessionId, agent })
  })

}
