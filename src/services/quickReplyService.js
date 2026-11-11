/**
 * quickReplyService.js
 * CRUD for preset quick reply buttons shown in the widget.
 */

import { randomUUID } from 'crypto'
import { query, queryOne } from '../db/mysql.js'

let cache     = []
let cacheTime = 0
const TTL_MS  = 5 * 60 * 1000

export async function loadQuickReplies() {
  if (cache.length && Date.now() - cacheTime < TTL_MS) return cache
  try {
    cache = await query(
      `SELECT id, label, message, sort_order FROM chat_quick_replies
       WHERE active = 1 ORDER BY sort_order`
    )
    cacheTime = Date.now()
    return cache
  } catch (err) {
    console.error('[quickReply]', err.message)
    return cache
  }
}

export function invalidateQuickReplyCache() { cache = []; cacheTime = 0 }

export async function getAllQuickReplies() {
  return query(`SELECT * FROM chat_quick_replies ORDER BY sort_order`)
}

export async function createQuickReply({ label, message, sort_order = 0 }) {
  const id = randomUUID()
  await query(
    `INSERT INTO chat_quick_replies (id, label, message, sort_order) VALUES (?, ?, ?, ?)`,
    [id, label.trim(), message.trim(), sort_order]
  )
  invalidateQuickReplyCache()
  return queryOne(`SELECT * FROM chat_quick_replies WHERE id = ?`, [id])
}

export async function updateQuickReply(id, fields) {
  const sets   = []
  const params = []
  if (fields.label      !== undefined) { sets.push('label = ?');      params.push(fields.label.trim()) }
  if (fields.message    !== undefined) { sets.push('message = ?');    params.push(fields.message.trim()) }
  if (fields.sort_order !== undefined) { sets.push('sort_order = ?'); params.push(fields.sort_order) }
  if (fields.active     !== undefined) { sets.push('active = ?');     params.push(fields.active ? 1 : 0) }
  if (!sets.length) return queryOne(`SELECT * FROM chat_quick_replies WHERE id = ?`, [id])
  params.push(id)

  await query(`UPDATE chat_quick_replies SET ${sets.join(', ')} WHERE id = ?`, params)
  invalidateQuickReplyCache()
  return queryOne(`SELECT * FROM chat_quick_replies WHERE id = ?`, [id])
}

export async function deleteQuickReply(id) {
  await query(`DELETE FROM chat_quick_replies WHERE id = ?`, [id])
  invalidateQuickReplyCache()
}
