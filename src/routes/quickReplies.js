/**
 * quickReplies.js — CRUD API at /api/quick-replies
 * Public GET (widget uses it), protected POST/PATCH/DELETE (admin only)
 */

import {
  getAllQuickReplies, loadQuickReplies,
  createQuickReply, updateQuickReply, deleteQuickReply
} from '../services/quickReplyService.js'

const ADMIN_SECRET = process.env.ADMIN_SECRET

function requireAuth(request, reply, done) {
  if (!ADMIN_SECRET) return done()
  const token = request.headers['x-admin-secret'] ?? request.query.secret
  if (token !== ADMIN_SECRET) { reply.status(401).send({ error: 'Unauthorized' }); return }
  done()
}

export default async function quickReplyRoutes(fastify) {

  /** GET /api/quick-replies — public, used by the widget */
  fastify.get('/', async (request, reply) => {
    const items = await loadQuickReplies()
    return reply.send({ quickReplies: items })
  })

  /** GET /api/quick-replies/all — admin, includes inactive */
  fastify.get('/all', { onRequest: requireAuth }, async (request, reply) => {
    const items = await getAllQuickReplies()
    return reply.send({ quickReplies: items })
  })

  /** POST /api/quick-replies */
  fastify.post('/', {
    onRequest: requireAuth,
    schema: {
      body: {
        type: 'object', required: ['label', 'message'],
        properties: {
          label:      { type: 'string', minLength: 1, maxLength: 100 },
          message:    { type: 'string', minLength: 1, maxLength: 500 },
          sort_order: { type: 'integer', default: 0 }
        }
      }
    }
  }, async (request, reply) => {
    const item = await createQuickReply(request.body)
    return reply.status(201).send({ quickReply: item })
  })

  /** PATCH /api/quick-replies/:id */
  fastify.patch('/:id', {
    onRequest: requireAuth,
    schema: {
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        properties: {
          label:      { type: 'string', minLength: 1, maxLength: 100 },
          message:    { type: 'string', minLength: 1, maxLength: 500 },
          sort_order: { type: 'integer' },
          active:     { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    const item = await updateQuickReply(request.params.id, request.body)
    return reply.send({ quickReply: item })
  })

  /** DELETE /api/quick-replies/:id */
  fastify.delete('/:id', {
    onRequest: requireAuth,
    schema: { params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } } }
  }, async (request, reply) => {
    await deleteQuickReply(request.params.id)
    return reply.send({ success: true })
  })
}
