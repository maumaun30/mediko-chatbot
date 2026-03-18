/**
 * dashboard.js
 *
 * Serves the admin dashboard HTML at /dashboard.
 * Optionally protected by ADMIN_SECRET query param.
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const HTML = readFileSync(join(__dirname, '../dashboard/index.html'), 'utf8')

export default async function dashboardRoutes(fastify) {

  fastify.get('/dashboard', async (request, reply) => {
    const secret = process.env.ADMIN_SECRET
    if (secret) {
      const token = request.query.secret ?? request.headers['x-admin-secret']
      if (token !== secret) {
        return reply
          .status(401)
          .header('Content-Type', 'text/html')
          .send('<h2>401 — Add ?secret=YOUR_ADMIN_SECRET to the URL</h2>')
      }
    }
    return reply.header('Content-Type', 'text/html').send(HTML)
  })

}
