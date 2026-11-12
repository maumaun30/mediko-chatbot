# ── Mediko Chat API ─────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Install production deps first (better layer caching)
COPY package*.json ./
RUN npm ci --omit=dev

# App source
COPY . .

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001

EXPOSE 3001

# Lightweight healthcheck against the /health route
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/app.js"]
