# Mediko Chat API — Phase 2 (Channel-Agnostic Architecture)

Tagalog AI customer support backend for [store.mediko.ph](https://store.mediko.ph).  
Supports **Shopify widget**, **WhatsApp**, and **Facebook Messenger** from a single codebase.

Built with **Fastify** + **Google Gemini** + **MySQL** + **Meta Cloud API**.

---

## Quick Start

```bash
cp .env.example .env          # fill in your keys
docker compose up --build     # API on :3001 + MySQL on :3306 (schema auto-loaded)
```

Or run the API on the host with hot reload (MySQL still in Docker):

```bash
npm install
cp .env.example .env
docker compose up -d db       # MySQL only
npm run dev
```

The MySQL schema + seed data live in `src/db/schema.sql` and load automatically
on the first start of the `db` container. See [DEPLOY.md](DEPLOY.md) for
CloudPanel/VPS deployment.

---

## Architecture

```
Channels (Widget / WhatsApp / Messenger)
        ↓
  Channel adapters       ← normalise to NormalizedMessage
        ↓
  Conversation manager   ← checks mode (ai/agent), detects handoff keywords
        ↓
  AI pipeline  ─────────────────────→  Gemini (streamed)
  Agent inbox  ← WebSocket dashboard → admin replies
        ↓
  Response dispatcher    ← widget gets agent replies via SSE (/api/chat/listen)
        ↓
      MySQL              ← sessions, messages, handoff state
```

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/health` | Health check |
| `POST` | `/api/chat/session` | Create widget session |
| `POST` | `/api/chat` | Widget SSE stream |
| `GET`  | `/api/chat/history/:sessionId` | Load message history |
| `GET`  | `/api/chat/listen/:sessionId` | Widget SSE stream for agent replies (replaces Supabase Realtime) |
| `GET`  | `/api/webhooks/whatsapp` | Meta webhook verification |
| `POST` | `/api/webhooks/whatsapp` | WhatsApp inbound messages |
| `GET`  | `/api/webhooks/messenger` | Meta webhook verification |
| `POST` | `/api/webhooks/messenger` | Messenger inbound messages |
| `WS`   | `/api/agent/ws` | Admin agent inbox (WebSocket) |

---

## Handoff System

### Guest-initiated (keyword trigger)
Customer types any of: `agent`, `tao`, `ahente`, `human`, `tulong`, `help`, `support`

Medi replies: *"Sandali lang po. Ikinokonekta ko kayo sa aming team..."*  
Session `mode` flips to `'agent'`. Admin dashboard receives a `handoff_requested` WebSocket event.

### Admin-initiated (proactive takeover)
Admin sends `{ type: 'take_over', sessionId }` via WebSocket.  
All subsequent customer messages bypass AI and go to the agent inbox.

### Return to AI
- Guest types: `ai na`, `medi na`, `return to ai`, `back to ai`
- Admin sends: `{ type: 'return_to_ai', sessionId }` via WebSocket

---

## Agent WebSocket Protocol

Connect to: `ws://your-domain.com/api/agent/ws`

### Events received by admin dashboard

```json
{ "type": "handoff_requested", "sessionId": "...", "channel": "whatsapp", "text": "agent" }
{ "type": "customer_message",  "sessionId": "...", "channel": "messenger", "text": "hello" }
{ "type": "mode_changed",      "sessionId": "...", "mode": "ai" }
{ "type": "agent_sent",        "sessionId": "...", "text": "Hello po!" }
```

### Commands sent by admin dashboard

```json
{ "type": "take_over",     "sessionId": "..." }
{ "type": "return_to_ai",  "sessionId": "..." }
{ "type": "agent_message", "sessionId": "...", "text": "Hello po, paano kita matutulungan?" }
```

---

## Meta Webhook Setup (Phase 4)

1. Create a Meta App at [developers.facebook.com](https://developers.facebook.com)
2. Add **WhatsApp** and **Messenger** products
3. Set `META_WEBHOOK_VERIFY_TOKEN` in `.env` to any secret string
4. Register webhook URLs:
   - `https://your-domain.com/api/webhooks/whatsapp`
   - `https://your-domain.com/api/webhooks/messenger`
5. Subscribe to the **messages** webhook field on both products
6. For WhatsApp: copy **Phone Number ID** → `WHATSAPP_PHONE_NUMBER_ID`
7. For Messenger: copy **Page Access Token** → `MESSENGER_PAGE_ACCESS_TOKEN`
8. Get a **System User Access Token** with `whatsapp_business_messaging` permission → `META_ACCESS_TOKEN`

> Meta Cloud API free tier: **1,000 conversations/month** (resets monthly).  
> A conversation = 24-hour window from first message. No per-message charge within the window.

---

## Running Tests

```bash
npm test
# 14/22 pass without npm install (sandbox only)
# 22/22 pass after npm install in your project
```

---

## Project Structure

```
src/
  app.js                          ← Fastify entry, WebSocket setup
  channels/
    normalizedMessage.js          ← shared internal message format
    widgetAdapter.js              ← Shopify widget → NormalizedMessage
    whatsappAdapter.js            ← Meta WhatsApp → NormalizedMessage + send
    messengerAdapter.js           ← Meta Messenger → NormalizedMessage + send
  services/
    conversationManager.js        ← mode check, keyword detection, routing
    responseDispatcher.js         ← sends reply to correct channel
    agentService.js               ← WebSocket inbox + agent commands + widget SSE push
    sessionService.js             ← MySQL session/message CRUD
    promptService.js              ← Tagalog system prompt builder
    geminiService.js              ← Google Gemini streaming client
  routes/
    chat.js                       ← /api/chat (widget SSE) + /api/chat/listen
    webhooks.js                   ← /api/webhooks/whatsapp + messenger
  plugins/
    security.js                   ← CORS + rate limiting
  db/
    mysql.js                      ← MySQL connection pool
    schema.sql                    ← tables + seed data (auto-loaded by Docker)
tests/
  chat.test.js
.env.example
```

---

## What's Next

| Phase | Description |
|-------|-------------|
| **Phase 3** | Shopify product context — live product search injected into prompts |
| **Phase 4** | Meta webhook registration + end-to-end WhatsApp/Messenger testing |
| **Phase 5** | Admin dashboard UI — real-time inbox, session list, handoff controls |
| **Phase 6** | React chat widget + Shopify theme.liquid injection |
