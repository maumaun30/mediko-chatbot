# Mediko Chat API — Phase 1

Tagalog AI customer support backend for [store.mediko.ph](https://store.mediko.ph).

Built with **Fastify** + **OpenAI** + **Supabase**.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy env template and fill in your keys
cp .env.example .env

# 3. Run the Supabase migration
# Paste contents of src/db/migration.sql into your Supabase SQL Editor

# 4. Start the dev server
npm run dev
```

The API runs on **http://localhost:3001** by default.

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/health` | Health check |
| `POST` | `/api/chat/session` | Create a new chat session |
| `POST` | `/api/chat` | Send a message — returns SSE stream |
| `GET`  | `/api/chat/history/:sessionId` | Load message history |

---

## POST /api/chat/session

**Request body** (all optional):
```json
{
  "customerEmail": "customer@example.com",
  "metadata": { "url": "https://store.mediko.ph/products/vitamin-c" }
}
```

**Response:**
```json
{ "sessionId": "550e8400-e29b-41d4-a716-446655440000" }
```

---

## POST /api/chat

**Request body:**
```json
{
  "message": "Ano ang benepisyo ng Vitamin C?",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response** — `text/event-stream`:
```
data: {"type":"chunk","text":"Ang Vitamin C po "}
data: {"type":"chunk","text":"ay tumutulong sa "}
data: {"type":"chunk","text":"immune system..."}
data: {"type":"done","tokens":87}
```

Error event (stream stays open until this, then closes):
```
data: {"type":"error","message":"May nangyaring mali. Subukan ulit po."}
```

---

## GET /api/chat/history/:sessionId

**Response:**
```json
{
  "sessionId": "550e8400-...",
  "messages": [
    { "id": "...", "role": "user", "content": "Kumusta?", "created_at": "..." },
    { "id": "...", "role": "assistant", "content": "Kamusta rin po!", "created_at": "..." }
  ]
}
```

---

## Testing the stream locally

```bash
# 1. Create a session
curl -s -X POST http://localhost:3001/api/chat/session \
  -H "Content-Type: application/json" \
  -d '{}' | jq

# 2. Copy the sessionId, then:
curl -N -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Ano ang benepisyo ng Vitamin C?","sessionId":"YOUR_SESSION_ID"}'
```

---

## Running tests

```bash
node --test tests/chat.test.js
```

---

## Project structure

```
src/
  app.js                  ← Fastify entry point
  plugins/
    security.js           ← CORS + rate limiting
  routes/
    chat.js               ← /api/chat endpoints
  services/
    openaiService.js      ← OpenAI streaming client
    promptService.js      ← Tagalog system prompt builder
    sessionService.js     ← Supabase session + history
  db/
    supabase.js           ← Supabase client singleton
    migration.sql         ← Run once in Supabase SQL Editor
tests/
  chat.test.js
.env.example
```

---

## What's next — Phase 2

Phase 2 adds **Shopify product context** — the backend will query the Shopify Storefront API and inject matching products into the system prompt so Medi can recommend specific Mediko products by name, price, and ingredients.
