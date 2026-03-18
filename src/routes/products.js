/**
 * products.js
 *
 * Exposes Shopify product search for testing and debugging.
 */

import { searchProducts, extractSearchTerms } from '../services/shopifyService.js'

export default async function productRoutes(fastify) {

  /**
   * GET /api/products/search?q=genacol
   * Search Shopify products by keyword directly.
   */
  fastify.get('/search', {
    schema: {
      querystring: {
        type: 'object',
        required: ['q'],
        properties: {
          q:     { type: 'string', minLength: 1, maxLength: 200 },
          limit: { type: 'integer', minimum: 1, maximum: 10, default: 4 }
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
   * Debug endpoint — shows which search terms would be extracted from a message.
   * Also shows what Shopify queries would be fired.
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
    const terms = await extractSearchTerms(message)
    return reply.send({
      message,
      extractedTerms: terms,
      note: 'Each term is searched individually against Shopify. Check /api/products/search?q=TERM to verify results.'
    })
  })

}
