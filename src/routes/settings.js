import { getBusinessHours, saveBusinessHours, getIdleMinutes, saveIdleMinutes } from '../services/settingsService.js'
const ADMIN_SECRET = process.env.ADMIN_SECRET
function requireAuth(req, reply, done) {
  if (!ADMIN_SECRET) return done()
  const t = req.headers['x-admin-secret'] ?? req.query.secret
  if (t !== ADMIN_SECRET) { reply.status(401).send({ error: 'Unauthorized' }); return }
  done()
}
export default async function settingsRoutes(fastify) {
  // GETs are public — no secrets exposed, widget needs business hours status
  fastify.get('/business-hours', async (req, reply) => reply.send({ businessHours: await getBusinessHours() }))
  fastify.get('/idle-minutes',   async (req, reply) => reply.send({ value: await getIdleMinutes() }))

  // PUTs require admin auth
  fastify.put('/business-hours', { onRequest: requireAuth }, async (req, reply) => { await saveBusinessHours(req.body); return reply.send({ success: true }) })
  fastify.put('/idle-minutes',   { onRequest: requireAuth }, async (req, reply) => { const mins=parseInt(req.body?.value)||30; await saveIdleMinutes(mins); return reply.send({ success: true, value: mins }) })
}
