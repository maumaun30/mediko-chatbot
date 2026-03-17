/**
 * promptService.js
 *
 * Builds the system prompt for the Mediko AI chatbot.
 * Phase 1: persona + guardrails only.
 * Phase 2 will inject live Shopify product context here.
 */

// ── Persona ─────────────────────────────────────────────────

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
4. Mag-refer ng tama kung ang tanong ay lampas sa iyong kaalaman.

MGA DAPAT IWASAN (MAHALAGANG ALITUNTUNIN):
- HUWAG mag-diagnose ng sakit o medikal na kondisyon.
- HUWAG sabihin na ang supplement ay nagagamot ng anumang sakit — gumamit ng "maaaring makatulong" o "kilala bilang suporta sa..."
- HUWAG rekomendasyon ng papalitan ang reseta ng doktor. Laging sabihin: "Kumonsulta muna sa inyong doktor kung may medikal na kondisyon kayo."
- HUWAG pag-usapan ang mga kakumpitensya o ibang brands.
- HUWAG magbigay ng eksaktong medikal na dosis para sa mga pasyente — i-refer sa doktor.
- HUWAG mag-imbento ng impormasyon tungkol sa produkto. Kung hindi mo alam, sabihin mo.

KUNG WALANG SOLUSYON:
Kung hindi mo masagot ang tanong ng customer, sabihin:
"Pasensya na po. Para sa mas detalyadong tulong, maaari kayong makipag-ugnayan sa aming team sa store.mediko.ph o mag-email sa support@mediko.ph."
`

// ── Product context block (Phase 2 will populate this) ──────

/**
 * Format product data from Shopify into a readable context block.
 * @param {Array} products  — array of Shopify product objects
 * @returns {string}
 */
function buildProductContext(products = []) {
  if (!products.length) return ''

  const lines = products.map((p, i) => {
    const tags = p.tags?.length ? `\n   Tags/kategorya: ${p.tags.join(', ')}` : ''
    const price = p.priceRange?.minVariantPrice?.amount
      ? `\n   Presyo: ₱${parseFloat(p.priceRange.minVariantPrice.amount).toFixed(2)}`
      : ''
    const desc = p.description
      ? `\n   Deskripsyon: ${p.description.slice(0, 300)}${p.description.length > 300 ? '...' : ''}`
      : ''

    return `${i + 1}. ${p.title}${price}${tags}${desc}`
  })

  return `\nKAUGNAY NA MGA PRODUKTO NG MEDIKO (gamitin bilang konteksto kung angkop):\n${lines.join('\n\n')}\n`
}

// ── Order context block ──────────────────────────────────────

/**
 * Format a Shopify order into a readable context block.
 * @param {object|null} order
 * @returns {string}
 */
function buildOrderContext(order = null) {
  if (!order) return ''

  const fulfillment = order.fulfillmentStatus || 'Hindi pa naka-fulfill'
  const financial = order.financialStatus || 'Hindi available'
  const tracking = order.trackingNumbers?.length
    ? `Tracking number: ${order.trackingNumbers.join(', ')}`
    : 'Walang tracking number pa'

  return `\nIMPORMASYON SA ORDER NG CUSTOMER:
Order #${order.name} — ₱${parseFloat(order.totalPrice).toFixed(2)}
Status ng bayad: ${financial}
Status ng shipping: ${fulfillment}
${tracking}
`
}

// ── Main export ──────────────────────────────────────────────

/**
 * Build the full messages array for the OpenAI Chat Completions API.
 *
 * @param {object} opts
 * @param {string}        opts.userMessage     — current user message
 * @param {Array}         opts.history         — prior {role, content} pairs from Supabase
 * @param {Array}         [opts.products]      — Shopify products for context (Phase 2)
 * @param {object|null}   [opts.order]         — Shopify order info (Phase 2)
 * @returns {Array<{role: string, content: string}>}
 */
export function buildMessages({ userMessage, history = [], products = [], order = null }) {
  const productBlock = buildProductContext(products)
  const orderBlock = buildOrderContext(order)
  const contextBlock = productBlock || orderBlock
    ? `\n--- KONTEKSTO ---${productBlock}${orderBlock}--- WAKAS NG KONTEKSTO ---\n`
    : ''

  const systemPrompt = MEDI_PERSONA + contextBlock

  return [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage }
  ]
}
