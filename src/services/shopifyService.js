/**
 * shopifyService.js
 *
 * Two responsibilities:
 *   1. Product search  — Shopify Storefront GraphQL API (public, free)
 *   2. Order lookup    — Shopify Admin REST API (private app token)
 *
 * All results are returned in a clean internal shape so the prompt
 * builder never has to deal with raw Shopify response structures.
 */

// ── Config ───────────────────────────────────────────────────

const STORE_DOMAIN    = process.env.SHOPIFY_STORE_DOMAIN      // e.g. store.mediko.ph
const STOREFRONT_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN // public Storefront API token
const ADMIN_TOKEN     = process.env.SHOPIFY_ADMIN_TOKEN       // private Admin API token

const STOREFRONT_URL  = `https://${STORE_DOMAIN}/api/2024-01/graphql.json`
const ADMIN_URL       = `https://${STORE_DOMAIN}/admin/api/2024-01`

// ── Keyword extraction ───────────────────────────────────────

/**
 * Health-concern keyword map.
 * Maps common Tagalog/English health terms → Shopify search keywords.
 * This is the "smart" part: "hirap matulog" → searches "sleep melatonin".
 *
 * @type {Array<{ patterns: RegExp, keywords: string[] }>}
 */
const HEALTH_KEYWORD_MAP = [
  { patterns: /immune|immunity|imunan|resistensya|ubo|sipon|trangkaso|flu|cold/i,
    keywords: ['immunity', 'vitamin c', 'zinc', 'elderberry'] },

  { patterns: /tulog|sleep|insomnia|gising|di makatulog|hirap matulog/i,
    keywords: ['sleep', 'melatonin', 'magnesium'] },

  { patterns: /energy|lakas|pagod|obat|antok|tired|fatigue/i,
    keywords: ['energy', 'b12', 'iron', 'multivitamin'] },

  { patterns: /bones?|buto|osteoporosis|calcium|kaltsyum/i,
    keywords: ['calcium', 'vitamin d', 'bone'] },

  { patterns: /skin|balat|glow|acne|pimple|tagihawat|brightening/i,
    keywords: ['collagen', 'vitamin e', 'skin', 'glutathione'] },

  { patterns: /heart|puso|cholesterol|blood pressure|presyon/i,
    keywords: ['omega 3', 'fish oil', 'coq10', 'heart'] },

  { patterns: /digest|tiyan|stomach|constipation|semento|probiot/i,
    keywords: ['probiotic', 'digestive', 'fiber', 'gut'] },

  { patterns: /stress|kaba|anxiety|tension|relax/i,
    keywords: ['ashwagandha', 'magnesium', 'stress', 'calm'] },

  { patterns: /weight|timbang|slimming|diet|fat|payat/i,
    keywords: ['weight', 'garcinia', 'cla', 'metabolism'] },

  { patterns: /eyes?|mata|vision|sight/i,
    keywords: ['lutein', 'vitamin a', 'eye'] },

  { patterns: /pregnant|buntis|prenatal|folic|folate/i,
    keywords: ['prenatal', 'folic acid', 'prenatal vitamin'] },

  { patterns: /kids?|bata|children|pedia|child/i,
    keywords: ['children', 'kids', 'gummies', 'pedia'] },
]

/**
 * Extract search keywords from a customer message.
 * Returns an array of keyword strings, deduplicated.
 *
 * @param {string} message
 * @returns {string[]}
 */
export function extractSearchKeywords(message) {
  const found = new Set()

  for (const { patterns, keywords } of HEALTH_KEYWORD_MAP) {
    if (patterns.test(message)) {
      keywords.forEach(k => found.add(k))
    }
  }

  // Also extract any explicit product-name mentions (capitalised words, 2+ chars)
  const productMentions = message.match(/\b[A-Z][a-zA-Z]{2,}\b/g) || []
  productMentions.forEach(w => found.add(w.toLowerCase()))

  return [...found]
}

// ── Storefront GraphQL product search ────────────────────────

const PRODUCT_SEARCH_QUERY = `
  query searchProducts($query: String!, $first: Int!) {
    products(query: $query, first: $first) {
      edges {
        node {
          id
          title
          handle
          description
          tags
          priceRange {
            minVariantPrice { amount currencyCode }
            maxVariantPrice { amount currencyCode }
          }
          variants(first: 3) {
            edges {
              node {
                id
                title
                price { amount }
                availableForSale
              }
            }
          }
        }
      }
    }
  }
`

/**
 * @typedef {Object} ShopifyProduct
 * @property {string}   id
 * @property {string}   title
 * @property {string}   handle
 * @property {string}   description
 * @property {string[]} tags
 * @property {{ amount: string, currencyCode: string }} minPrice
 * @property {{ amount: string, currencyCode: string }} maxPrice
 * @property {Array<{ id: string, title: string, price: string, available: boolean }>} variants
 */

/**
 * Search Shopify products by a query string.
 * Returns up to `limit` results in a clean internal shape.
 *
 * @param {string} query   — Shopify search query (e.g. "vitamin c immunity")
 * @param {number} [limit=3]
 * @returns {Promise<ShopifyProduct[]>}
 */
export async function searchProducts(query, limit = 3) {
  if (!STORE_DOMAIN || !STOREFRONT_TOKEN) {
    console.warn('[Shopify] Storefront token not configured'); return []
  }

  const res = await fetch(STOREFRONT_URL, {
    method: 'POST',
    headers: {
      'Content-Type':                     'application/json',
      'X-Shopify-Storefront-Access-Token': STOREFRONT_TOKEN
    },
    body: JSON.stringify({
      query:     PRODUCT_SEARCH_QUERY,
      variables: { query, first: limit }
    })
  })

  if (!res.ok) throw new Error(`Shopify Storefront API error: ${res.status}`)

  const { data, errors } = await res.json()
  if (errors?.length) throw new Error(`Shopify GraphQL error: ${errors[0].message}`)

  return (data?.products?.edges || []).map(({ node }) => ({
    id:          node.id,
    title:       node.title,
    handle:      node.handle,
    description: node.description?.slice(0, 400) || '',
    tags:        node.tags || [],
    minPrice:    node.priceRange.minVariantPrice,
    maxPrice:    node.priceRange.maxVariantPrice,
    variants:    (node.variants?.edges || []).map(({ node: v }) => ({
      id:        v.id,
      title:     v.title,
      price:     v.price.amount,
      available: v.availableForSale
    }))
  }))
}

/**
 * Product-browse triggers — messages asking to see the catalog broadly.
 * These bypass the health keyword map and fetch top products instead.
 */
const BROWSE_PATTERNS = [
  /\b(anong|ano ang|ipakita|show|list|pakita|lahat|all|catalog|products?|supplements?|available|meron|mayroon|may)\b.{0,40}\b(products?|supplements?|items?|available|nyo|ninyo|kayo|store|shop)\b/i,
  /\b(what|what's|whats).{0,20}\b(available|you have|do you (have|sell|carry|offer))\b/i,
  /\b(products?|supplements?|vitamins?|items?)\s+(nyo|ninyo|ng mediko|available|mo|ba)/i,
  /\b(browse|explore|tingnan|tumingin|gusto kong makita)\b/i,
]

/**
 * Returns true if the message is asking to browse/list products generally.
 * @param {string} message
 * @returns {boolean}
 */
function isBrowseRequest(message) {
  return BROWSE_PATTERNS.some(p => p.test(message))
}

/**
 * Given a raw customer message, search Shopify for relevant products.
 *
 * Strategy:
 *   1. If health keywords detected → search by those keywords
 *   2. If browse/catalog request detected → fetch top products broadly
 *   3. If specific product name mentioned → search by that name
 *   4. Otherwise → return [] (no context injected, Medi answers generally)
 *
 * @param {string} message
 * @returns {Promise<ShopifyProduct[]>}
 */
export async function getProductContextForMessage(message) {
  try {
    // Strategy 1: health keyword match
    const keywords = extractSearchKeywords(message)
    if (keywords.length) {
      const query = keywords.slice(0, 4).join(' OR ')
      const results = await searchProducts(query, 3)
      if (results.length) return results
    }

    // Strategy 2: browse/catalog request — fetch top products
    if (isBrowseRequest(message)) {
      return await searchProducts('*', 5)
    }

    // Strategy 3: looks like a specific product name (3+ char capitalised words)
    const productWords = message.match(/\b[A-Za-z][a-zA-Z]{2,}\b/g) || []
    const filtered = productWords
      .filter(w => !'the a an is are was were be been have has had do does did will would could should may might must shall can po ba ang ng mga sa'.split(' ').includes(w.toLowerCase()))
    if (filtered.length) {
      const nameQuery = filtered.slice(0, 3).join(' ')
      const results = await searchProducts(nameQuery, 3)
      if (results.length) return results
    }

    return []
  } catch (err) {
    console.error('[shopifyService] Product search failed:', err.message)
    return []
  }
}

// ── Admin API order lookup ────────────────────────────────────

/**
 * @typedef {Object} OrderInfo
 * @property {string}  name            — order number e.g. "#1042"
 * @property {string}  totalPrice
 * @property {string}  financialStatus — e.g. "paid"
 * @property {string}  fulfillmentStatus
 * @property {string[]} trackingNumbers
 * @property {string}  statusUrl       — order tracking URL
 */

/**
 * Look up a Shopify order by order name (e.g. "#1042") and customer email.
 * Uses the Admin REST API — requires SHOPIFY_ADMIN_TOKEN.
 *
 * @param {string} orderName     — e.g. "1042" or "#1042"
 * @param {string} customerEmail
 * @returns {Promise<OrderInfo | null>}
 */
export async function lookupOrder(orderName, customerEmail) {
  if (!STORE_DOMAIN || !ADMIN_TOKEN) {
    console.warn('[Shopify] Admin token not configured'); return null
  }

  // Strip leading # if present
  const name = orderName.replace(/^#/, '')

  const url = `${ADMIN_URL}/orders.json?name=${encodeURIComponent(name)}&email=${encodeURIComponent(customerEmail)}&status=any`

  const res = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': ADMIN_TOKEN,
      'Content-Type':           'application/json'
    }
  })

  if (!res.ok) throw new Error(`Shopify Admin API error: ${res.status}`)

  const { orders } = await res.json()
  if (!orders?.length) return null

  const order = orders[0]

  // Collect tracking numbers from all fulfillments
  const trackingNumbers = (order.fulfillments || [])
    .flatMap(f => f.tracking_numbers || [])
    .filter(Boolean)

  return {
    name:              order.name,
    totalPrice:        order.total_price,
    financialStatus:   order.financial_status,
    fulfillmentStatus: order.fulfillment_status || 'unfulfilled',
    trackingNumbers,
    statusUrl:         order.order_status_url || null
  }
}

/**
 * Detect if a message is asking about an order.
 * Returns { orderName, email } if found, or null.
 *
 * Customers typically say: "order ko #1042" or "track 1042 email@example.com"
 *
 * @param {string} message
 * @returns {{ orderName: string, email: string } | null}
 */
export function extractOrderQuery(message) {
  const orderMatch = message.match(/#?(\d{4,})/)?.[1]
  const emailMatch = message.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)?.[0]

  if (orderMatch && emailMatch) {
    return { orderName: orderMatch, email: emailMatch }
  }
  return null
}
