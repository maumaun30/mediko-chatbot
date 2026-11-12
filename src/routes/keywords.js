/**
 * keywords.js
 *
 * CRUD REST API for chat keywords.
 * Protected by the agent gateway JWT (requireAgent).
 * Registered at /api/keywords
 */

import {
  getAllKeywords,
  createKeyword,
  updateKeyword,
  deleteKeyword
} from '../services/keywordService.js'


export default async function keywordRoutes(fastify) {

  fastify.addHook('onRequest', fastify.requireAgent)

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
