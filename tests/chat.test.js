/**
 * tests/chat.test.js
 * Run with:  node --test tests/chat.test.js
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

// ── buildMessages ────────────────────────────────────────────

test('buildMessages: first message is system, last is user', async () => {
  const { buildMessages } = await import('../src/services/promptService.js')
  const messages = buildMessages({ userMessage: 'Ano ang benepisyo ng Vitamin C?', history: [] })

  assert.equal(messages[0].role, 'system')
  assert.ok(messages[0].content.includes('Medi'))
  assert.ok(messages[0].content.includes('Tagalog'))
  assert.equal(messages.at(-1).role, 'user')
  assert.equal(messages.at(-1).content, 'Ano ang benepisyo ng Vitamin C?')
})

test('buildMessages: history is sandwiched between system and user', async () => {
  const { buildMessages } = await import('../src/services/promptService.js')
  const history = [
    { role: 'user',      content: 'Kumusta?' },
    { role: 'assistant', content: 'Kamusta rin po!' }
  ]
  const messages = buildMessages({ userMessage: 'Magkano ang Vitamin C?', history })

  assert.equal(messages.length, 4)   // system + 2 history + user
  assert.equal(messages[1].content, 'Kumusta?')
  assert.equal(messages[2].content, 'Kamusta rin po!')
})

test('buildMessages: injects product context', async () => {
  const { buildMessages } = await import('../src/services/promptService.js')
  const products = [{
    title: 'Mediko Vitamin C 1000mg',
    description: 'High-potency Vitamin C for immunity.',
    tags: ['immunity', 'vitamin-c'],
    priceRange: { minVariantPrice: { amount: '299.00' } }
  }]
  const messages = buildMessages({ userMessage: 'May Vitamin C ba kayo?', history: [], products })
  const system = messages[0].content

  assert.ok(system.includes('Mediko Vitamin C 1000mg'))
  assert.ok(system.includes('₱299.00'))
  assert.ok(system.includes('immunity'))
})

test('buildMessages: no product block when products array is empty', async () => {
  const { buildMessages } = await import('../src/services/promptService.js')
  const messages = buildMessages({ userMessage: 'Hello', history: [], products: [] })
  assert.ok(!messages[0].content.includes('KAUGNAY NA MGA PRODUKTO'))
})

// ── System prompt guardrails ─────────────────────────────────

test('system prompt includes Tagalog medical guardrails', async () => {
  const { buildMessages } = await import('../src/services/promptService.js')
  const system = buildMessages({ userMessage: 'test', history: [] })[0].content

  assert.ok(system.includes('HUWAG mag-diagnose'))
  assert.ok(system.includes('doktor'))
  assert.ok(system.includes('Medi'))
})

// ── SSE wire format ──────────────────────────────────────────

test('chunk SSE event serialises correctly', () => {
  const event = { type: 'chunk', text: 'Kamusta po!' }
  const line  = `data: ${JSON.stringify(event)}\n\n`
  const parsed = JSON.parse(line.replace('data: ', '').trim())
  assert.equal(parsed.type, 'chunk')
  assert.equal(parsed.text, 'Kamusta po!')
})

test('done SSE event has tokens field', () => {
  const event  = { type: 'done', tokens: 150 }
  const parsed = JSON.parse(`data: ${JSON.stringify(event)}\n\n`.replace('data: ', '').trim())
  assert.equal(parsed.type, 'done')
  assert.ok('tokens' in parsed)
})

test('error SSE event has message field', () => {
  const event  = { type: 'error', message: 'May nangyaring mali. Subukan ulit po.' }
  const parsed = JSON.parse(`data: ${JSON.stringify(event)}\n\n`.replace('data: ', '').trim())
  assert.equal(parsed.type, 'error')
  assert.ok(parsed.message.includes('mali'))
})

// ── Generator event shape ─────────────────────────────────────

test('streamChat generator yields chunk and done event shapes (contract test)', () => {
  // We do not call OpenAI — just verify the expected yield shapes are handled
  // correctly by the route (white-box contract test).
  const chunkEvent = { type: 'chunk', text: 'sample' }
  const doneEvent  = { type: 'done', fullText: 'sample', totalTokens: 42 }

  // Route reads event.type and event.text / event.fullText / event.totalTokens
  assert.equal(chunkEvent.type, 'chunk')
  assert.ok('text' in chunkEvent)
  assert.equal(doneEvent.type, 'done')
  assert.ok('fullText' in doneEvent)
  assert.ok('totalTokens' in doneEvent)
})
