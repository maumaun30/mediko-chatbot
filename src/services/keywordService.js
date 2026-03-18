/**
 * keywordService.js
 *
 * Loads keyword→search_term mappings from Supabase.
 * Cached in memory for 5 minutes so each chat message doesn't hit the DB.
 * Cache is invalidated whenever keywords are saved via the dashboard.
 */

import { supabase } from '../db/supabase.js'

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

  const { data, error } = await supabase
    .from('chat_keywords')
    .select('pattern, search_term, category')
    .eq('active', true)
    .order('category')
    .order('pattern')

  if (error) {
    console.error('[keywordService] Failed to load keywords:', error.message)
    return cache   // return stale cache rather than crashing
  }

  cache     = data || []
  cacheTime = Date.now()
  return cache
}

/** Force-invalidate the cache (call after any CRUD operation). */
export function invalidateKeywordCache() {
  cache     = []
  cacheTime = 0
}

// ── CRUD ─────────────────────────────────────────────────────

export async function getAllKeywords() {
  const { data, error } = await supabase
    .from('chat_keywords')
    .select('*')
    .order('category')
    .order('pattern')
  if (error) throw new Error(error.message)
  return data || []
}

export async function createKeyword({ pattern, search_term, category = 'health' }) {
  const { data, error } = await supabase
    .from('chat_keywords')
    .insert({ pattern: pattern.toLowerCase().trim(), search_term: search_term.toLowerCase().trim(), category })
    .select()
    .single()
  if (error) throw new Error(error.message)
  invalidateKeywordCache()
  return data
}

export async function updateKeyword(id, fields) {
  const updates = {}
  if (fields.pattern    !== undefined) updates.pattern    = fields.pattern.toLowerCase().trim()
  if (fields.search_term!== undefined) updates.search_term= fields.search_term.toLowerCase().trim()
  if (fields.category   !== undefined) updates.category   = fields.category
  if (fields.active     !== undefined) updates.active      = fields.active
  updates.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('chat_keywords')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  invalidateKeywordCache()
  return data
}

export async function deleteKeyword(id) {
  const { error } = await supabase
    .from('chat_keywords')
    .delete()
    .eq('id', id)
  if (error) throw new Error(error.message)
  invalidateKeywordCache()
}
