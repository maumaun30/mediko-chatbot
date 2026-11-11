/**
 * mysql.js
 *
 * MySQL connection pool (replaces the old Supabase client).
 *
 * Config comes from env:
 *   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
 *
 * Notes on options:
 *   - dateStrings: true  → DATETIME/TIMESTAMP columns come back as
 *     'YYYY-MM-DD HH:MM:SS' strings (analytics/admin slice these), not JS Dates.
 *   - timezone: 'Z'      → JS Date params are written as UTC. The DB container
 *     also runs in UTC (TZ=UTC), so everything stays consistent.
 *   - JSON columns are parsed to JS objects on read by mysql2 automatically;
 *     on write we JSON.stringify ourselves (see services).
 */

import mysql from 'mysql2/promise'

const pool = mysql.createPool({
  host:               process.env.DB_HOST     || '127.0.0.1',
  port:     parseInt(process.env.DB_PORT      || '3306', 10),
  user:               process.env.DB_USER     || 'mediko',
  password:           process.env.DB_PASSWORD || '',
  database:           process.env.DB_NAME     || 'mediko_chat',
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
  dateStrings:        true,
  timezone:           'Z',
  charset:            'utf8mb4'
})

/**
 * Run a parameterised query and return the rows.
 * @param {string} sql
 * @param {any[]}  [params]
 * @returns {Promise<any[]>}
 */
export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params)
  return rows
}

/**
 * Run a query and return just the first row (or null).
 * @param {string} sql
 * @param {any[]}  [params]
 * @returns {Promise<any|null>}
 */
export async function queryOne(sql, params = []) {
  const rows = await query(sql, params)
  return rows[0] ?? null
}

export { pool }
export default pool
