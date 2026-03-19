/**
 * agentService.js
 *
 * Manages the real-time admin agent inbox.
 *
 * Uses a simple in-process WebSocket broadcast (via the `ws` package).
 * The admin dashboard connects to ws://your-server/api/agent/ws and
 * receives JSON events in real time.
 *
 * Event types emitted to agents:
 *   handoff_requested   — guest asked for a human
 *   customer_message    — message in an active agent session
 *   mode_changed        — session switched mode (ai ↔ agent)
 *
 * Commands accepted from agents (via WebSocket):
 *   { type: 'take_over',      sessionId }  — admin takes control
 *   { type: 'return_to_ai',   sessionId }  — admin hands back to AI
 *   { type: 'agent_message',  sessionId, text }  — admin sends a reply
 */

import { WebSocketServer } from 'ws'
import { setSessionMode, saveAgentMessage } from './sessionService.js'
import { dispatchReply, dispatchHandoffReturn } from './responseDispatcher.js'

/** @type {Set<import('ws').WebSocket>} */
const agentConnections = new Set()

/**
 * Widget SSE subscribers — map of sessionId → Set of response objects.
 * When an agent sends a message, we push it to any widget listening on that session.
 */
const widgetSubscribers = new Map()  // sessionId → Set<reply.raw>

/**
 * Register a widget SSE connection for a session.
 * Called from the chat route when the widget opens an agent-mode SSE stream.
 */
export function subscribeWidget(sessionId, raw) {
  if (!widgetSubscribers.has(sessionId)) {
    widgetSubscribers.set(sessionId, new Set())
  }
  widgetSubscribers.get(sessionId).add(raw)
}

/**
 * Unregister a widget SSE connection (on close/error).
 */
export function unsubscribeWidget(sessionId, raw) {
  widgetSubscribers.get(sessionId)?.delete(raw)
}

/**
 * Push a message to all widget SSE connections for a session.
 * Called whenever an agent sends a reply or the mode changes.
 */
export function pushToWidget(sessionId, event) {
  const subs = widgetSubscribers.get(sessionId)
  if (!subs?.size) return
  const line = `data: ${JSON.stringify(event)}\n\n`
  for (const raw of subs) {
    try { raw.write(line) } catch { subs.delete(raw) }
  }
}

// ── WebSocket server setup ───────────────────────────────────

/**
 * Attach the agent WebSocket server to the Fastify raw HTTP server.
 * Call this once during app startup.
 *
 * @param {import('http').Server} httpServer
 */
export function setupAgentWebSocket(httpServer) {
  const wss = new WebSocketServer({ noServer: true })

  // Upgrade HTTP → WS only on /api/agent/ws
  httpServer.on('upgrade', (request, socket, head) => {
    if (request.url === '/api/agent/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
      })
    } else {
      socket.destroy()
    }
  })

  wss.on('connection', (ws) => {
    agentConnections.add(ws)

    ws.on('message', async (data) => {
      try {
        const cmd = JSON.parse(data.toString())
        await handleAgentCommand(cmd)
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: err.message }))
      }
    })

    ws.on('close',  () => agentConnections.delete(ws))
    ws.on('error',  () => agentConnections.delete(ws))

    // Send a welcome ping so the dashboard knows it's connected
    ws.send(JSON.stringify({ type: 'connected', message: 'Agent inbox ready' }))
  })
}

// ── Broadcast to all connected agents ───────────────────────

/**
 * Send an event to all connected agent dashboard clients.
 * @param {object} event
 */
export async function notifyAgentInbox(event) {
  const payload = JSON.stringify({ ...event, ts: new Date().toISOString() })
  for (const ws of agentConnections) {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(payload)
    }
  }
}

// ── Handle commands from agents ──────────────────────────────

/**
 * @param {{ type: string, sessionId: string, text?: string }} cmd
 */
async function handleAgentCommand(cmd) {
  const { type, sessionId, text } = cmd

  switch (type) {

    case 'take_over':
      await setSessionMode(sessionId, 'agent', { handoffAt: new Date().toISOString() })
      await notifyAgentInbox({ type: 'mode_changed', sessionId, mode: 'agent', initiatedBy: 'agent' })
      pushToWidget(sessionId, { type: 'mode_changed', mode: 'agent' })
      break

    case 'return_to_ai': {
      const session = await setSessionMode(sessionId, 'ai', { clearAgent: true })
      await dispatchHandoffReturn(session.channel, session.channel_user_id)
      await notifyAgentInbox({ type: 'mode_changed', sessionId, mode: 'ai', initiatedBy: 'agent' })
      pushToWidget(sessionId, { type: 'mode_changed', mode: 'ai' })
      break
    }

    case 'agent_message': {
      if (!text?.trim()) throw new Error('agent_message requires text')

      const session = await setSessionMode(sessionId, 'agent')
      await dispatchReply(session.channel, session.channel_user_id, text)
      await saveAgentMessage(sessionId, text)
      await notifyAgentInbox({ type: 'agent_sent', sessionId, text })

      // Push agent reply to any widget SSE connections on this session
      pushToWidget(sessionId, { type: 'agent_message', text })
      break
    }

    default:
      throw new Error(`Unknown agent command: ${type}`)
  }
}
