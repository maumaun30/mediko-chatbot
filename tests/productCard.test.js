import test from 'node:test'
import assert from 'node:assert/strict'

const load = () => import('../../mediko-widget/src/product.js')
const good = {
  url: 'https://store.mediko.ph/products/genacol-90s',
  title: 'Genacol 90s',
  image: 'https://cdn.shopify.com/s/files/1/genacol.jpg',
  price: '1899.00',
  currency: 'PHP'
}

test('safePreview keeps a valid preview (only known fields)', async () => {
  const { safePreview } = await load()
  assert.deepEqual(safePreview({ ...good, description: 'x', evil: '<b>' }), good)
})

test('safePreview drops unsafe or incomplete previews', async () => {
  const { safePreview } = await load()
  assert.equal(safePreview(null), null)
  assert.equal(safePreview({ ...good, url: 'javascript:alert(1)' }), null)
  assert.equal(safePreview({ ...good, url: 'http://store.mediko.ph/products/x' }), null)
  assert.equal(safePreview({ ...good, title: '' }), null)
  assert.equal(safePreview({ ...good, image: 'https://evil.example/x.jpg' }).image, null)
  assert.equal(safePreview({ ...good, price: 'free' }).price, null)
})

test('formatPreviewPrice', async () => {
  const { formatPreviewPrice } = await load()
  assert.equal(formatPreviewPrice('1899.00', 'PHP'), '₱1,899.00')
  assert.equal(formatPreviewPrice('12', 'USD'), 'USD 12.00')
  assert.equal(formatPreviewPrice(null, 'PHP'), '')
})

test('fromServer carries a safe preview on agent messages', async () => {
  const { fromServer } = await import('../../mediko-widget/src/messages.js')
  const m = fromServer({ id: 1, role: 'agent', content: 'Eto po', created_at: '2026-11-12 01:00:00', preview: good })
  assert.equal(m.preview.title, 'Genacol 90s')
  assert.equal(fromServer({ id: 2, role: 'user', content: 'hi', created_at: '2026-11-12 01:00:00' }).preview, null)
  assert.equal(fromServer({ id: 3, role: 'agent', content: 'x', created_at: 't', preview: { ...good, url: 'javascript:1' } }).preview, null)
})

test('storeProductLink finds the first product link on this store', async () => {
  const { storeProductLink } = await load()
  const h = 'store.mediko.ph'
  assert.deepEqual(storeProductLink('may stock ba ito? https://store.mediko.ph/products/genacol-90s?variant=1.', h),
    { url: 'https://store.mediko.ph/products/genacol-90s?variant=1', handle: 'genacol-90s' })
  assert.equal(storeProductLink('https://other.ph/products/genacol-90s', h), null)
  assert.equal(storeProductLink('https://store.mediko.ph/pages/about', h), null)
  assert.equal(storeProductLink('walang link', h), null)
  assert.equal(storeProductLink('https://store.mediko.ph/products/../admin', h), null)
})

test('fromAjaxProduct maps /products/<handle>.js (price in cents, protocol-relative image)', async () => {
  const { fromAjaxProduct } = await load()
  const d = { title: 'Genacol 90s', price: 189900, featured_image: '//cdn.shopify.com/s/files/1/g.jpg' }
  assert.deepEqual(fromAjaxProduct(d, 'https://store.mediko.ph/products/genacol-90s', 'PHP'), {
    url: 'https://store.mediko.ph/products/genacol-90s', title: 'Genacol 90s',
    image: 'https://cdn.shopify.com/s/files/1/g.jpg', price: '1899.00', currency: 'PHP'
  })
  assert.equal(fromAjaxProduct(null, 'https://store.mediko.ph/products/x'), null)
  assert.equal(fromAjaxProduct({ title: 'X', price: 1, featured_image: 'javascript:1' }, 'https://store.mediko.ph/products/x').image, null)
})

test('fromServer keeps hidePreview on customer messages', async () => {
  const { fromServer } = await import('../../mediko-widget/src/messages.js')
  assert.equal(fromServer({ id: 1, role: 'user', content: 'x', created_at: 't', hidePreview: true }).hidePreview, true)
  assert.equal(fromServer({ id: 2, role: 'user', content: 'x', created_at: 't' }).hidePreview, false)
})
