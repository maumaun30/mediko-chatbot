/**
 * keywords.js
 *
 * CRUD REST API for chat keywords.
 * Protected by the same ADMIN_SECRET as the dashboard.
 * Registered at /api/keywords
 */

import {
  getAllKeywords,
  createKeyword,
  updateKeyword,
  deleteKeyword
} from '../services/keywordService.js'

const ADMIN_SECRET = process.env.ADMIN_SECRET

function requireAuth(request, reply, done) {
  if (!ADMIN_SECRET) return done()
  const token = request.headers['x-admin-secret'] ?? request.query.secret
  if (token !== ADMIN_SECRET) {
    reply.status(401).send({ error: 'Unauthorized' })
    return
  }
  done()
}

export default async function keywordRoutes(fastify) {

  fastify.addHook('onRequest', requireAuth)

  /** GET /api/keywords — list all keywords */
  fastify.get('/', async (request, reply) => {
    const keywords = await getAllKeywords()
    return reply.send({ keywords })
  })

  /** POST /api/keywords — create a keyword */
  fastify.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['pattern', 'search_term'],
        properties: {
          pattern:     { type: 'string', minLength: 1, maxLength: 100 },
          search_term: { type: 'string', minLength: 1, maxLength: 100 },
          category:    { type: 'string', default: 'health' }
        }
      }
    }
  }, async (request, reply) => {
    const keyword = await createKeyword(request.body)
    return reply.status(201).send({ keyword })
  })

  /** PATCH /api/keywords/:id — update a keyword */
  fastify.patch('/:id', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        properties: {
          pattern:     { type: 'string', minLength: 1, maxLength: 100 },
          search_term: { type: 'string', minLength: 1, maxLength: 100 },
          category:    { type: 'string' },
          active:      { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    const keyword = await updateKeyword(request.params.id, request.body)
    return reply.send({ keyword })
  })

  /** DELETE /api/keywords/:id — delete a keyword */
  fastify.delete('/:id', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } }
    }
  }, async (request, reply) => {
    await deleteKeyword(request.params.id)
    return reply.send({ success: true })
  })

}
