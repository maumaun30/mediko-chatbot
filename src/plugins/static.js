/**
 * static.js — serve the built widget bundle from Fastify
 *
 * Install: npm install @fastify/static
 * Then copy mediko-widget/dist/mediko-chat.iife.js
 *      to   mediko-chat-api/public/mediko-chat.iife.js
 *
 * The file is then served at:
 *   GET /static/mediko-chat.iife.js
 *
 * Add this registration to src/app.js:
 *   import staticPlugin from './plugins/static.js'
 *   await fastify.register(staticPlugin)
 */

import fp from 'fastify-plugin'
import fastifyStatic from '@fastify/static'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync, mkdirSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = join(__dirname, '../../public')

export default fp(async function staticFiles(fastify) {
  // Create public dir if it doesn't exist yet
  if (!existsSync(PUBLIC_DIR)) mkdirSync(PUBLIC_DIR, { recursive: true })

  await fastify.register(fastifyStatic, {
    root:   PUBLIC_DIR,
    prefix: '/static/',
    // Allow cross-origin loads from Shopify storefront
    setHeaders: (res) => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Cache-Control', 'public, max-age=86400')  // 1 day cache
    }
  })
})
