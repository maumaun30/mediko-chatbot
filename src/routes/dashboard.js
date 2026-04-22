/**
 * dashboard.js
 *
 * Serves the admin dashboard HTML at /dashboard.
 * The HTML is public; auth happens client-side via a login overlay
 * that validates the password against an authed API endpoint and stores
 * it in sessionStorage. All /api/admin/* and /api/{keywords,quick-replies,
 * analytics,settings}/* routes are gated by ADMIN_SECRET.
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const HTML = readFileSync(join(__dirname, '../dashboard/index.html'), 'utf8')

export default async function dashboardRoutes(fastify) {

  fastify.get('/dashboard', async (request, reply) => {
    return reply.header('Content-Type', 'text/html').send(HTML)
  })

}
