import { query } from '../db/mysql.js'
const ADMIN_SECRET = process.env.ADMIN_SECRET
function requireAuth(req, reply, done) {
  if (!ADMIN_SECRET) return done()
  const t = req.headers['x-admin-secret'] ?? req.query.secret
  if (t !== ADMIN_SECRET) { reply.status(401).send({ error: 'Unauthorized' }); return }
  done()
}
export default async function analyticsRoutes(fastify) {
  fastify.addHook('onRequest', requireAuth)
  fastify.get('/overview', async (req, reply) => {
    const days  = Math.min(parseInt(req.query.days)||30, 90)
    const since = new Date(Date.now() - days*86400000)
    const [sessRows, msgRows, hoffRows] = await Promise.all([
      query('SELECT id, channel, created_at, handoff_at FROM chat_sessions WHERE created_at >= ?', [since]),
      query('SELECT tokens_used, created_at FROM chat_messages WHERE created_at >= ?', [since]),
      query('SELECT id FROM chat_sessions WHERE handoff_at IS NOT NULL AND created_at >= ?', [since])
    ])
    // Daily counts (created_at comes back as 'YYYY-MM-DD HH:MM:SS' strings)
    const dc = {}
    for (let i=0;i<days;i++) { const d=new Date(Date.now()-(days-1-i)*86400000); dc[d.toISOString().slice(0,10)]=0 }
    for (const s of sessRows) { const d=s.created_at?.slice(0,10); if(d&&dc[d]!==undefined)dc[d]++ }
    const dailySessions = Object.entries(dc).map(([date,count])=>({date,count}))
    // Channel
    const byChannel = {}
    for (const s of sessRows) { const c=s.channel||'widget'; byChannel[c]=(byChannel[c]||0)+1 }
    // Tokens
    const tokens = msgRows.reduce((s,m)=>s+(m.tokens_used||0),0)
    const total  = sessRows.length
    const hTotal = hoffRows.length
    return reply.send({
      totals: { sessions:total, messages:msgRows.length, handoffs:hTotal, tokens, handoffRate:total?Math.round(hTotal/total*100):0, avgMsgs:total?Math.round(msgRows.length/total):0 },
      dailySessions, byChannel, ratings:{up:0,down:0}
    })
  })
}
