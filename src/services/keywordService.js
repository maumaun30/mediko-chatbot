/**
 * keywordService.js
 *
 * Loads keyword→search_term mappings from MySQL.
 * Cached in memory for 5 minutes so each chat message doesn't hit the DB.
 * Cache is invalidated whenever keywords are saved via the dashboard.
 */

import { randomUUID } from 'crypto'
import { query, queryOne } from '../db/mysql.js'

/** @type {{ pattern: string, search_term: string, category: string }[]} */
let cache     = []
let cacheTime = 0
const TTL_MS  = 5 * 60 * 1000   // 5 minutes

/**
 * Load all active keywords, using the in-memory cache when fresh.
 * @returns {Promise<{ pattern: string, search_term: string, category: string }[]>}
 */
export async function loadKeywords() {
  if (cache.length && Date.now() - cacheTime < TTL_MS) return cache

  try {
    cache = await query(
      `SELECT pattern, search_term, category FROM chat_keywords
       WHERE active = 1 ORDER BY category, pattern`
    )
    cacheTime = Date.now()
    return cache
  } catch (err) {
    console.error('[keywordService] Failed to load keywords:', err.message)
    return cache   // return stale cache rather than crashing
  }
}

/** Force-invalidate the cache (call after any CRUD operation). */
export function invalidateKeywordCache() {
  cache     = []
  cacheTime = 0
}

// ── CRUD ─────────────────────────────────────────────────────

export async function getAllKeywords() {
  return query(`SELECT * FROM chat_keywords ORDER BY category, pattern`)
}

export async function createKeyword({ pattern, search_term, category = 'health' }) {
  const id = randomUUID()
  await query(
    `INSERT INTO chat_keywords (id, pattern, search_term, category) VALUES (?, ?, ?, ?)`,
    [id, pattern.toLowerCase().trim(), search_term.toLowerCase().trim(), category]
  )
  invalidateKeywordCache()
  return queryOne(`SELECT * FROM chat_keywords WHERE id = ?`, [id])
}

export async function updateKeyword(id, fields) {
  const sets   = []
  const params = []
  if (fields.pattern     !== undefined) { sets.push('pattern = ?');     params.push(fields.pattern.toLowerCase().trim()) }
  if (fields.search_term !== undefined) { sets.push('search_term = ?'); params.push(fields.search_term.toLowerCase().trim()) }
  if (fields.category    !== undefined) { sets.push('category = ?');    params.push(fields.category) }
  if (fields.active      !== undefined) { sets.push('active = ?');      params.push(fields.active ? 1 : 0) }
  sets.push('updated_at = ?'); params.push(new Date())
  params.push(id)

  await query(`UPDATE chat_keywords SET ${sets.join(', ')} WHERE id = ?`, params)
  invalidateKeywordCache()
  return queryOne(`SELECT * FROM chat_keywords WHERE id = ?`, [id])
}

export async function deleteKeyword(id) {
  await query(`DELETE FROM chat_keywords WHERE id = ?`, [id])
  invalidateKeywordCache()
}
