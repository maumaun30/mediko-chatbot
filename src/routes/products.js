/**
 * products.js
 *
 * Exposes Shopify product search for:
 *   - Direct testing (curl / Postman)
 *   - Future widget use (e.g. quick product cards in chat UI)
 */

import { searchProducts, extractSearchKeywords } from '../services/shopifyService.js'

export default async function productRoutes(fastify) {

  /**
   * GET /api/products/search?q=vitamin+c
   * Search Shopify products by keyword.
   */
  fastify.get('/search', {
    schema: {
      querystring: {
        type: 'object',
        required: ['q'],
        properties: {
          q:     { type: 'string', minLength: 1, maxLength: 200 },
          limit: { type: 'integer', minimum: 1, maximum: 10, default: 3 }
        }
      }
    }
  }, async (request, reply) => {
    const { q, limit } = request.query

    const products = await searchProducts(q, limit)
    return reply.send({ query: q, count: products.length, products })
  })


  /**
   * GET /api/products/keywords?message=hirap+matulog
   * Debug endpoint — shows which keywords would be extracted from a message.
   */
  fastify.get('/keywords', {
    schema: {
      querystring: {
        type: 'object',
        required: ['message'],
        properties: { message: { type: 'string', minLength: 1, maxLength: 500 } }
      }
    }
  }, async (request, reply) => {
    const { message } = request.query
    const keywords = extractSearchKeywords(message)
    return reply.send({ message, keywords, shopifyQuery: keywords.slice(0, 4).join(' OR ') })
  })

}
