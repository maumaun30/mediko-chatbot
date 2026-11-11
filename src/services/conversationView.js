/**
 * conversationView.js - shapes a chat_sessions row for the agent inbox.
 * Shared by routes/agent.js (REST) and agentService.js (WebSocket) so neither
 * has to import the other.
 */
import { isUnanswered } from './sessionService.js'

export function toConversation(row, online) {
  return {
    id: row.id,
    displayName: row.customer_name || 'Unknown visitor',
    email: row.customer_email ?? null,
    phone: row.customer_phone ?? null,
    status: row.status,
    unanswered: isUnanswered(row),
    online: !!online,
    lastMessage: row.last_message ?? null,
    lastActive: row.last_active ?? null
  }
}
