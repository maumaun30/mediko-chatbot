# Mediko Chat API — Docker & CloudPanel deployment

The API runs on **MySQL** and ships with a Docker Compose stack: the Fastify
API + a MySQL 8 database. It is a human-only live-agent chat (`AI_ENABLED=false`).
Agent replies reach the widget over the API's own SSE stream
(`/api/chat/listen/:sessionId`); staff use the inbox embedded in the Mediko
gateway and connect to `WS /api/agent/ws`. The old standalone `/dashboard` and
`ADMIN_SECRET` are gone.

**Run exactly one instance** (`instances: 1`, fork mode — see
`ecosystem.config.cjs`). Presence, agent sockets, the offline-reply queue and
the alert scheduler are in-memory; cluster mode or a second replica would split
connections and send duplicate alerts.

---

## 1. Local development

Two ways to run it:

### A. Everything in Docker (closest to production)

```bash
cd mediko-chatbot
cp .env.example .env          # fill in DB_*, CHAT_AGENT_SECRET, GATEWAY_*, ALLOWED_ORIGINS
docker compose up --build
```

- API  → http://localhost:3001
- MySQL → localhost:3306 (schema + seeds auto-loaded on first start)

The widget runs separately on the host:

```bash
cd ../mediko-widget && npm run dev   # http://localhost:5173
```

### B. DB in Docker, API + widget on the host (hot reload)

```bash
cd mediko-chatbot && docker compose up -d db    # just MySQL
./start-dev.sh                                  # from repo root: API + widget
```

`start-dev.sh` brings up the `db` container automatically if Docker is running.

The widget is pre-pointed at the local API via `mediko-widget/.env.development.local`.

---

## 2. Deploying to a CloudPanel VPS with Docker

CloudPanel's own Nginx owns ports **80/443**, so the container must **not**
publish there. Instead the container binds to `127.0.0.1:3001` and CloudPanel
reverse-proxies a domain to it (with free Let's Encrypt SSL).

### Step 1 — install Docker on the VPS

CloudPanel runs on Debian 12 / Ubuntu 22.04–24.04. Install Docker Engine + the
compose plugin (does not conflict with CloudPanel):

```bash
curl -fsSL https://get.docker.com | sh
docker compose version
```

### Step 2 — ship the code & secrets

```bash
git clone <your-repo> /opt/mediko-chatbot
cd /opt/mediko-chatbot
cp .env.example .env
# Edit .env — set strong DB_PASSWORD / DB_ROOT_PASSWORD and the chat vars below.
```

Required environment (must match the gateway's `.env` where noted):

| Variable | Value |
|----------|-------|
| `CHAT_AGENT_SECRET` | 32+ random chars, **identical in the gateway `.env`**. Signs agent JWTs, customer link tokens and chat events |
| `ALLOWED_ORIGINS` | `https://store.mediko.ph,<gateway origin>` (CORS allow-list) |
| `GATEWAY_URL` | Gateway base URL for `POST /internal/chat-events` |
| `GATEWAY_ORIGIN` | Exact gateway origin the agent WebSocket accepts (unset = all agent sockets rejected) |
| `CHAT_CUSTOMER_URL` | Storefront page with the widget; used in emailed `?mdk_chat=` links |
| `AI_ENABLED` | `false` |
| `TRUST_PROXY` | Proxy hops trusted for the client IP (rate limits key on it). Default `loopback`. **With docker compose set `loopback,172.16.0.0/12`**: nginx reaches the container from the docker bridge gateway, not 127.0.0.1, and without this every customer shares one rate-limit bucket |

Staff alerts and offline-reply emails are sent by the gateway; if the secret or
`GATEWAY_URL` is missing the chat service logs and skips them (chat still works).

The compose file already binds the API to `127.0.0.1:3001` only, and reads
secrets from `.env`. Bring it up:

```bash
docker compose up -d --build
docker compose logs -f api      # confirm "Server listening"
curl -s http://127.0.0.1:3001/health
```

### Step 3 — CloudPanel reverse proxy

In the CloudPanel UI:

1. **Sites → + Add Site → Create a Reverse Proxy.**
2. Domain: e.g. `api.mediko.ph` (or `mediko-chatbot.<yourdomain>`).
3. Reverse Proxy URL: `http://127.0.0.1:3001`.
4. Issue a Let's Encrypt certificate for the domain (SSL tab).

CloudPanel's Nginx config for the proxy must forward upgrade headers so the
**agent WebSocket** (`/api/agent/ws`, which also checks the `Origin` header) and **SSE** streams work. Add to the
vhost (Vhost tab) inside the proxy `location` block if not present:

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_set_header Host $host;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;   # real client IP (see TRUST_PROXY)
proxy_read_timeout 3600s;     # keep long-lived SSE/WS alive
proxy_buffering off;          # required for SSE streaming
```

### Step 4 — point the widget at the deployed API

Build the widget with the production API URL and redeploy the bundle to Shopify:

```bash
cd mediko-widget
echo "VITE_API_URL=https://api.mediko.ph" > .env.production.local
npm run build      # dist/mediko-chat.iife.js
```

---

## 3. Database notes

- Schema + seed data live in [`src/db/schema.sql`](src/db/schema.sql) and load
  automatically on the **first** start of the MySQL container (empty volume).
- Data persists in the `db_data` named volume across restarts.
- To reset the DB: `docker compose down -v` (⚠ deletes all data), then `up`.
- Backups: `docker compose exec db mysqldump -u root -p"$DB_ROOT_PASSWORD" mediko_chat > backup.sql`
- The API generates UUIDs in Node and stores timestamps in UTC.
