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

test('validatePrechat: Filipino error copy, trimming and edge cases', async () => {
  const { validatePrechat } = await import('../../mediko-widget/src/prechat.js')
  const bad = validatePrechat({})
  assert.equal(bad.ok, false)
  assert.equal(bad.errors.name,  'Pakilagay po ang inyong pangalan.')
  assert.equal(bad.errors.email, 'Pakilagay po ang tamang email.')
  assert.equal(bad.errors.phone, 'Pakilagay po ang tamang mobile number (09XXXXXXXXX).')

  const ok = validatePrechat({ name: '  Ana Cruz ', email: ' ana@mail.com ', phone: '+63917-123-4567' })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.value, { customerName: 'Ana Cruz', customerEmail: 'ana@mail.com', customerPhone: '+639171234567' })

  assert.equal(validatePrechat({ name: 'x'.repeat(101), email: 'a@b.co', phone: '09171234567' }).errors.name, 'Pakilagay po ang inyong pangalan.')
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

test('formatNextOpen formats in Asia/Manila like "Lun 8:00 AM"', async () => {
  const { formatNextOpen } = await import('../../mediko-widget/src/prechat.js')
  // Mon 2026-11-16 08:00 Manila = 00:00 UTC
  assert.equal(formatNextOpen('2026-11-16T00:00:00.000Z'), 'Lun 8:00 AM')
  // Sat 2026-11-14 13:05 Manila = 05:05 UTC
  assert.equal(formatNextOpen('2026-11-14T05:05:00.000Z'), 'Sab 1:05 PM')
  // Sun 2026-11-15 00:30 Manila = Sat 16:30 UTC
  assert.equal(formatNextOpen('2026-11-14T16:30:00.000Z'), 'Lin 12:30 AM')
  assert.equal(formatNextOpen(null), '')
  assert.equal(formatNextOpen('garbage'), '')
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
