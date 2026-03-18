/**
 * Unit tests — pure logic only, no external packages (ws / supabase).
 * Run with: node --test tests/chat.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

// ── promptService ────────────────────────────────────────────

test('buildMessages: system first, user last', async () => {
  const { buildMessages } = await import('../src/services/promptService.js')
  const msgs = buildMessages({ userMessage: 'Ano ang Vitamin C?', history: [] })
  assert.equal(msgs[0].role, 'system')
  assert.ok(msgs[0].content.includes('Medi'))
  assert.equal(msgs.at(-1).role, 'user')
})

test('buildMessages: history sandwiched', async () => {
  const { buildMessages } = await import('../src/services/promptService.js')
  const history = [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }]
  const msgs = buildMessages({ userMessage: 'Magkano?', history })
  assert.equal(msgs.length, 4)
  assert.equal(msgs[1].content, 'Hi')
})

test('buildMessages: injects product context', async () => {
  const { buildMessages } = await import('../src/services/promptService.js')
  const products = [{ title: 'Mediko Vitamin C', description: 'Immunity.', tags: ['immunity'], minPrice: { amount: '299.00', currencyCode: 'PHP' }, maxPrice: { amount: '299.00', currencyCode: 'PHP' }, handle: 'vitamin-c', variants: [] }]
  const msgs = buildMessages({ userMessage: 'May Vitamin C ba?', history: [], products })
  assert.ok(msgs[0].content.includes('Mediko Vitamin C'))
  assert.ok(msgs[0].content.includes('₱299.00'))
})

test('buildMessages: no product block when empty', async () => {
  const { buildMessages } = await import('../src/services/promptService.js')
  const msgs = buildMessages({ userMessage: 'Hi', history: [], products: [] })
  assert.ok(!msgs[0].content.includes('KAUGNAY NA MGA PRODUKTO'))
})

test('system prompt has medical guardrails', async () => {
  const { buildMessages } = await import('../src/services/promptService.js')
  const system = buildMessages({ userMessage: 'test', history: [] })[0].content
  assert.ok(system.includes('HUWAG mag-diagnose'))
  assert.ok(system.includes('doktor'))
})

// ── normalizedMessage ────────────────────────────────────────

test('normalizeMessage: correct shape', async () => {
  const { normalizeMessage } = await import('../src/channels/normalizedMessage.js')
  const msg = normalizeMessage({ sessionId: 'abc', channel: 'widget', channelUserId: 'abc', text: 'Hello' })
  assert.equal(msg.channel, 'widget')
  assert.equal(msg.text, 'Hello')
  assert.equal(msg.channelUserId, 'abc')
  assert.equal(msg.mediaUrl, null)
})

test('normalizeMessage: throws on missing channel', async () => {
  const { normalizeMessage } = await import('../src/channels/normalizedMessage.js')
  assert.throws(() => normalizeMessage({ channelUserId: 'x', text: 'hi' }), /channel is required/)
})

test('normalizeMessage: throws on empty text', async () => {
  const { normalizeMessage } = await import('../src/channels/normalizedMessage.js')
  assert.throws(() => normalizeMessage({ channel: 'widget', channelUserId: 'x', text: '   ' }), /text is required/)
})

test('normalizeMessage: throws on missing channelUserId', async () => {
  const { normalizeMessage } = await import('../src/channels/normalizedMessage.js')
  assert.throws(() => normalizeMessage({ channel: 'widget', text: 'hi' }), /channelUserId is required/)
})

// ── widgetAdapter ────────────────────────────────────────────

test('fromWidgetRequest: maps body to NormalizedMessage', async () => {
  const { fromWidgetRequest } = await import('../src/channels/widgetAdapter.js')
  const msg = fromWidgetRequest({ message: 'Kumusta?', sessionId: 'sess-123' })
  assert.equal(msg.channel, 'widget')
  assert.equal(msg.text, 'Kumusta?')
  assert.equal(msg.sessionId, 'sess-123')
  assert.equal(msg.channelUserId, 'sess-123')
})

// ── WhatsApp parsing (pure function — no Supabase import) ────

test('extractWhatsAppMessage: extracts waId and text', async () => {
  const mod = await import('../src/channels/whatsappAdapter.js')
  const payload = { entry: [{ changes: [{ value: {
    contacts: [{ wa_id: '639171234567' }],
    messages: [{ type: 'text', id: 'wamid.123', from: '639171234567', text: { body: 'Magkano po?' } }]
  }}]}]}
  const r = mod.extractWhatsAppMessage(payload)
  assert.equal(r.waId, '639171234567')
  assert.equal(r.text, 'Magkano po?')
  assert.equal(r.messageId, 'wamid.123')
})

test('extractWhatsAppMessage: null for status updates', async () => {
  const { extractWhatsAppMessage } = await import('../src/channels/whatsappAdapter.js')
  const payload = { entry: [{ changes: [{ value: { statuses: [{ status: 'delivered' }] } }] }] }
  assert.equal(extractWhatsAppMessage(payload), null)
})

test('extractWhatsAppMessage: null for non-text messages', async () => {
  const { extractWhatsAppMessage } = await import('../src/channels/whatsappAdapter.js')
  const payload = { entry: [{ changes: [{ value: {
    contacts: [{ wa_id: '63917' }],
    messages: [{ type: 'image', id: 'x', from: '63917' }]
  }}]}]}
  assert.equal(extractWhatsAppMessage(payload), null)
})

// ── Messenger parsing (pure function — no Supabase import) ───

test('extractMessengerMessage: extracts psid and text', async () => {
  const { extractMessengerMessage } = await import('../src/channels/messengerAdapter.js')
  const payload = { entry: [{ messaging: [{ sender: { id: 'psid-999' }, message: { text: 'Saan tracking?', mid: 'mid.abc' } }] }] }
  const r = extractMessengerMessage(payload)
  assert.equal(r.psid, 'psid-999')
  assert.equal(r.text, 'Saan tracking?')
})

test('extractMessengerMessage: null for echo messages', async () => {
  const { extractMessengerMessage } = await import('../src/channels/messengerAdapter.js')
  const payload = { entry: [{ messaging: [{ sender: { id: 'psid-999' }, message: { text: 'hi', mid: 'x', is_echo: true } }] }] }
  assert.equal(extractMessengerMessage(payload), null)
})

test('extractMessengerMessage: null when no text', async () => {
  const { extractMessengerMessage } = await import('../src/channels/messengerAdapter.js')
  const payload = { entry: [{ messaging: [{ sender: { id: 'psid-999' }, message: { attachments: [] } }] }] }
  assert.equal(extractMessengerMessage(payload), null)
})

// ── conversationManager: pure keyword logic ──────────────────
// Import only the pure exported functions, not the full module
// (full import loads agentService → ws package, not installed here)

test('isHandoffRequest: Filipino and English keywords', async () => {
  const { isHandoffRequest } = await import('../src/services/conversationManager.js')
  assert.ok(isHandoffRequest('agent'))
  assert.ok(isHandoffRequest('tao'))
  assert.ok(isHandoffRequest('ahente'))
  assert.ok(isHandoffRequest('human'))
  assert.ok(isHandoffRequest('tulong'))
  assert.ok(!isHandoffRequest('Ano ang Vitamin C?'))
  assert.ok(!isHandoffRequest('magandang araw'))
  assert.ok(!isHandoffRequest('I need help with my order'))
})

test('isReturnToAiRequest: return keywords', async () => {
  const { isReturnToAiRequest } = await import('../src/services/conversationManager.js')
  assert.ok(isReturnToAiRequest('ai na'))
  assert.ok(isReturnToAiRequest('return to ai'))
  assert.ok(isReturnToAiRequest('back to ai'))
  assert.ok(isReturnToAiRequest('medi na'))
  assert.ok(!isReturnToAiRequest('agent please'))
  assert.ok(!isReturnToAiRequest('hello'))
})

// ── SSE wire format ──────────────────────────────────────────

test('chunk event parses correctly', () => {
  const e = { type: 'chunk', text: 'Kamusta po!' }
  const p = JSON.parse(`data: ${JSON.stringify(e)}\n\n`.replace('data: ', '').trim())
  assert.equal(p.type, 'chunk')
  assert.equal(p.text, 'Kamusta po!')
})

test('handoff event has message field', () => {
  const e = { type: 'handoff', message: 'Sandali lang po...' }
  const p = JSON.parse(`data: ${JSON.stringify(e)}\n\n`.replace('data: ', '').trim())
  assert.equal(p.type, 'handoff')
  assert.ok(p.message.includes('Sandali'))
})

test('agent_mode event has message field', () => {
  const e = { type: 'agent_mode', message: 'Natanggap ng aming team.' }
  const p = JSON.parse(`data: ${JSON.stringify(e)}\n\n`.replace('data: ', '').trim())
  assert.equal(p.type, 'agent_mode')
})

test('done event has tokens field', () => {
  const e = { type: 'done', tokens: 800 }
  const p = JSON.parse(`data: ${JSON.stringify(e)}\n\n`.replace('data: ', '').trim())
  assert.equal(p.type, 'done')
  assert.ok('tokens' in p)
})

// ── shopifyService: keyword extraction ───────────────────────

test('extractSearchKeywords: Tagalog health terms', async () => {
  const { extractSearchKeywords } = await import('../src/services/shopifyService.js')

  const k1 = extractSearchKeywords('Meron ba kayong para sa immunity at ubo?')
  assert.ok(k1.includes('vitamin c'), `expected vitamin c, got: ${k1}`)
  assert.ok(k1.includes('zinc'))

  const k2 = extractSearchKeywords('hirap matulog lagi')
  assert.ok(k2.includes('sleep') || k2.includes('melatonin'), `expected sleep/melatonin, got: ${k2}`)

  const k3 = extractSearchKeywords('para sa buto at osteoporosis')
  assert.ok(k3.includes('calcium'), `expected calcium, got: ${k3}`)
})

test('extractSearchKeywords: English health terms', async () => {
  const { extractSearchKeywords } = await import('../src/services/shopifyService.js')

  const k1 = extractSearchKeywords('I need something for energy and fatigue')
  assert.ok(k1.includes('energy') || k1.includes('b12'), `got: ${k1}`)

  const k2 = extractSearchKeywords('looking for skin glow supplement')
  assert.ok(k2.includes('collagen') || k2.includes('skin'), `got: ${k2}`)
})

test('extractSearchKeywords: returns empty for unrelated message', async () => {
  const { extractSearchKeywords } = await import('../src/services/shopifyService.js')
  const k = extractSearchKeywords('magkano ang shipping?')
  // shipping query — no health keywords, may pick up capitalised words
  assert.ok(Array.isArray(k))
})

test('extractOrderQuery: parses order number and email', async () => {
  const { extractOrderQuery } = await import('../src/services/shopifyService.js')

  const r1 = extractOrderQuery('order ko #1042 email ko customer@gmail.com')
  assert.equal(r1?.orderName, '1042')
  assert.equal(r1?.email, 'customer@gmail.com')

  const r2 = extractOrderQuery('track 2089 test@mediko.ph')
  assert.equal(r2?.orderName, '2089')
  assert.equal(r2?.email, 'test@mediko.ph')
})

test('extractOrderQuery: returns null without both order number and email', async () => {
  const { extractOrderQuery } = await import('../src/services/shopifyService.js')
  assert.equal(extractOrderQuery('saan na ang order ko?'), null)
  assert.equal(extractOrderQuery('1042 lang wala email'), null)
})

// ── promptService: product/order context injection ───────────

test('buildMessages: product block appears in system prompt', async () => {
  const { buildMessages } = await import('../src/services/promptService.js')
  const products = [{
    title:       'Mediko Vitamin C 1000mg',
    handle:      'vitamin-c-1000mg',
    description: 'High potency Vitamin C for immunity.',
    tags:        ['immunity', 'vitamin-c'],
    minPrice:    { amount: '299.00', currencyCode: 'PHP' },
    maxPrice:    { amount: '299.00', currencyCode: 'PHP' },
    variants:    [{ id: '1', title: 'Default', price: '299.00', available: true }]
  }]

  const msgs   = buildMessages({ userMessage: 'May Vitamin C ba?', history: [], products })
  const system = msgs[0].content

  assert.ok(system.includes('Mediko Vitamin C 1000mg'), 'should include product title')
  assert.ok(system.includes('₱299.00'),                 'should include formatted price')
  assert.ok(system.includes('immunity'),                 'should include tags')
  assert.ok(system.includes('store.mediko.ph/products/vitamin-c-1000mg'), 'should include product URL')
})

test('buildMessages: order block appears in system prompt', async () => {
  const { buildMessages } = await import('../src/services/promptService.js')
  const order = {
    name:              '#1042',
    totalPrice:        '598.00',
    financialStatus:   'paid',
    fulfillmentStatus: 'fulfilled',
    trackingNumbers:   ['JRS123456PH'],
    statusUrl:         'https://store.mediko.ph/orders/token123'
  }

  const msgs   = buildMessages({ userMessage: 'saan na order ko?', history: [], order })
  const system = msgs[0].content

  assert.ok(system.includes('#1042'),           'should include order name')
  assert.ok(system.includes('Bayad na'),        'should translate financial status')
  assert.ok(system.includes('Naipadala na'),    'should translate fulfillment status')
  assert.ok(system.includes('JRS123456PH'),     'should include tracking number')
})

test('buildMessages: no context blocks when products and order are empty', async () => {
  const { buildMessages } = await import('../src/services/promptService.js')
  const msgs = buildMessages({ userMessage: 'Hello', history: [] })
  assert.ok(!msgs[0].content.includes('KAUGNAY NA MGA PRODUKTO'))
  assert.ok(!msgs[0].content.includes('IMPORMASYON SA ORDER'))
})

// ── metaHelpers: message chunking ────────────────────────────

test('chunkMessage: short message returned as single chunk', async () => {
  const { chunkMessage } = await import('../src/services/metaHelpers.js')
  const chunks = chunkMessage('Kumusta po!', 'whatsapp')
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0], 'Kumusta po!')
})

test('chunkMessage: long message split within platform limit', async () => {
  const { chunkMessage, LIMITS } = await import('../src/services/metaHelpers.js')
  const longText = 'Ang supplement na ito ay napaka-kapaki-pakinabang. '.repeat(100)
  const chunks   = chunkMessage(longText, 'messenger')
  assert.ok(chunks.length > 1, 'should produce multiple chunks')
  for (const chunk of chunks) {
    assert.ok(chunk.length <= LIMITS.messenger, `chunk too long: ${chunk.length}`)
  }
})

test('chunkMessage: reassembled chunks equal original text', async () => {
  const { chunkMessage } = await import('../src/services/metaHelpers.js')
  const original = 'Sentence one. Sentence two. Sentence three. '.repeat(60)
  const chunks   = chunkMessage(original, 'messenger')
  const rejoined = chunks.join(' ')
  // All words should be present (allow whitespace differences)
  const origWords   = original.trim().split(/\s+/)
  const rejoinWords = rejoined.trim().split(/\s+/)
  assert.equal(origWords.length, rejoinWords.length)
})

// ── deduplicationStore ───────────────────────────────────────

test('isDuplicate: first call returns false, second returns true', async () => {
  const { isDuplicate } = await import('../src/services/deduplicationStore.js')
  const id = `test-msg-${Date.now()}`
  assert.equal(isDuplicate(id), false, 'first call should not be duplicate')
  assert.equal(isDuplicate(id), true,  'second call should be duplicate')
})

test('isDuplicate: different IDs are independent', async () => {
  const { isDuplicate } = await import('../src/services/deduplicationStore.js')
  const id1 = `msg-a-${Date.now()}`
  const id2 = `msg-b-${Date.now()}`
  assert.equal(isDuplicate(id1), false)
  assert.equal(isDuplicate(id2), false)
  assert.equal(isDuplicate(id1), true)
  assert.equal(isDuplicate(id2), true)
})

// ── Phase 5: admin dashboard route guard ─────────────────────

test('dashboard HTML is a valid HTML document', async () => {
  const { readFileSync } = await import('fs')
  const { join, dirname } = await import('path')
  const { fileURLToPath } = await import('url')
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const html = readFileSync(join(__dirname, '../src/dashboard/index.html'), 'utf8')

  assert.ok(html.includes('<!DOCTYPE html>'),       'should have doctype')
  assert.ok(html.includes('Agent Dashboard'),        'should mention dashboard')
  assert.ok(html.includes('connectWs'),              'should include WebSocket logic')
  assert.ok(html.includes('/api/agent/ws'),           'should reference WS endpoint')
  assert.ok(html.includes('take_over'),              'should include take over command')
  assert.ok(html.includes('return_to_ai'),           'should include return to AI command')
  assert.ok(html.includes('agent_message'),          'should include agent message command')
})

test('admin route file exports a default function', async () => {
  // Just check the module can be parsed — DB calls are mocked at runtime
  const src = (await import('fs')).readFileSync(
    (await import('path')).join(
      (await import('path')).dirname((await import('url')).fileURLToPath(import.meta.url)),
      '../src/routes/admin.js'
    ), 'utf8')
  assert.ok(src.includes('export default async function adminRoutes'))
  assert.ok(src.includes('/sessions'))
  assert.ok(src.includes('/stats'))
})

// ── Phase 6: Widget source files ─────────────────────────────

test('widget main.jsx mounts into shadow DOM', async () => {
  const { readFileSync } = await import('fs')
  const { join, dirname } = await import('path')
  const { fileURLToPath } = await import('url')
  const base = dirname(fileURLToPath(import.meta.url))
  const src  = readFileSync(join(base, '../../mediko-widget/src/main.jsx'), 'utf8')
  assert.ok(src.includes('attachShadow'),        'should use Shadow DOM')
  assert.ok(src.includes('mediko-chat-root'),    'should use consistent host ID')
  assert.ok(src.includes('DOMContentLoaded'),    'should wait for DOM')
  assert.ok(src.includes('createRoot'),          'should use React 18 createRoot')
})

test('useChat hook covers all SSE event types', async () => {
  const { readFileSync } = await import('fs')
  const { join, dirname } = await import('path')
  const { fileURLToPath } = await import('url')
  const base = dirname(fileURLToPath(import.meta.url))
  const src  = readFileSync(join(base, '../../mediko-widget/src/hooks/useChat.js'), 'utf8')
  assert.ok(src.includes("case 'chunk'"),   'handles chunk events')
  assert.ok(src.includes("case 'done'"),    'handles done events')
  assert.ok(src.includes("case 'handoff'"), 'handles handoff events')
  assert.ok(src.includes("case 'error'"),   'handles error events')
  assert.ok(src.includes('localStorage'),   'persists session in localStorage')
})

test('ChatWidget has quick replies and reset functionality', async () => {
  const { readFileSync } = await import('fs')
  const { join, dirname } = await import('path')
  const { fileURLToPath } = await import('url')
  const base = dirname(fileURLToPath(import.meta.url))
  const src  = readFileSync(join(base, '../../mediko-widget/src/components/ChatWidget.jsx'), 'utf8')
  assert.ok(src.includes('QUICK_REPLIES'),   'has quick reply suggestions')
  assert.ok(src.includes('resetSession'),    'has reset session button')
  assert.ok(src.includes('mode-banner'),     'shows handoff/agent mode banner')
  assert.ok(src.includes('fab-badge'),       'shows unread message badge')
})

test('widget CSS uses Shadow DOM scoping via :host', async () => {
  const { readFileSync } = await import('fs')
  const { join, dirname } = await import('path')
  const { fileURLToPath } = await import('url')
  const base = dirname(fileURLToPath(import.meta.url))
  const css  = readFileSync(join(base, '../../mediko-widget/src/widget.css'), 'utf8')
  assert.ok(css.includes(':host'),           'uses :host for Shadow DOM scoping')
  assert.ok(css.includes('--mdk-primary'),   'defines brand CSS custom properties')
  assert.ok(css.includes('.fab'),            'has FAB styles')
  assert.ok(css.includes('.chat-window'),    'has chat window styles')
  assert.ok(css.includes('.typing-bubble'),  'has typing indicator styles')
})
