/**
 * promptService.js
 *
 * Builds the OpenAI messages array with:
 *   1. Medi's Tagalog persona + guardrails (always present)
 *   2. Live Shopify product context (injected per request)
 *   3. Order info context (injected when order lookup succeeds)
 *   4. Conversation history
 *   5. Current user message
 */

// ── Persona ──────────────────────────────────────────────────

const MEDI_PERSONA = `\
Ikaw si Medi — ang AI customer support assistant ng Mediko, isang tindahan ng premium supplements sa Pilipinas (store.mediko.ph).

WIKA:
- Sumagot LAGI sa Filipino o Tagalog, kahit na ang tanong ay sa Ingles.
- Kung ang customer ay paulit-ulit na mag-Ingles, pwede kang sumagot ng Ingles — pero magsimula ka pa rin sa Tagalog.
- Gamitin ang natural, pang-araw-araw na Tagalog. Iwasan ang masyadong pormal o robotic na wika.

UGALI AT TONO:
- Maging magalang, mainit, at matulungin — parang isang kaibigan na may kaalaman sa kalusugan.
- Tumawag sa customer ng "po" at "kayo" upang maging magalang.
- Maging malinaw at diretso sa sagot — huwag magpaligoy-ligoy.
- Kung hindi ka sigurado, sabihin mo nang tapat at mag-alok na makipag-ugnayan sa team ng Mediko.

TRABAHO MO:
1. Tulungan ang mga customer na mahanap ang tamang supplement batay sa kanilang pangangailangan o sintomas.
2. Sagutin ang mga tanong tungkol sa mga produkto ng Mediko (ingredients, dosage, benepisyo, presyo).
3. Tulungan sa mga katanungan tungkol sa order at shipping.
4. Kung available ang impormasyon ng produkto sa ibaba, gamitin ito sa iyong sagot. Huwag mag-imbento ng detalye.

MGA DAPAT IWASAN (MAHALAGANG ALITUNTUNIN):
- HUWAG mag-diagnose ng sakit o medikal na kondisyon.
- HUWAG sabihin na ang supplement ay nagagamot ng anumang sakit — gumamit ng "maaaring makatulong" o "kilala bilang suporta sa..."
- HUWAG rekomendasyon ng papalitan ang reseta ng doktor. Laging sabihin: "Kumonsulta muna sa inyong doktor kung may medikal na kondisyon kayo."
- HUWAG pag-usapan ang mga kakumpitensya o ibang brands.
- HUWAG magbigay ng eksaktong medikal na dosis para sa mga pasyente — i-refer sa doktor.
- HUWAG mag-imbento ng presyo o detalye ng produkto. Kung wala sa konteksto, sabihin: "Para sa pinakabagong impormasyon, bisitahin po ang store.mediko.ph."

KUNG WALANG SOLUSYON:
"Pasensya na po. Para sa mas detalyadong tulong, maaari kayong makipag-ugnayan sa aming team sa store.mediko.ph o mag-email sa support@mediko.ph."
`

// ── Product context block ────────────────────────────────────

/**
 * Format Shopify products into a Tagalog-friendly context block.
 * @param {Array} products
 * @returns {string}
 */
function buildProductContext(products = []) {
  if (!products.length) return ''

  const lines = products.map((p, i) => {
    const price = p.minPrice?.amount
      ? `₱${parseFloat(p.minPrice.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
      : null

    const priceMax = p.maxPrice?.amount && p.maxPrice.amount !== p.minPrice?.amount
      ? ` – ₱${parseFloat(p.maxPrice.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
      : ''

    const priceStr  = price ? `\n   Presyo: ${price}${priceMax}` : ''
    const tagsStr   = p.tags?.length ? `\n   Tags: ${p.tags.join(', ')}` : ''
    const descStr   = p.description ? `\n   Deskripsyon: ${p.description}` : ''

    // List available variants (sizes/flavors) if more than one
    const variants = (p.variants || []).filter(v => v.available)
    const variantStr = variants.length > 1
      ? `\n   Available variants: ${variants.map(v => v.title).join(', ')}`
      : ''

    const url = `https://${process.env.SHOPIFY_STORE_DOMAIN || 'store.mediko.ph'}/products/${p.handle}`

    return `${i + 1}. ${p.title}${priceStr}${tagsStr}${descStr}${variantStr}\n   Link: ${url}`
  })

  return `
━━━ KAUGNAY NA MGA PRODUKTO NG MEDIKO ━━━
(Gamitin ang impormasyong ito kung angkop. Huwag mag-imbento ng detalye na wala dito.)

${lines.join('\n\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`
}

// ── Order context block ──────────────────────────────────────

/**
 * Format a Shopify order into a Tagalog context block.
 * @param {object|null} order
 * @returns {string}
 */
function buildOrderContext(order = null) {
  if (!order) return ''

  const statusMap = {
    paid:        'Bayad na',
    pending:     'Nakabinbin pa',
    refunded:    'Naibalik na',
    unfulfilled: 'Hindi pa naipapadala',
    fulfilled:   'Naipadala na',
    partial:     'Bahagi ay naipadala na'
  }

  const payStatus  = statusMap[order.financialStatus]   ?? order.financialStatus
  const shipStatus = statusMap[order.fulfillmentStatus] ?? order.fulfillmentStatus
  const tracking   = order.trackingNumbers?.length
    ? `Tracking: ${order.trackingNumbers.join(', ')}`
    : 'Wala pang tracking number'
  const statusLink = order.statusUrl
    ? `\n   I-track ang order: ${order.statusUrl}`
    : ''

  return `
━━━ IMPORMASYON SA ORDER ━━━
Order ${order.name} — ₱${parseFloat(order.totalPrice).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
Status ng bayad: ${payStatus}
Status ng delivery: ${shipStatus}
${tracking}${statusLink}
━━━━━━━━━━━━━━━━━━━━━━━━━━━
`
}

// ── Main export ──────────────────────────────────────────────

/**
 * Build the full messages array for OpenAI Chat Completions.
 *
 * @param {object} opts
 * @param {string}       opts.userMessage
 * @param {Array}        opts.history        — prior {role, content} pairs
 * @param {Array}        [opts.products]     — Shopify products
 * @param {object|null}  [opts.order]        — Shopify order info
 * @returns {Array<{role: string, content: string}>}
 */
export function buildMessages({ userMessage, history = [], products = [], order = null }) {
  const productBlock = buildProductContext(products)
  const orderBlock   = buildOrderContext(order)
  const systemPrompt = MEDI_PERSONA + productBlock + orderBlock

  return [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage }
  ]
}
