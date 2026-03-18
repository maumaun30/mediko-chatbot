/**
 * metaSetup.js
 *
 * Diagnostic routes to verify Meta credentials and webhook setup.
 * Accessible at /api/meta/* — remove or protect in production.
 */

export default async function metaSetupRoutes(fastify) {

  /**
   * GET /api/meta/status
   * Check which Meta credentials are configured.
   * Never returns the actual token values — only presence/absence.
   */
  fastify.get('/status', async (request, reply) => {
    const checks = {
      META_WEBHOOK_VERIFY_TOKEN:    !!process.env.META_WEBHOOK_VERIFY_TOKEN,
      META_ACCESS_TOKEN:            !!process.env.META_ACCESS_TOKEN,
      WHATSAPP_PHONE_NUMBER_ID:     !!process.env.WHATSAPP_PHONE_NUMBER_ID,
      MESSENGER_PAGE_ACCESS_TOKEN:  !!process.env.MESSENGER_PAGE_ACCESS_TOKEN,
      SHOPIFY_STOREFRONT_TOKEN:     !!process.env.SHOPIFY_STOREFRONT_TOKEN,
      SHOPIFY_ADMIN_TOKEN:          !!process.env.SHOPIFY_ADMIN_TOKEN,
    }

    const allReady = Object.values(checks).every(Boolean)

    return reply.send({
      status:   allReady ? 'ready' : 'incomplete',
      checks,
      webhooks: {
        whatsapp:  `${getBaseUrl(request)}/api/webhooks/whatsapp`,
        messenger: `${getBaseUrl(request)}/api/webhooks/messenger`,
      }
    })
  })


  /**
   * GET /api/meta/test-whatsapp?to=639171234567
   * Send a test WhatsApp message to verify your credentials.
   * Only works when WHATSAPP_PHONE_NUMBER_ID and META_ACCESS_TOKEN are set.
   */
  fastify.get('/test-whatsapp', {
    schema: {
      querystring: {
        type: 'object',
        required: ['to'],
        properties: { to: { type: 'string' } }
      }
    }
  }, async (request, reply) => {
    const { to } = request.query

    try {
      const { sendWhatsAppMessage } = await import('../channels/whatsappAdapter.js')
      await sendWhatsAppMessage(to, 'Kumusta po! Ito ay isang test message mula sa Mediko AI Chatbot. Gumagana na po ang WhatsApp integration!')
      return reply.send({ success: true, message: `Test message sent to ${to}` })
    } catch (err) {
      return reply.status(500).send({ success: false, error: err.message })
    }
  })


  /**
   * GET /api/meta/test-messenger?psid=RECIPIENT_PAGE_SCOPED_ID
   * Send a test Messenger message.
   */
  fastify.get('/test-messenger', {
    schema: {
      querystring: {
        type: 'object',
        required: ['psid'],
        properties: { psid: { type: 'string' } }
      }
    }
  }, async (request, reply) => {
    const { psid } = request.query

    try {
      const { sendMessengerMessage } = await import('../channels/messengerAdapter.js')
      await sendMessengerMessage(psid, 'Kumusta po! Ito ay isang test message mula sa Mediko AI Chatbot. Gumagana na po ang Messenger integration!')
      return reply.send({ success: true, message: `Test message sent to PSID ${psid}` })
    } catch (err) {
      return reply.status(500).send({ success: false, error: err.message })
    }
  })


  /**
   * POST /api/meta/simulate-whatsapp
   * Simulate an inbound WhatsApp message without needing a real phone.
   * Body: { from: "639171234567", text: "Ano ang pang-immunity?" }
   */
  fastify.post('/simulate-whatsapp', {
    schema: {
      body: {
        type: 'object',
        required: ['from', 'text'],
        properties: {
          from: { type: 'string' },
          text: { type: 'string', maxLength: 500 }
        }
      }
    }
  }, async (request, reply) => {
    const { from, text } = request.body

    // Build a realistic Meta webhook payload
    const simulatedPayload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'SIMULATED',
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            metadata:          { phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID || 'SIM' },
            contacts:          [{ profile: { name: 'Test User' }, wa_id: from }],
            messages:          [{ from, id: `sim_${Date.now()}`, timestamp: String(Date.now()), text: { body: text }, type: 'text' }]
          },
          field: 'messages'
        }]
      }]
    }

    try {
      const { fromWhatsAppWebhook } = await import('../channels/whatsappAdapter.js')
      const { handleInboundMessageDirect } = await import('./webhooks.js')

      const msg = await fromWhatsAppWebhook(simulatedPayload)
      if (!msg) return reply.send({ success: false, reason: 'Message not parsed (duplicate or non-text)' })

      // Return the AI response text synchronously for simulation
      const { processMessage }  = await import('../services/conversationManager.js')
      const { loadHistory, saveMessagePair } = await import('../services/sessionService.js')
      const { buildMessages }   = await import('../services/promptService.js')
      const { streamChat }      = await import('../services/openaiService.js')

      const decision = await processMessage(msg)

      if (decision.type !== 'ai') {
        return reply.send({ success: true, type: decision.type, response: null })
      }

      const history  = await loadHistory(decision.sessionId)
      const messages = buildMessages({
        userMessage: decision.text,
        history,
        products:    decision.products ?? [],
        order:       decision.order    ?? null
      })

      let fullText = ''
      for await (const event of streamChat(messages)) {
        if (event.type === 'chunk') fullText += event.text
      }

      await saveMessagePair(decision.sessionId, decision.text, fullText)

      return reply.send({
        success:    true,
        type:       'ai',
        sessionId:  decision.sessionId,
        from,
        userText:   text,
        response:   fullText,
        products:   (decision.products || []).map(p => p.title)
      })

    } catch (err) {
      fastify.log.error({ err: err.message }, 'Simulation error')
      return reply.status(500).send({ success: false, error: err.message })
    }
  })

}

function getBaseUrl(request) {
  const proto = request.headers['x-forwarded-proto'] || 'http'
  return `${proto}://${request.hostname}`
}
