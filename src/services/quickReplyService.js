/**
 * quickReplyService.js
 * CRUD for preset quick reply buttons shown in the widget.
 */

import { supabase } from '../db/supabase.js'

let cache     = []
let cacheTime = 0
const TTL_MS  = 5 * 60 * 1000

export async function loadQuickReplies() {
  if (cache.length && Date.now() - cacheTime < TTL_MS) return cache
  const { data, error } = await supabase
    .from('chat_quick_replies')
    .select('id, label, message, sort_order')
    .eq('active', true)
    .order('sort_order')
  if (error) { console.error('[quickReply]', error.message); return cache }
  cache = data || []; cacheTime = Date.now()
  return cache
}

export function invalidateQuickReplyCache() { cache = []; cacheTime = 0 }

export async function getAllQuickReplies() {
  const { data, error } = await supabase
    .from('chat_quick_replies').select('*').order('sort_order')
  if (error) throw new Error(error.message)
  return data || []
}

export async function createQuickReply({ label, message, sort_order = 0 }) {
  const { data, error } = await supabase
    .from('chat_quick_replies')
    .insert({ label: label.trim(), message: message.trim(), sort_order })
    .select().single()
  if (error) throw new Error(error.message)
  invalidateQuickReplyCache(); return data
}

export async function updateQuickReply(id, fields) {
  const updates = {}
  if (fields.label      !== undefined) updates.label      = fields.label.trim()
  if (fields.message    !== undefined) updates.message    = fields.message.trim()
  if (fields.sort_order !== undefined) updates.sort_order = fields.sort_order
  if (fields.active     !== undefined) updates.active     = fields.active
  const { data, error } = await supabase
    .from('chat_quick_replies').update(updates).eq('id', id).select().single()
  if (error) throw new Error(error.message)
  invalidateQuickReplyCache(); return data
}

export async function deleteQuickReply(id) {
  const { error } = await supabase.from('chat_quick_replies').delete().eq('id', id)
  if (error) throw new Error(error.message)
  invalidateQuickReplyCache()
}
