/**
 * geminiService.js
 *
 * Google Gemini backend (replaces the old OpenAI service).
 * Keeps the same public API so the routes are unchanged:
 *   streamChat(messages) → async generator of
 *      { type: 'chunk', text }   and   { type: 'done', fullText, totalTokens }
 *
 * `messages` is still the OpenAI-style array that promptService.buildMessages
 * produces ([{role:'system'|'user'|'assistant', content}]). We translate it to
 * Gemini's shape: a separate `systemInstruction` plus `contents` where the
 * assistant role becomes 'model'.
 */

import { GoogleGenAI } from '@google/genai'

const MODEL           = process.env.GEMINI_MODEL           || 'gemini-2.5-flash'
const MAX_TOKENS      = parseInt(process.env.GEMINI_MAX_TOKENS      || '4096', 10)
const TEMPERATURE     = parseFloat(process.env.GEMINI_TEMPERATURE   || '0.7')
// Gemini 2.5 models "think" before answering, spending output tokens on it.
// Default 0 disables thinking so the whole budget goes to the visible reply
// (faster, cheaper — like the old reasoning_effort:'low'). Raise to re-enable.
const THINKING_BUDGET = parseInt(process.env.GEMINI_THINKING_BUDGET || '0', 10)

// Lazy client — don't require the key at import time so the app can still boot
// with the AI kill-switch off (AI_ENABLED=false).
let _ai
function client() {
  if (!_ai) {
    if (!process.env.GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY env var')
    _ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  }
  return _ai
}

/**
 * Convert OpenAI-style messages → Gemini { systemInstruction, contents }.
 * System messages are concatenated into systemInstruction; consecutive
 * same-role turns are merged (Gemini expects alternating user/model).
 *
 * @param {Array<{role:string, content:string}>} messages
 */
export function toGeminiFormat(messages) {
  let systemInstruction = ''
  const contents = []

  for (const m of messages) {
    if (m.role === 'system') {
      systemInstruction = systemInstruction ? `${systemInstruction}\n\n${m.content}` : m.content
      continue
    }
    const role = m.role === 'assistant' ? 'model' : 'user'
    const last = contents[contents.length - 1]
    if (last && last.role === role) {
      last.parts.push({ text: m.content })   // merge consecutive same-role turns
    } else {
      contents.push({ role, parts: [{ text: m.content }] })
    }
  }

  return { systemInstruction: systemInstruction || undefined, contents }
}

function buildConfig(systemInstruction) {
  const config = {
    maxOutputTokens: MAX_TOKENS,
    temperature:     TEMPERATURE,
    thinkingConfig:  { thinkingBudget: THINKING_BUDGET }
  }
  if (systemInstruction) config.systemInstruction = systemInstruction
  return config
}

/**
 * Stream a chat completion from Gemini.
 *
 * Yields:
 *   { type: 'chunk', text: string }
 *   { type: 'done',  fullText: string, totalTokens: number }
 */
export async function* streamChat(messages) {
  const { systemInstruction, contents } = toGeminiFormat(messages)

  const stream = await client().models.generateContentStream({
    model:   MODEL,
    contents,
    config:  buildConfig(systemInstruction)
  })

  let fullText    = ''
  let totalTokens = 0

  for await (const chunk of stream) {
    const text = chunk.text   // getter — concatenates this chunk's text parts
    if (text) {
      fullText += text
      yield { type: 'chunk', text }
    }
    // usageMetadata arrives on the final chunk(s); keep the latest count.
    const used = chunk.usageMetadata?.totalTokenCount
    if (used) totalTokens = used
  }

  yield { type: 'done', fullText, totalTokens }
}

/**
 * Non-streaming version — for tests or simple one-off calls.
 */
export async function chat(messages) {
  const { systemInstruction, contents } = toGeminiFormat(messages)

  const response = await client().models.generateContent({
    model:   MODEL,
    contents,
    config:  buildConfig(systemInstruction)
  })

  return {
    text:        response.text ?? '',
    totalTokens: response.usageMetadata?.totalTokenCount ?? 0
  }
}
