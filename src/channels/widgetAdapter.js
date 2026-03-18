/**
 * widgetAdapter.js
 *
 * Adapts the Shopify chat widget request body into a NormalizedMessage.
 * The widget sends: { message: string, sessionId: string }
 */

import { normalizeMessage } from './normalizedMessage.js'

/**
 * @param {object} body   — raw Fastify request.body from POST /api/chat
 * @returns {import('./normalizedMessage.js').NormalizedMessage}
 */
export function fromWidgetRequest(body) {
  const { message, sessionId } = body

  return normalizeMessage({
    sessionId,
    channel:       'widget',
    channelUserId: sessionId,   // widget identifies users by their sessionId
    text:          message,
    raw:           body
  })
}
