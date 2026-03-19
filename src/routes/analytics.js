import { supabase } from '../db/supabase.js'
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
    const since = new Date(Date.now() - days*86400000).toISOString()
    const [sess, msgs, hoffs] = await Promise.all([
      supabase.from('chat_sessions').select('id,channel,created_at,handoff_at').gte('created_at',since),
      supabase.from('chat_messages').select('tokens_used,created_at').gte('created_at',since),
      supabase.from('chat_sessions').select('id').not('handoff_at','is',null).gte('created_at',since)
    ])
    // Daily counts
    const dc = {}
    for (let i=0;i<days;i++) { const d=new Date(Date.now()-(days-1-i)*86400000); dc[d.toISOString().slice(0,10)]=0 }
    for (const s of sess.data||[]) { const d=s.created_at?.slice(0,10); if(d&&dc[d]!==undefined)dc[d]++ }
    const dailySessions = Object.entries(dc).map(([date,count])=>({date,count}))
    // Channel
    const byChannel = {}
    for (const s of sess.data||[]) { const c=s.channel||'widget'; byChannel[c]=(byChannel[c]||0)+1 }
    // Tokens
    const tokens = (msgs.data||[]).reduce((s,m)=>s+(m.tokens_used||0),0)
    const total  = sess.data?.length||0
    const hTotal = hoffs.data?.length||0
    return reply.send({
      totals: { sessions:total, messages:msgs.data?.length||0, handoffs:hTotal, tokens, handoffRate:total?Math.round(hTotal/total*100):0, avgMsgs:total?Math.round((msgs.data?.length||0)/total):0 },
      dailySessions, byChannel, ratings:{up:0,down:0}
    })
  })
}
