# Mediko Chat API — Phase 2 (Channel-Agnostic Architecture)

Tagalog AI customer support backend for [store.mediko.ph](https://store.mediko.ph).  
Supports **Shopify widget**, **WhatsApp**, and **Facebook Messenger** from a single codebase.

Built with **Fastify** + **OpenAI** + **Supabase** + **Meta Cloud API**.

---

## Quick Start

```bash
npm install
cp .env.example .env        # fill in your keys
# Run both migrations in Supabase SQL Editor:
#   src/db/migration.sql          (Phase 1 — tables)
#   src/db/migration_phase2.sql   (Phase 2 — mode/channel columns)
npm run dev
```

---

## Architecture

```
Channels (Widget / WhatsApp / Messenger)
        ↓
  Channel adapters       ← normalise to NormalizedMessage
        ↓
  Conversation manager   ← checks mode (ai/agent), detects handoff keywords
        ↓
  AI pipeline  ─────────────────────→  OpenAI (streamed)
  Agent inbox  ← WebSocket dashboard → admin replies
        ↓
  Response dispatcher    ← sends reply back to correct channel
        ↓
      Supabase           ← sessions, messages, handoff state
```

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/health` | Health check |
| `POST` | `/api/chat/session` | Create widget session |
| `POST` | `/api/chat` | Widget SSE stream |
| `GET`  | `/api/chat/history/:sessionId` | Load message history |
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
    agentService.js               ← WebSocket inbox + agent commands
    sessionService.js             ← Supabase session/message CRUD
    promptService.js              ← Tagalog system prompt builder
    openaiService.js              ← OpenAI streaming client
  routes/
    chat.js                       ← /api/chat (widget SSE)
    webhooks.js                   ← /api/webhooks/whatsapp + messenger
  plugins/
    security.js                   ← CORS + rate limiting
  db/
    supabase.js                   ← Supabase client singleton
    migration.sql                 ← Phase 1 tables
    migration_phase2.sql          ← Phase 2 columns
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
