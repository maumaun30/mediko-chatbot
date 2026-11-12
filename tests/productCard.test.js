import test from 'node:test'
import assert from 'node:assert/strict'

const load = () => import('../../mediko-widget/src/product.js')

test('productHandle extracts the handle from store product URLs', async () => {
  const { productHandle } = await load()
  assert.equal(productHandle('https://store.mediko.ph/products/genacol-90s?variant=1'), 'genacol-90s')
  assert.equal(productHandle('https://store.mediko.ph/collections/all/products/vit-c#top'), 'vit-c')
  assert.equal(productHandle('https://store.mediko.ph/pages/about'), '')
  assert.equal(productHandle('https://store.mediko.ph/products/../admin'), '')
})

test('productJsonPath is the same-origin storefront AJAX endpoint', async () => {
  const { productJsonPath } = await load()
  assert.equal(productJsonPath('genacol-90s'), '/products/genacol-90s.js')
})

test('fromAjaxProduct maps Shopify AJAX product JSON (price in cents)', async () => {
  const { fromAjaxProduct } = await load()
  const d = { title: 'Genacol 90s', price: 189900, featured_image: '//cdn.shopify.com/s/files/genacol.jpg' }
  assert.deepEqual(fromAjaxProduct(d, 'PHP'), {
    title: 'Genacol 90s', price: '1899.00', currency: 'PHP', image: 'https://cdn.shopify.com/s/files/genacol.jpg'
  })
})

test('fromAjaxProduct handles missing image, bad price and junk input', async () => {
  const { fromAjaxProduct } = await load()
  assert.deepEqual(fromAjaxProduct({ title: 'X', price: 'abc', featured_image: null }), { title: 'X', price: null, currency: 'PHP', image: null })
  assert.equal(fromAjaxProduct(null), null)
  assert.equal(fromAjaxProduct({ price: 100 }), null)
  assert.equal(fromAjaxProduct({ title: 'X', price: 100, featured_image: 'javascript:alert(1)' }).image, null)
})

test('isStoreProductUrl: only product pages on the current store host', async () => {
  const { isStoreProductUrl } = await load()
  assert.equal(isStoreProductUrl('https://store.mediko.ph/products/genacol-90s', 'store.mediko.ph'), true)
  assert.equal(isStoreProductUrl('https://store.mediko.ph/products/genacol-90s?variant=2', 'store.mediko.ph'), true)
  assert.equal(isStoreProductUrl('https://other.ph/products/genacol-90s', 'store.mediko.ph'), false)
  assert.equal(isStoreProductUrl('https://store.mediko.ph/pages/about', 'store.mediko.ph'), false)
  assert.equal(isStoreProductUrl('not a url', 'store.mediko.ph'), false)
})
