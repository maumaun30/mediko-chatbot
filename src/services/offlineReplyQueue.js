/**
 * offlineReplyQueue.js - email the customer agent replies they were offline
 * for. Debounced per session; presence is re-checked when the timer fires.
 * Also wires the live-event hooks (alerts + queue) on top of agentService's.
 */
import * as sessions from './sessionService.js'
import { signChatLink as realSign } from './agentAuth.js'
import { postChatEvent as realPost } from './gatewayNotifier.js'
import { maskId } from './redact.js'

export function createOfflineReplyQueue({
  delayMs = 120_000, isOnline, send, setTimer = setTimeout, clearTimer = clearTimeout, log = console.error
}) {
  const pending = new Map() // sessionId -> timer
  return {
    enqueue(sessionId) {
      if (pending.has(sessionId)) return
      const timer = setTimer(async () => {
        pending.delete(sessionId)
        try {
          if (!isOnline(sessionId)) await send(sessionId)
        } catch (err) {
          log(`[offlineQueue] ${maskId(sessionId)} failed: ${err?.message}`)
        }
      }, delayMs)
      timer?.unref?.()
      pending.set(sessionId, timer)
    },
    size: () => pending.size,
    clear() { for (const t of pending.values()) clearTimer(t); pending.clear() }
  }
}

/** Builds the queue's send(sessionId). Skips (never throws) when nothing can be sent. */
export function createOfflineSender(d = {}) {
  const getSession = d.getSession || sessions.getSession
  const agentMessagesToEmail = d.agentMessagesToEmail || sessions.agentMessagesToEmail
  const markEmailed = d.markEmailed || sessions.markEmailed
  const sign = d.signChatLink || realSign
  const post = d.postChatEvent || realPost
  const log = d.log || console.error
  const now = d.now || (() => new Date())

  return async (sessionId) => {
    const s = await getSession(sessionId)
    if (!s || !s.customer_email) return
    const messages = (await agentMessagesToEmail(sessionId)).map(sessions.stripAgentPrefix)
    if (!messages.length) return
    let token
    try { token = sign(sessionId) } catch (err) {
      log(`[offlineQueue] cannot sign chat link, skipping email: ${err?.message}`)
      return
    }
    const base = d.chatCustomerUrl ?? process.env.CHAT_CUSTOMER_URL ?? ''
    const link = `${base}${base.includes('?') ? '&' : '?'}mdk_chat=${token}`
    const ok = await post('offline_reply', { sessionId, name: s.customer_name ?? null, email: s.customer_email, messages, link })
    if (ok) await markEmailed(sessionId, now())
  }
}

/**
 * Wrap the existing hooks (assigned by agentService at load) so broadcast
 * keeps working, then add alert / offline-queue behavior. Failures are
 * caught and logged so they never fail the customer's request.
 */
export function installNotificationHooks(hooks, d = {}) {
  const log = d.log || console.error
  const post = d.postChatEvent || realPost
  const markAlerted = d.markAlerted || sessions.markAlerted
  const now = d.now || (() => new Date())
  const isOnline = d.isOnline
  const queue = d.queue
  const prevCustomer = hooks.onCustomerMessage
  const prevAgent = hooks.onAgentMessage

  hooks.onCustomerMessage = async (session, message, isFirst) => {
    await prevCustomer(session, message, isFirst)
    if (!isFirst) return
    try {
      const ok = await post('new_conversation', {
        sessionId: session.id, name: session.customer_name ?? null, email: session.customer_email ?? null,
        phone: session.customer_phone ?? null, text: message?.content ?? ''
      })
      if (ok) await markAlerted(session.id, now())
    } catch (err) {
      log(`[alerts] new_conversation failed: ${err?.message}`)
    }
  }

  hooks.onAgentMessage = async (session, message) => {
    await prevAgent(session, message)
    try {
      if (!isOnline(session.id)) queue.enqueue(session.id)
    } catch (err) {
      log(`[offlineQueue] enqueue failed: ${err?.message}`)
    }
  }
}
