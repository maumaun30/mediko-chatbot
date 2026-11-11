import fp from 'fastify-plugin'
import { verifyAgentToken, bearerFrom } from '../services/agentAuth.js'

/** onRequest hook: 401 unless a valid gateway-issued agent JWT is presented. */
export function requireAgent(request, reply, done) {
  const agent = verifyAgentToken(bearerFrom(request.headers.authorization))
  if (!agent) {
    reply.status(401).send({ error: 'Unauthorized' })
    return
  }
  request.agent = { sub: agent.sub }
  done()
}

export default fp(async function requireAgentPlugin(fastify) {
  fastify.decorate('requireAgent', requireAgent)
})
