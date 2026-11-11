/**
 * agentService.js
 *
 * Real-time agent inbox: authenticated WebSocket for agents, widget SSE
 * presence, and the live-event hooks.
 *
 * Server -> agent events:
 *   connected, customer_message, agent_sent, session_updated, customer_typing
 *   (plus handoff_requested / mode_changed from the legacy AI path)
 *
 * Agent -> server commands (validated; bad input gets { type: 'error' }):
 *   { type: 'agent_message', sessionId, text }  text 1-2000 chars
 *   { type: 'typing', sessionId, value }
 *   { type: 'close' | 'reopen', sessionId }
 */

import { WebSocketServer } from 'ws'
import * as realSessions from './sessionService.js'
import { dispatchReply as realDispatchReply } from './responseDispatcher.js'
import { toConversation } from './conversationView.js'
import { hooks } from './chatEvents.js'
import { verifyAgentToken } from './agentAuth.js'

const AGENT_PATH = '/api/agent/ws'
const MAX_TEXT = 2000

// ── Presence ─────────────────────────────────────────────────

/** Tracks widget SSE subscribers per session. Online = at least one. */
export function createPresence() {
  const map = new Map() // sessionId -> Set<raw>
  return {
    add(sessionId, raw) {
      if (!map.has(sessionId)) map.set(sessionId, new Set())
      map.get(sessionId).add(raw)
    },
    remove(sessionId, raw) {
      const set = map.get(sessionId)
      if (!set) return
      set.delete(raw)
      if (!set.size) map.delete(sessionId)
    },
    isOnline: (sessionId) => !!map.get(sessionId)?.size,
    each(sessionId, fn) {
      const set = map.get(sessionId)
      if (set) for (const raw of [...set]) fn(raw)
    }
  }
}

const presence = createPresence()

export const isOnline = (sessionId) => presence.isOnline(sessionId)

/** @returns {boolean} true if this subscription brought the session online */
export function subscribeWidget(sessionId, raw) {
  const was = presence.isOnline(sessionId)
  presence.add(sessionId, raw)
  return !was
}

/** @returns {boolean} true if this removal took the session offline */
export function unsubscribeWidget(sessionId, raw) {
  const was = presence.isOnline(sessionId)
  presence.remove(sessionId, raw)
  return was && !presence.isOnline(sessionId)
}

/** Push an event to every widget SSE connection on a session. */
export function pushToWidget(sessionId, event) {
  const line = `data: ${JSON.stringify(event)}\n\n`
  presence.each(sessionId, (raw) => {
    try {
      raw.write(line)
      if (typeof raw.flush === 'function') raw.flush()
    } catch { presence.remove(sessionId, raw) }
  })
}

// ── Agent sockets + broadcast ────────────────────────────────

/** @type {Set<{ readyState: number, send: Function }>} */
const agentConnections = new Set()

/** Register an agent socket; returns an unregister function. */
export function registerAgentSocket(ws) {
  agentConnections.add(ws)
  return () => agentConnections.delete(ws)
}

/** Send an event to every connected agent. */
export function broadcast(event) {
  const payload = JSON.stringify({ ...event, ts: new Date().toISOString() })
  for (const ws of agentConnections) {
    if (ws.readyState !== 1 /* OPEN */) continue
    try { ws.send(payload) } catch { agentConnections.delete(ws) }
  }
}

function conversationFor(row, lastMessage) {
  const view = lastMessage === undefined ? row : { ...row, last_message: lastMessage }
  return toConversation(view, isOnline(row.id))
}

/** Re-read a session and tell agents (status / presence changed). */
export async function notifySessionUpdated(sessionId, sessions = realSessions) {
  const row = await sessions.getSession(sessionId)
  if (row) broadcast({ type: 'session_updated', sessionId, conversation: conversationFor(row) })
}

// ── Live-event hooks (Task 6 layers alerts / offline queue on top) ──

/** The one customer_message shape agents ever receive. */
export function customerMessageEvent(session, message) {
  return { type: 'customer_message', sessionId: session.id, message, conversation: conversationFor(session, message.content) }
}

hooks.onCustomerMessage = async (session, message, _isFirst) => {
  broadcast(customerMessageEvent(session, message))
}
hooks.onCustomerTyping = async (sessionId) => {
  broadcast({ type: 'customer_typing', sessionId })
}

// ── Upgrade authorization ────────────────────────────────────

/**
 * @param {{ url?: string, headers?: object }} req
 * @returns {{ sub: string } | null}  null = reject (fail closed)
 */
export function authorizeUpgrade(req, { secret, gatewayOrigin = process.env.GATEWAY_ORIGIN } = {}) {
  if (!gatewayOrigin) return null
  if (req?.headers?.origin !== gatewayOrigin) return null
  let url
  try { url = new URL(req.url || '', 'http://localhost') } catch { return null }
  if (url.pathname !== AGENT_PATH) return null
  return verifyAgentToken(url.searchParams.get('token') || '', secret)
}

// ── WebSocket server ─────────────────────────────────────────

/**
 * Attach the agent WebSocket server to the raw HTTP server (call once).
 * @param {import('http').Server} httpServer
 */
export function setupAgentWebSocket(httpServer) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 })

  httpServer.on('upgrade', (request, socket, head) => {
    socket.on('error', () => {})
    const pathname = (request.url || '').split('?')[0]
    if (pathname !== AGENT_PATH) return socket.destroy()

    const agent = authorizeUpgrade(request)
    if (!agent) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      return socket.destroy()
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.agentId = agent.sub
      wss.emit('connection', ws, request)
    })
  })

  wss.on('connection', (ws) => {
    const unregister = registerAgentSocket(ws)
    const reply = (obj) => { try { ws.send(JSON.stringify(obj)) } catch {} }

    ws.on('message', async (data) => {
      try {
        let cmd
        try { cmd = JSON.parse(data.toString()) } catch { throw badInput('Invalid JSON') }
        await handleAgentCommand(cmd)
      } catch (err) {
        if (!err?.expose) console.error('[agentWs] command failed:', err?.message)
        reply({ type: 'error', message: err?.expose ? err.message : 'Internal error' })
      }
    })

    ws.on('close', unregister)
    ws.on('error', unregister)

    reply({ type: 'connected', message: 'Agent inbox ready' })
  })
}

// ── Commands from agents ─────────────────────────────────────

function badInput(message) {
  return Object.assign(new Error(message), { expose: true })
}

/**
 * Validate and run one agent command. Throws errors with `expose: true` for
 * bad input (message is safe to return to the agent).
 */
export async function handleAgentCommand(cmd, d = {}) {
  const getSession = d.getSession || realSessions.getSession
  const saveAgentMessage = d.saveAgentMessage || realSessions.saveAgentMessage
  const setStatus = d.setStatus || realSessions.setStatus
  const dispatchReply = d.dispatchReply || realDispatchReply
  const emit = d.broadcast || broadcast
  const push = d.pushToWidget || pushToWidget
  const onAgentMessage = d.onAgentMessage || ((...a) => hooks.onAgentMessage(...a))

  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) throw badInput('Invalid command')
  const { type, sessionId } = cmd
  if (!['agent_message', 'typing', 'close', 'reopen'].includes(type)) throw badInput(`Unknown command: ${String(type).slice(0, 40)}`)
  if (typeof sessionId !== 'string' || !sessionId) throw badInput('sessionId is required')
  const session = await getSession(sessionId)
  if (!session) throw badInput('Unknown session')

  const updated = async () => {
    const row = await getSession(sessionId)
    if (row) emit({ type: 'session_updated', sessionId, conversation: toConversation(row, isOnline(sessionId)) })
  }

  switch (type) {
    case 'agent_message': {
      const { text } = cmd
      if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) {
        throw badInput(`text must be 1-${MAX_TEXT} characters`)
      }
      await dispatchReply(session.channel, session.channel_user_id, text) // no-op for widget
      const message = await saveAgentMessage(sessionId, text)
      try { await onAgentMessage(session, message) } catch (err) { console.error('[agentWs] onAgentMessage failed:', err?.message) }
      emit({ type: 'agent_sent', sessionId, message })
      push(sessionId, { type: 'agent_message', message: { ...message, role: 'agent' } })
      await updated()
      break
    }
    case 'typing':
      push(sessionId, { type: 'agent_typing', value: !!cmd.value })
      break
    case 'close':
    case 'reopen':
      await setStatus(sessionId, type === 'close' ? 'closed' : 'open')
      await updated()
      break
  }
}
