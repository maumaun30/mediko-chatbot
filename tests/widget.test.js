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
