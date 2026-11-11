/**
 * agent.js - REST API for the Shopify-embedded agent inbox.
 * Registered at /api/agent. Every route requires a gateway-issued agent JWT.
 * `sessions` / `settings` / `isOnline` are injectable for tests.
 */
import * as realSessions from '../services/sessionService.js'
import * as realSettings from '../services/settingsService.js'
import * as agentService from '../services/agentService.js'

const { isUnanswered, stripAgentPrefix } = realSessions

// Until the presence tracker lands in agentService (Task 5), nobody is "online".
const defaultIsOnline = (id) => (typeof agentService.isOnline === 'function' ? !!agentService.isOnline(id) : false)

export function toConversation(row, online) {
  return {
    id: row.id,
    displayName: row.customer_name || 'Unknown visitor',
    email: row.customer_email ?? null,
    phone: row.customer_phone ?? null,
    status: row.status,
    unanswered: isUnanswered(row),
    online: !!online,
    lastMessage: row.last_message ?? null,
    lastActive: row.last_active ?? null
  }
}

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const HHMM = '^([01]\\d|2[0-3]):[0-5]\\d$'
const dayShape = {
  type: 'object', required: ['open', 'start', 'end'], additionalProperties: false,
  properties: { open: { type: 'boolean' }, start: { type: 'string', pattern: HHMM }, end: { type: 'string', pattern: HHMM } }
}
const settingsSchema = {
  body: {
    type: 'object', additionalProperties: false,
    properties: {
      unansweredMinutes: { type: 'integer', minimum: 1, maximum: 240 },
      businessHours: {
        type: 'object', additionalProperties: false,
        properties: {
          enabled: { type: 'boolean' },
          timezone: { type: 'string', minLength: 1, maxLength: 64 },
          awayMessage: { type: 'string', maxLength: 1000 },
          hours: { type: 'object', additionalProperties: false, properties: Object.fromEntries(DAYS.map(d => [d, dayShape])) }
        }
      }
    }
  }
}

export default async function agentRoutes(fastify, opts = {}) {
  const sessions = opts.sessions || realSessions
  const settings = opts.settings || realSettings
  const isOnline = opts.isOnline || defaultIsOnline

  fastify.addHook('onRequest', fastify.requireAgent)

  fastify.get('/conversations', {
    schema: { querystring: { type: 'object', properties: {
      status: { type: 'string', enum: ['open', 'unanswered', 'closed'] },
      q: { type: 'string', maxLength: 100 },
      limit: { type: 'integer', minimum: 1, maximum: 200 },
      before: { type: 'string', maxLength: 40 }
    } } }
  }, async (request) => {
    const rows = await sessions.listConversations(request.query)
    return { conversations: rows.map(r => toConversation(r, isOnline(r.id))) }
  })

  fastify.get('/conversations/:id', async (request, reply) => {
    const row = await sessions.getSession(request.params.id)
    if (!row) return reply.status(404).send({ error: 'Conversation not found' })
    const history = await sessions.getFullHistory(row.id)
    const messages = history.map(m =>
      (m.role === 'agent' || m.role === 'assistant') ? { ...m, content: stripAgentPrefix(m.content) } : m)
    return { conversation: toConversation(row, isOnline(row.id)), messages }
  })

  async function currentSettings() {
    return {
      businessHours: await settings.getBusinessHours(),
      unansweredMinutes: await settings.getUnansweredMinutes()
    }
  }

  fastify.get('/settings', async () => currentSettings())

  fastify.put('/settings', { schema: settingsSchema }, async (request) => {
    const { businessHours, unansweredMinutes } = request.body || {}
    if (businessHours !== undefined) {
      const cur = (await settings.getBusinessHours()) || {}
      await settings.saveBusinessHours({ ...cur, ...businessHours, hours: { ...cur.hours, ...businessHours.hours } })
    }
    if (unansweredMinutes !== undefined) await settings.saveUnansweredMinutes(unansweredMinutes)
    return currentSettings()
  })
}
