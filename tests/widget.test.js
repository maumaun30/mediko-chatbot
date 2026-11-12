import test from 'node:test'
import assert from 'node:assert/strict'

test('validatePrechat requires all three', async () => {
  const { validatePrechat } = await import('../../mediko-widget/src/prechat.js')
  const r = validatePrechat({ name: ' ', email: 'x', phone: '123' })
  assert.equal(r.ok, false)
  assert.deepEqual(Object.keys(r.errors).sort(), ['email', 'name', 'phone'])
  const ok = validatePrechat({ name: 'Maria', email: 'm@e.ph', phone: '0917 123 4567' })
  assert.equal(ok.ok, true)
  assert.equal(ok.value.customerPhone, '0917 123 4567'.replace(/[\s-]/g, ''))
})

test('validatePrechat: error copy, trimming and edge cases', async () => {
  const { validatePrechat } = await import('../../mediko-widget/src/prechat.js')
  const bad = validatePrechat({})
  assert.equal(bad.ok, false)
  assert.equal(bad.errors.name,  'Please enter your name.')
  assert.equal(bad.errors.email, 'Please enter a valid email.')
  assert.equal(bad.errors.phone, 'Please enter a valid mobile number (09XXXXXXXXX).')

  const ok = validatePrechat({ name: '  Ana Cruz ', email: ' ana@mail.com ', phone: '+63917-123-4567' })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.value, { customerName: 'Ana Cruz', customerEmail: 'ana@mail.com', customerPhone: '+639171234567' })

  assert.equal(validatePrechat({ name: 'x'.repeat(101), email: 'a@b.co', phone: '09171234567' }).errors.name, 'Please enter your name.')
  assert.equal(validatePrechat({ name: 'x'.repeat(100), email: 'a@b.co', phone: '09171234567' }).ok, true)
  assert.ok(validatePrechat({ name: 'A', email: 'a@b.co', phone: '0917123456' }).errors.phone, '10 digits rejected')
  assert.ok(validatePrechat({ name: 'A', email: 'a@b.co', phone: '639171234567' }).errors.phone, 'no 09/+639 prefix rejected')
  assert.ok(validatePrechat({ name: 'A', email: 'a b@c.co', phone: '09171234567' }).errors.email)
  assert.deepEqual(Object.keys(validatePrechat({ name: 'A', email: 'bad', phone: '09171234567' }).errors), ['email'])
})

test('readResumeToken', async () => {
  const { readResumeToken } = await import('../../mediko-widget/src/prechat.js')
  assert.equal(readResumeToken('?a=1&mdk_chat=abc.1.sig'), 'abc.1.sig')
  assert.equal(readResumeToken(''), null)
  assert.equal(readResumeToken('?mdk_chat='), null)
  assert.equal(readResumeToken('?other=1'), null)
  assert.equal(readResumeToken(undefined), null)
})

test('reconcileSent renames the temp row to the server id', async () => {
  const { reconcileSent } = await import('../../mediko-widget/src/messages.js')
  const prev = [{ id: 'g', role: 'agent', content: 'hi', ts: 't0' }, { id: 'tmp', role: 'user', content: 'yo', ts: 't1' }]
  const out = reconcileSent(prev, 'tmp', { id: 'srv1', created_at: '2026-11-12 01:02:03' })
  assert.deepEqual(out.map(m => m.id), ['g', 'srv1'])
  assert.equal(out[1].ts, '2026-11-12T01:02:03Z')
  assert.equal(out[1].content, 'yo')
})

test('reconcileSent drops the temp row when a refill already added the server row', async () => {
  const { reconcileSent } = await import('../../mediko-widget/src/messages.js')
  const prev = [
    { id: 'tmp',  role: 'user', content: 'yo', ts: 't1' },
    { id: 'srv1', role: 'user', content: 'yo', ts: '2026-11-12T01:02:03Z' }
  ]
  const out = reconcileSent(prev, 'tmp', { id: 'srv1', created_at: '2026-11-12 01:02:03' })
  assert.deepEqual(out.map(m => m.id), ['srv1'])
  assert.equal(new Set(out.map(m => m.id)).size, out.length, 'ids stay unique')
})

test('reconcileSent without a saved id leaves the list unchanged', async () => {
  const { reconcileSent } = await import('../../mediko-widget/src/messages.js')
  const prev = [{ id: 'tmp', role: 'user', content: 'yo', ts: 't1' }]
  assert.equal(reconcileSent(prev, 'tmp', null), prev)
  assert.equal(reconcileSent(prev, 'tmp', {}), prev)
})

test('appendMissing appends only rows whose id is new, mapped to UI messages', async () => {
  const { appendMissing } = await import('../../mediko-widget/src/messages.js')
  const prev = [{ id: 'a', role: 'user', content: 'x', ts: 't' }]
  assert.equal(appendMissing(prev, [{ id: 'a', role: 'user', content: 'x', created_at: 't' }]), prev)
  const out = appendMissing(prev, [
    { id: 'a', role: 'user', content: 'x', created_at: 't' },
    { id: 'b', role: 'assistant', content: '[Agent] hello', created_at: '2026-11-12 01:00:00' }
  ])
  assert.deepEqual(out.map(m => [m.id, m.role, m.content]), [['a', 'user', 'x'], ['b', 'agent', 'hello']])
})

test('shouldClearSession only on 404', async () => {
  const { shouldClearSession } = await import('../../mediko-widget/src/messages.js')
  assert.equal(shouldClearSession(404), true)
  assert.equal(shouldClearSession(500), false)
  assert.equal(shouldClearSession(503), false)
  assert.equal(shouldClearSession(null), false, 'network error (no status) keeps the session')
  assert.equal(shouldClearSession(undefined), false)
})

test('tokenizeLinks: bare http(s) URLs become links, trailing punctuation stays text', async () => {
  const { tokenizeLinks } = await import('../../mediko-widget/src/linkify.js')
  assert.deepEqual(tokenizeLinks('Track it here: https://track.ph/abc?x=1. Salamat!'), [
    { type: 'text', text: 'Track it here: ' },
    { type: 'link', href: 'https://track.ph/abc?x=1', label: 'https://track.ph/abc?x=1' },
    { type: 'text', text: '. Salamat!' }
  ])
  assert.deepEqual(tokenizeLinks('(see http://a.ph/b)'), [
    { type: 'text', text: '(see ' },
    { type: 'link', href: 'http://a.ph/b', label: 'http://a.ph/b' },
    { type: 'text', text: ')' }
  ])
  const product = tokenizeLinks('https://store.mediko.ph/products/vit-c')
  assert.deepEqual(product, [{ type: 'link', href: 'https://store.mediko.ph/products/vit-c', label: 'https://store.mediko.ph/products/vit-c' }])
})

test('tokenizeLinks: markdown links, product cards and no other schemes', async () => {
  const { tokenizeLinks, safeHref } = await import('../../mediko-widget/src/linkify.js')
  assert.deepEqual(tokenizeLinks('[Order](https://x.ph/o/1) and [Vit C](https://store.mediko.ph/products/c)'), [
    { type: 'link', href: 'https://x.ph/o/1', label: 'Order' },
    { type: 'text', text: ' and ' },
    { type: 'product', href: 'https://store.mediko.ph/products/c', label: 'Vit C' }
  ])
  for (const t of ['javascript:alert(1)', '[x](javascript:alert(1))', 'data:text/html,<b>', 'ftp://x.ph/f', 'mailto:a@b.ph', 'www.mediko.ph']) {
    assert.ok(tokenizeLinks(t).every(tok => tok.type === 'text'), t)
    assert.equal(tokenizeLinks(t).map(tok => tok.text).join(''), t, `${t} kept verbatim`)
  }
  assert.equal(safeHref('javascript:alert(1)'), null)
  assert.equal(safeHref('https://ok.ph'), 'https://ok.ph')
  assert.deepEqual(tokenizeLinks(''), [])
  assert.deepEqual(tokenizeLinks('just text'), [{ type: 'text', text: 'just text' }])
})

test('Message.jsx renders links through tokenizeLinks with safe rel/target', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../../mediko-widget/src/components/Message.jsx', import.meta.url), 'utf8')
  assert.ok(src.includes('tokenizeLinks(text)'))
  assert.ok(!/silently dropped/.test(src))
  assert.match(src, /href=\{tok\.href\} target="_blank" rel="noopener noreferrer"/)
})

test('a 404 on send shows local copy, not the server text', async () => {
  const { SESSION_GONE } = await import('../../mediko-widget/src/messages.js')
  assert.match(SESSION_GONE, /chat has ended/)
  assert.ok(!/session|refresh/i.test(SESSION_GONE))
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../../mediko-widget/src/hooks/useChat.js', import.meta.url), 'utf8')
  const branch = src.slice(src.indexOf('if (res.status === 404) {'), src.indexOf('if (!res.ok) {', src.indexOf('if (res.status === 404) {')))
  assert.ok(branch.includes('setError(SESSION_GONE)'))
  assert.ok(!branch.includes('readError'))
})

test('formatSchedule groups consecutive days with the same hours', async () => {
  const { formatSchedule } = await import('../../mediko-widget/src/schedule.js')
  const day = (d, open, start = null, end = null) => ({ day: d, open, start, end })
  const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri'].map(d => day(d, true, '08:00', '17:00'))
  assert.deepEqual(formatSchedule({ days: [...weekdays, day('sat', false), day('sun', false)] }), [
    { days: 'Mon–Fri', hours: '8:00 AM–5:00 PM' },
    { days: 'Sat–Sun', hours: 'Closed' }
  ])
  assert.deepEqual(formatSchedule({ days: [day('mon', true, '08:00', '17:00'), day('tue', false), day('wed', true, '08:00', '17:00'),
    day('thu', true, '08:00', '17:00'), day('fri', true, '09:30', '12:00'), day('sat', false), day('sun', false)] }), [
    { days: 'Mon', hours: '8:00 AM–5:00 PM' },
    { days: 'Tue', hours: 'Closed' },
    { days: 'Wed–Thu', hours: '8:00 AM–5:00 PM' },
    { days: 'Fri', hours: '9:30 AM–12:00 PM' },
    { days: 'Sat–Sun', hours: 'Closed' }
  ])
  assert.deepEqual(formatSchedule(null), [])
})
