# Mediko Chat API

Live-agent chat backend for [store.mediko.ph](https://store.mediko.ph).
Customers talk to the Mediko team (shown as **"Mediko Support"**); staff
answer from an inbox embedded in the Mediko gateway (Shopify admin).
There is **no AI in the default flow**: `AI_ENABLED=false`. The legacy Gemini
path is kept behind `AI_ENABLED=true` only.

Built with **Fastify 4** (ESM) + **MySQL** + **ws**.

---

## Quick Start

```bash
cp .env.example .env          # set DB_*, CHAT_AGENT_SECRET, GATEWAY_*, ALLOWED_ORIGINS
docker compose up --build     # API on :3001 + MySQL on :3306 (schema auto-loaded)
```

Or run the API on the host with hot reload (MySQL still in Docker):

```bash
npm install
docker compose up -d db
npm run dev
```

Migrations (`src/db/migrate.js`) run on every start. See [DEPLOY.md](DEPLOY.md)
for CloudPanel/VPS deployment.

---

## Architecture

```
 Customer widget (store.mediko.ph)            Staff inbox (gateway, Shopify admin)
   |  REST + SSE  (/api/chat/*)                 |  REST (/api/agent/*) + WS (/api/agent/ws)
   v                                            v   gateway-issued agent JWT
 +--------------------------- Fastify chat service -----------------------------+
 |  chat routes -> sessionService (MySQL) -> hooks (chatEvents.js)               |
 |  agentService: widget presence, agent sockets, broadcast                      |
 |  notifications: new_conversation / unanswered / offline_reply                 |
 +---------------------------------------|--------------------------------------+
                                          | signed POST /internal/chat-events
                                          v
                                   Gateway (staff alerts, customer emails)
```

- The customer posts a message; it is stored and broadcast to every connected
  agent socket. Agent replies are pushed to the widget over SSE.
- Presence = at least one open `/api/chat/listen/:sessionId` stream.
- Business hours (default Mon-Fri 08:00-17:00, `Asia/Manila`) only change the
  away message; customers can always write.
- **Alerts** (to the gateway, around the clock):
  - `new_conversation` on a session's first message (also sets `alerted_at`).
  - `unanswered` when the customer has written again since the last alert and
    nobody replied for N minutes (default 10, configurable). Checked every
    60 s by `alertScheduler.js`; at most one alert per unanswered stretch.
  - `offline_reply` when an agent replies and the customer is not connected
    for 120 s (debounced, presence re-checked when the timer fires). The
    gateway emails the replies with a 14-day link (`?mdk_chat=<token>`).
- All hook failures (DB, network) are caught and logged; they never fail a
  customer request.

> **Single instance only.** Presence, agent sockets, the offline queue and the
> alert scheduler live in process memory. Run exactly one process
> (`instances: 1`, fork mode in pm2). Cluster mode would split connections and
> duplicate alerts.

---

## Endpoints

### Public (widget)

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/health` | Health check |
| `GET`  | `/api/chat/config` | `{ aiEnabled, online, nextOpenAt, awayMessage, schedule }`. `schedule` is `{ timezone, days: [{ day, open, start, end }] }` Mon→Sun, or null when office hours are off |
| `POST` | `/api/chat/session` | Create a session. Body: `customerName`, `customerEmail`, `customerPhone` (PH mobile `09XXXXXXXXX` / `+639XXXXXXXXX`, stored as `639XXXXXXXXX`), optional `metadata`. Returns `201 { sessionId }` |
| `POST` | `/api/chat/order-status` | "Track my order" `{ order, contact }` (order number + the email or PH mobile used on the order). 5/min per IP and 10/hour per order number. Relayed to Gateway `POST /internal/order-status` (signed like chat events); answers `{ found: true, status: { order, state, placedAt, shippedAt, carrier, trackingNumber, trackingUrl } }` only when the contact matches, otherwise `{ found: false }` (same for a missing order). 503 when Gateway is unreachable |
| `POST` | `/api/chat/message` | Customer message (1-2000 chars, 15/min). Optional `hidePreview: true` when the customer removed the link card (stored in `meta`, returned as `message.hidePreview`; Gateway then shows no card either). Returns `{ message, away }` |
| `POST` | `/api/chat/typing` | Customer typing signal, `204` |
| `GET`  | `/api/chat/resume?t=<token>` | Exchange a signed email link token for `{ sessionId }`; `410 { error: 'expired' }` if invalid/expired |
| `GET`  | `/api/chat/history/:sessionId` | Message history (`?limit=1..100`) |
| `GET`  | `/api/chat/listen/:sessionId` | Widget SSE stream (also marks the customer online). Events: `connected`, `agent_message`, `agent_typing`, `ping` |
| `GET`  | `/api/chat/mode/:sessionId` | Legacy session mode |
| `POST` | `/api/chat` | Legacy AI SSE stream; `409` unless `AI_ENABLED=true` |
| `*`    | `/api/webhooks/whatsapp`, `/api/webhooks/messenger` | Meta channels (not live) |

### Agent (all require `Authorization: Bearer <agent JWT>`)

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/agent/conversations` | List. Query: `status` (`open`/`unanswered`/`closed`), `q`, `limit` (1-200), `before` |
| `GET`  | `/api/agent/conversations/:id` | `{ conversation, messages }`; 404 if unknown |
| `GET`  | `/api/agent/settings` | `{ businessHours, unansweredMinutes }` |
| `PUT`  | `/api/agent/settings` | Update `unansweredMinutes` (1-240) and/or `businessHours` |
| `WS`   | `/api/agent/ws?token=<agent JWT>` | Real-time inbox (below) |

`/api/keywords/*` and `/api/analytics/*` also require the agent JWT.

The agent JWT is HS256, `iss: mediko-gateway`, `aud: mediko-chat`, 300 s TTL,
`sub` = staff user id, signed with `CHAT_AGENT_SECRET`. The gateway mints it.

---

## Agent WebSocket Protocol

Connect to `wss://<chat-host>/api/agent/ws?token=<jwt>`. The upgrade is
rejected with `401` unless the `Origin` header equals `GATEWAY_ORIGIN`
(fail closed when unset) and the token is valid. Frames are JSON, max 16 KB.

### Server -> agent

Every event also carries `ts` (ISO time).

```json
{ "type": "connected", "message": "Agent inbox ready" }
{ "type": "customer_message", "sessionId": "...", "message": { "...": "..." }, "conversation": { "...": "..." } }
{ "type": "agent_sent",       "sessionId": "...", "message": { "...": "..." } }
{ "type": "session_updated",  "sessionId": "...", "conversation": { "...": "..." } }
{ "type": "customer_typing",  "sessionId": "..." }
{ "type": "error", "message": "..." }
```

`conversation` is `{ id, displayName, email, phone, status, unanswered, unread, online, lastMessage, lastActive }`. `unanswered` = the customer wrote after the last agent reply; `unread` (the inbox "New" badge) = the customer wrote after an agent last opened the chat (`seen`) or replied.

### Agent -> server

```json
{ "type": "agent_message", "sessionId": "...", "text": "Hello po!", "preview": { "url": "...", "title": "...", "description": null, "image": null, "price": "1899.00", "currency": "PHP" } }
{ "type": "typing",        "sessionId": "...", "value": true }
{ "type": "close",         "sessionId": "..." }
{ "type": "reopen",        "sessionId": "..." }
{ "type": "seen",          "sessionId": "..." }
```

`text` must be 1-2000 characters. `preview` is optional (Gateway builds it from the Shopify Admin API); it is validated by `linkPreview.js`: https URL on a `LINK_PREVIEW_HOSTS` host (default `store.mediko.ph,mediko.ph`), image only from `https://cdn.shopify.com/`, bounded text. It is stored in `chat_messages.meta` and returned as `message.preview` in history, `agent_sent` and the widget's `agent_message`. Bad input returns `{ "type": "error" }`.

---

## Gateway events (chat service -> gateway)

`POST ${GATEWAY_URL}/internal/chat-events`, JSON body `{ type, ...payload }`,
10 s timeout, never throws (logs and returns false).

| Header | Value |
|--------|-------|
| `X-Mediko-Timestamp` | unix ms |
| `X-Mediko-Signature` | hex HMAC-SHA256 of `` `${timestamp}.${rawBody}` `` with `CHAT_AGENT_SECRET` |

| `type` | Payload |
|--------|---------|
| `new_conversation`, `unanswered` | `{ sessionId, name, email, phone, text }` |
| `offline_reply` | `{ sessionId, name, email, messages: string[], link }` with `link = ${CHAT_CUSTOMER_URL}?mdk_chat=<token>` |

If `CHAT_AGENT_SECRET` is missing or shorter than 32 chars, events are skipped
and logged.

---

## Environment variables

| Variable | Purpose |
|----------|---------|
| `CHAT_AGENT_SECRET` | 32+ chars. Shared with the gateway; signs agent JWTs, customer link tokens and chat events. Never stored in the DB |
| `ALLOWED_ORIGINS` | Comma list of browser origins for CORS (store + gateway). Falls back to `WIDGET_ALLOWED_ORIGIN` |
| `GATEWAY_URL` | Base URL events are posted to |
| `GATEWAY_ORIGIN` | Exact `Origin` the agent WebSocket accepts |
| `CHAT_CUSTOMER_URL` | Storefront page hosting the widget; used in emailed links |
| `AI_ENABLED` | `false` (default). `true` re-enables the legacy Gemini path |
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` | MySQL |
| `PORT` `HOST` `NODE_ENV` `LOG_LEVEL` | Server |
| `GEMINI_*`, `SHOPIFY_*`, `META_*`, `WHATSAPP_*` | Only for the legacy AI / channel features |

The standalone `/dashboard` and the `ADMIN_SECRET` variable were **removed**.
Staff use the gateway-embedded inbox; every agent route authenticates with the
gateway-issued JWT.

---

## Tests

```bash
npm test      # node --test tests/*.test.js
```

---

## Project Structure

```
src/
  app.js                       Fastify entry, hooks + scheduler wiring
  services/
    agentAuth.js               agent JWT, chat link tokens, event signing
    agentService.js            widget presence, agent WS, broadcast, hooks
    chatEvents.js              hook points between routes and live features
    gatewayNotifier.js         signed POST /internal/chat-events
    alertScheduler.js          unanswered alerts (60 s tick, unref'd)
    offlineReplyQueue.js       debounced offline-reply emails + hook wiring
    sessionService.js          MySQL sessions / messages
    settingsService.js         business hours, unanswered minutes
    hours.js, phone.js         office-hours and PH mobile helpers
  routes/
    chat.js                    /api/chat/*
    agent.js                   /api/agent/*
  plugins/                     security (CORS, rate limit), requireAgent, static
  db/                          mysql pool, migrate.js, schema.sql
tests/
```
