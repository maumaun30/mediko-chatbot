/**
 * responseDispatcher.js
 *
 * Sends a reply text back to wherever the message came from.
 * Each channel has a different send mechanism:
 *   widget    → SSE stream (handled directly in the route, not here)
 *   whatsapp  → Meta Cloud API REST call
 *   messenger → Meta Graph API REST call
 */

import { sendWhatsAppMessage }  from '../channels/whatsappAdapter.js'
import { sendMessengerMessage } from '../channels/messengerAdapter.js'

/**
 * Dispatch a text reply to the appropriate channel.
 *
 * For the widget channel, the route handles SSE streaming directly —
 * call this only for async channels (WhatsApp, Messenger).
 *
 * @param {string} channel        — 'whatsapp' | 'messenger' | 'widget'
 * @param {string} channelUserId  — recipient identifier for the channel
 * @param {string} text           — message to send
 */
export async function dispatchReply(channel, channelUserId, text) {
  switch (channel) {
    case 'whatsapp':
      await sendWhatsAppMessage(channelUserId, text)
      break

    case 'messenger':
      await sendMessengerMessage(channelUserId, text)
      break

    case 'widget':
      // Widget replies are streamed via SSE in the route handler.
      // This dispatcher is a no-op for widget — included for completeness.
      break

    default:
      throw new Error(`dispatchReply: unknown channel "${channel}"`)
  }
}

/**
 * Send a "holding" message to tell the customer an agent is joining.
 * Used immediately when a handoff is triggered.
 *
 * @param {string} channel
 * @param {string} channelUserId
 */
export async function dispatchHandoffAck(channel, channelUserId) {
  const text =
    'Sandali lang po. Ikinokonekta ko kayo sa isa sa aming team. ' +
    'Maaaring may ilang minuto bago sumagot ang ahente.'

  if (channel !== 'widget') {
    await dispatchReply(channel, channelUserId, text)
  }
  // For widget the SSE route sends this text directly so the stream stays open.
}

/**
 * Send a message when AI resumes control after a handoff.
 *
 * @param {string} channel
 * @param {string} channelUserId
 */
export async function dispatchHandoffReturn(channel, channelUserId) {
  const text =
    'Naibalik na po kayo sa aming AI assistant na si Medi. ' +
    'Paano ko pa kayo matutulungan?'

  if (channel !== 'widget') {
    await dispatchReply(channel, channelUserId, text)
  }
}
