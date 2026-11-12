import test from 'node:test'
import assert from 'node:assert/strict'
import { validatePreview } from '../src/services/linkPreview.js'

const HOSTS = ['store.mediko.ph', 'mediko.ph']
const good = {
  url: 'https://store.mediko.ph/products/genacol-90s',
  title: 'Genacol 90s',
  description: 'Collagen supplement',
  image: 'https://cdn.shopify.com/s/files/1/genacol.jpg',
  price: '1899.00',
  currency: 'PHP'
}

test('validatePreview accepts a store product preview and keeps only known fields', () => {
  const r = validatePreview({ ...good, extra: 'x' }, HOSTS)
  assert.equal(r.ok, true)
  assert.deepEqual(r.preview, good)
})

test('validatePreview: missing/empty preview is not an error', () => {
  assert.deepEqual(validatePreview(undefined, HOSTS), { ok: true, preview: null })
  assert.deepEqual(validatePreview(null, HOSTS), { ok: true, preview: null })
})

test('validatePreview rejects other hosts, non-https, bad image hosts and oversize fields', () => {
  assert.equal(validatePreview({ ...good, url: 'https://evil.example/products/x' }, HOSTS).ok, false)
  assert.equal(validatePreview({ ...good, url: 'http://store.mediko.ph/products/x' }, HOSTS).ok, false)
  assert.equal(validatePreview({ ...good, url: 'javascript:alert(1)' }, HOSTS).ok, false)
  assert.equal(validatePreview({ ...good, image: 'https://evil.example/a.jpg' }, HOSTS).ok, false)
  assert.equal(validatePreview({ ...good, title: '' }, HOSTS).ok, false)
  assert.equal(validatePreview({ ...good, title: 'x'.repeat(201) }, HOSTS).ok, false)
  assert.equal(validatePreview({ ...good, price: 'abc' }, HOSTS).ok, false)
  assert.equal(validatePreview('nope', HOSTS).ok, false)
})

test('validatePreview: image, description, price are optional', () => {
  const r = validatePreview({ url: good.url, title: 'Genacol' }, HOSTS)
  assert.deepEqual(r, { ok: true, preview: { url: good.url, title: 'Genacol', description: null, image: null, price: null, currency: null } })
})
