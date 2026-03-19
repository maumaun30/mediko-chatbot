import { getBusinessHours, saveBusinessHours, getIdleMinutes, saveIdleMinutes } from '../services/settingsService.js'
const ADMIN_SECRET = process.env.ADMIN_SECRET
function requireAuth(req, reply, done) {
  if (!ADMIN_SECRET) return done()
  const t = req.headers['x-admin-secret'] ?? req.query.secret
  if (t !== ADMIN_SECRET) { reply.status(401).send({ error: 'Unauthorized' }); return }
  done()
}
export default async function settingsRoutes(fastify) {
  fastify.addHook('onRequest', requireAuth)
  fastify.get('/business-hours', async (req, reply) => reply.send({ businessHours: await getBusinessHours() }))
  fastify.put('/business-hours', async (req, reply) => { await saveBusinessHours(req.body); return reply.send({ success: true }) })
  fastify.get('/idle-minutes',   async (req, reply) => reply.send({ value: await getIdleMinutes() }))
  fastify.put('/idle-minutes',   async (req, reply) => { const mins=parseInt(req.body?.value)||30; await saveIdleMinutes(mins); return reply.send({ success: true, value: mins }) })
}
