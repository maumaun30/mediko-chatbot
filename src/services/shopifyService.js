/**
 * shopifyService.js
 *
 * Product search via Shopify Storefront GraphQL API.
 * Order lookup via Shopify Admin REST API.
 *
 * ── Required Shopify Storefront API scopes ───────────────────
 * When creating your Storefront API token in Shopify Admin:
 *   Apps → Develop Apps → [Your App] → API credentials
 *   → Storefront API access scopes → enable:
 *     ✓ unauthenticated_read_product_listings
 *     ✓ unauthenticated_read_product_inventory
 *     ✓ unauthenticated_read_selling_plans   (optional, for bundles)
 *
 * Without unauthenticated_read_product_listings the products query
 * returns an empty array even with a valid token.
 * ────────────────────────────────────────────────────────────
 */

import { loadKeywords } from './keywordService.js'

const STORE_DOMAIN     = process.env.SHOPIFY_STORE_DOMAIN
const STOREFRONT_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN
const ADMIN_TOKEN      = process.env.SHOPIFY_ADMIN_TOKEN

const STOREFRONT_URL   = `https://${STORE_DOMAIN}/api/2024-01/graphql.json`
const ADMIN_URL        = `https://${STORE_DOMAIN}/admin/api/2024-01`

// ── GraphQL query ─────────────────────────────────────────────

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

// ── Shopify search ────────────────────────────────────────────

/**
 * Search Shopify products by a query string.
 *
 * Shopify Storefront API query syntax:
 *   "genacol"          → full-text search across title, tags, vendor, body
 *   "title:genacol"    → title field only (more precise)
 *   "tag:collagen"     → products tagged "collagen"
 *   ""  (empty string) → returns all products (for browsing)
 *
 * @param {string} query
 * @param {number} [limit=4]
 * @returns {Promise<import('./shopifyService.js').ShopifyProduct[]>}
 */
export async function searchProducts(query, limit = 4) {
  if (!STORE_DOMAIN || !STOREFRONT_TOKEN) {
    console.warn('[Shopify] SHOPIFY_STORE_DOMAIN or SHOPIFY_STOREFRONT_TOKEN not set')
    return []
  }

  const res = await fetch(STOREFRONT_URL, {
    method: 'POST',
    headers: {
      'Content-Type':                      'application/json',
      'X-Shopify-Storefront-Access-Token': STOREFRONT_TOKEN
    },
    body: JSON.stringify({
      query:     PRODUCT_SEARCH_QUERY,
      variables: { query: query || '', first: limit }
    })
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Shopify Storefront API ${res.status}: ${text.slice(0, 200)}`)
  }

  const json = await res.json()

  if (json.errors?.length) {
    throw new Error(`Shopify GraphQL: ${json.errors[0].message}`)
  }

  return (json.data?.products?.edges || []).map(({ node }) => ({
    id:          node.id,
    title:       node.title,
    handle:      node.handle,
    description: node.description?.slice(0, 350) || '',
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

// ── Keyword extraction (dynamic, loaded from Supabase) ────────

/**
 * Stopwords to ignore when doing product name search.
 * Words that appear in many messages but are not product-related.
 */
const STOPWORDS = new Set([
  'the','a','an','is','are','was','were','be','been','have','has','had',
  'do','does','did','will','would','could','should','may','might','must',
  'shall','can','po','ba','ang','ng','mga','sa','na','at','ay','ni','ko',
  'mo','siya','kayo','kami','tayo','sila','ito','iyon','yon','ano','alin',
  'sino','kanino','paano','kailan','saan','bakit','hindi','wala','may',
  'meron','gusto','pwede','puwede','lang','din','rin','nga','naman','talaga',
  'yung','yun','dito','doon','dyan','what','how','why','when','where','who',
  'which','that','this','with','for','from','have','about','your','our',
  'their','they','you','not','but','and','or','if','then','there','here'
])

/**
 * Extract Shopify search terms from a customer message.
 * Loads keyword patterns from Supabase (cached for 5 min).
 *
 * Returns an array of deduplicated search term strings.
 *
 * @param {string} message
 * @returns {Promise<string[]>}
 */
export async function extractSearchTerms(message) {
  const lower   = message.toLowerCase()
  const found   = new Set()
  const keywords = await loadKeywords()

  // Match against dynamic keyword patterns from DB
  for (const { pattern, search_term } of keywords) {
    if (lower.includes(pattern)) {
      found.add(search_term)
    }
  }

  // Also try every meaningful word in the message as a potential product name
  // This catches "Genacol", "Glutathione", etc. even without a keyword entry
  const words = message
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .map(w => w.toLowerCase().trim())
    .filter(w => w.length >= 3 && !STOPWORDS.has(w))

  for (const word of words) {
    found.add(word)
  }

  return [...found]
}

// ── Browse detection ──────────────────────────────────────────

const BROWSE_PATTERNS = [
  /\b(anong|ano ang|ipakita|show|list|pakita|lahat|all|catalog)\b.{0,40}\b(products?|supplements?|items?|available|nyo|ninyo)\b/i,
  /\b(what|whats).{0,20}\b(available|you have|do you (have|sell|carry|offer))\b/i,
  /\b(products?|supplements?|vitamins?)\s+(nyo|ninyo|ng mediko|available|ba)/i,
  /\b(browse|explore|tingnan|gusto kong makita|pakita lahat)\b/i,
  /\btingnan.{0,20}\bproducts?\b/i,
]

function isBrowseRequest(message) {
  return BROWSE_PATTERNS.some(p => p.test(message))
}

// ── Main context builder ──────────────────────────────────────

/**
 * Given a customer message, find relevant Shopify products to inject
 * into the AI's context.
 *
 * Search strategy (in order):
 *   1. Dynamic keyword match from DB → search those terms
 *   2. Meaningful words in message → search as product names
 *   3. Browse/catalog request → fetch first N products (no query filter)
 *   4. Nothing matched → return []
 *
 * @param {string} message
 * @returns {Promise<import('./shopifyService.js').ShopifyProduct[]>}
 */
export async function getProductContextForMessage(message) {
  try {
    // Strategy 1 + 2: keyword match AND word extraction (merged)
    const terms = await extractSearchTerms(message)

    if (terms.length) {
      // Try each term individually — Shopify finds more with single terms
      // than with OR-joined multi-term queries for product titles
      const results = []
      const seen    = new Set()

      for (const term of terms.slice(0, 5)) {
        const hits = await searchProducts(term, 3)
        for (const p of hits) {
          if (!seen.has(p.id)) {
            seen.add(p.id)
            results.push(p)
          }
        }
        if (results.length >= 4) break
      }

      if (results.length) return results.slice(0, 4)
    }

    // Strategy 3: browse request — empty query = first N products
    if (isBrowseRequest(message)) {
      return await searchProducts('', 6)
    }

    return []
  } catch (err) {
    console.error('[shopifyService] Product search failed:', err.message)
    return []
  }
}

// ── Order lookup ──────────────────────────────────────────────

export async function lookupOrder(orderName, customerEmail) {
  if (!STORE_DOMAIN || !ADMIN_TOKEN) {
    console.warn('[Shopify] Admin token not configured')
    return null
  }

  const name = orderName.replace(/^#/, '')
  const url  = `${ADMIN_URL}/orders.json?name=${encodeURIComponent(name)}&email=${encodeURIComponent(customerEmail)}&status=any`

  const res = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': ADMIN_TOKEN,
      'Content-Type':           'application/json'
    }
  })

  if (!res.ok) throw new Error(`Shopify Admin API error: ${res.status}`)

  const { orders } = await res.json()
  if (!orders?.length) return null

  const order          = orders[0]
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

export function extractOrderQuery(message) {
  const orderMatch = message.match(/#?(\d{4,})/)?.[1]
  const emailMatch = message.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)?.[0]
  if (orderMatch && emailMatch) return { orderName: orderMatch, email: emailMatch }
  return null
}
