/**
 * admin.js
 *
 * REST endpoints for the admin dashboard.
 * Served at /api/admin/* — protect with ADMIN_SECRET in production.
 */

import { query, queryOne } from '../db/mysql.js'

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
    const { mode, channel } = request.query
    const limit  = Math.max(1, Math.min(parseInt(request.query.limit, 10)  || 30, 100))
    const offset = Math.max(0, parseInt(request.query.offset, 10) || 0)

    const where  = []
    const params = []
    if (mode    !== 'all') { where.push('mode = ?');    params.push(mode) }
    if (channel !== 'all') { where.push('channel = ?'); params.push(channel) }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    try {
      const sessions = await query(
        `SELECT id, mode, channel, channel_user_id, customer_email,
                assigned_agent, handoff_at, last_active, created_at
         FROM chat_sessions
         ${whereSql}
         ORDER BY last_active DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params
      )
      const totalRow = await queryOne(
        `SELECT COUNT(*) AS total FROM chat_sessions ${whereSql}`,
        params
      )
      return reply.send({ sessions, total: totalRow?.total ?? 0, limit, offset })
    } catch (err) {
      return reply.status(500).send({ error: err.message })
    }
  })


  /**
   * GET /api/admin/sessions/:sessionId
   * Full session detail with all messages.
   */
  fastify.get('/sessions/:sessionId', async (request, reply) => {
    const { sessionId } = request.params

    const [session, messages] = await Promise.all([
      queryOne('SELECT * FROM chat_sessions WHERE id = ?', [sessionId]),
      query(
        `SELECT id, role, content, created_at, tokens_used FROM chat_messages
         WHERE session_id = ? ORDER BY seq ASC`,
        [sessionId]
      )
    ])

    if (!session) return reply.status(404).send({ error: 'Session not found' })

    return reply.send({ session, messages: messages || [] })
  })


  /**
   * GET /api/admin/stats
   * Summary statistics for the dashboard header.
   */
  fastify.get('/stats', async (request, reply) => {
    const now       = new Date()
    const today     = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const last7days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const row = await queryOne(
      `SELECT
         COUNT(*)                                                        AS total,
         SUM(mode = 'agent' AND assigned_agent IS NULL)                  AS waiting,
         SUM(mode = 'agent')                                             AS active,
         SUM(created_at >= ?)                                            AS today,
         SUM(created_at >= ?)                                            AS week
       FROM chat_sessions`,
      [today, last7days]
    )

    return reply.send({
      total:               Number(row?.total)   || 0,
      waitingForAgent:     Number(row?.waiting)  || 0,
      activeAgentSessions: Number(row?.active)   || 0,
      todaySessions:       Number(row?.today)    || 0,
      last7DaysSessions:   Number(row?.week)     || 0
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

    try {
      await query('UPDATE chat_sessions SET assigned_agent = ? WHERE id = ?', [agent, sessionId])
    } catch (err) {
      return reply.status(500).send({ error: err.message })
    }
    return reply.send({ success: true, sessionId, agent })
  })

}
