/**
 * linkPreview.js — validates the product preview an agent attaches to a reply.
 *
 * Gateway builds the preview from the Shopify Admin API (it can't scrape the
 * storefront: Shopify bot protection answers 429) and sends it with the
 * agent_message command. Agents are authenticated staff, but the preview is
 * still shown to customers, so only a known shape is kept: an https link on a
 * store host, an optional Shopify CDN image and bounded text.
 */

const DEFAULT_HOSTS = 'store.mediko.ph,mediko.ph'
const IMAGE_PREFIX = 'https://cdn.shopify.com/'
const PRICE_RE = /^\d{1,9}(\.\d{1,2})?$/
const CURRENCY_RE = /^[A-Z]{3}$/

export function previewHosts() {
  return (process.env.LINK_PREVIEW_HOSTS || DEFAULT_HOSTS)
    .split(',').map(h => h.trim().toLowerCase()).filter(Boolean)
}

function optText(v, max) {
  if (v == null || v === '') return { ok: true, value: null }
  if (typeof v !== 'string' || v.length > max) return { ok: false }
  return { ok: true, value: v }
}

/**
 * @returns {{ ok: true, preview: object|null } | { ok: false, error: string }}
 */
export function validatePreview(p, hosts = previewHosts()) {
  if (p == null) return { ok: true, preview: null }
  if (typeof p !== 'object' || Array.isArray(p)) return { ok: false, error: 'preview must be an object' }

  let url
  try { url = new URL(String(p.url)) } catch { return { ok: false, error: 'preview.url is invalid' } }
  if (url.protocol !== 'https:' || !hosts.includes(url.host.toLowerCase()) || String(p.url).length > 2000) {
    return { ok: false, error: 'preview.url must be an https link on the store' }
  }
  if (typeof p.title !== 'string' || !p.title.trim() || p.title.length > 200) {
    return { ok: false, error: 'preview.title must be 1-200 characters' }
  }
  const description = optText(p.description, 300)
  const image = optText(p.image, 2000)
  const price = optText(p.price, 12)
  const currency = optText(p.currency, 3)
  if (!description.ok || !image.ok || !price.ok || !currency.ok) return { ok: false, error: 'preview field too long' }
  if (image.value && !image.value.startsWith(IMAGE_PREFIX)) return { ok: false, error: 'preview.image must be a Shopify CDN https URL' }
  if (price.value && !PRICE_RE.test(price.value)) return { ok: false, error: 'preview.price must be a number like 1899.00' }
  if (currency.value && !CURRENCY_RE.test(currency.value)) return { ok: false, error: 'preview.currency must be a 3-letter code' }

  return {
    ok: true,
    preview: {
      url: String(p.url),
      title: p.title,
      description: description.value,
      image: image.value,
      price: price.value,
      currency: currency.value
    }
  }
}
