import OpenAI from 'openai'

if (!process.env.OPENAI_API_KEY) {
  throw new Error('Missing OPENAI_API_KEY env var')
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const MODEL       = process.env.OPENAI_MODEL       || 'gpt-4o'
const MAX_TOKENS  = parseInt(process.env.OPENAI_MAX_TOKENS  || '600', 10)
const TEMPERATURE = parseFloat(process.env.OPENAI_TEMPERATURE || '0.7')

/**
 * gpt-5-* and o-series are reasoning models:
 *   - use max_completion_tokens (not max_tokens)
 *   - do NOT support temperature
 *   - reasoning tokens are drawn from the same max_completion_tokens budget,
 *     so the limit must be high enough to cover reasoning + visible reply.
 *     Setting reasoning_effort="low" minimises the reasoning spend.
 */
const IS_NEW_STYLE = /^(o1|o3|o4|gpt-5|gpt-4\.5)/.test(MODEL)

function buildParams(extra = {}) {
  return {
    model: MODEL,
    ...(IS_NEW_STYLE
      ? {
          max_completion_tokens: MAX_TOKENS,  // 4096 — covers reasoning + reply
          reasoning_effort: 'low'             // keeps reasoning budget small
        }
      : {
          max_tokens: MAX_TOKENS,
          temperature: TEMPERATURE
        }
    ),
    ...extra
  }
}

/**
 * Stream a chat completion from OpenAI.
 *
 * Yields:
 *   { type: 'chunk', text: string }
 *   { type: 'done',  fullText: string, totalTokens: number }
 */
export async function* streamChat(messages) {
  const stream = await openai.chat.completions.create({
    ...buildParams({ stream: true, stream_options: { include_usage: true } }),
    messages
  })

  let fullText    = ''
  let totalTokens = 0

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content

    if (delta) {
      fullText += delta
      yield { type: 'chunk', text: delta }
    }

    if (chunk.usage?.total_tokens) {
      totalTokens = chunk.usage.total_tokens
    }
  }

  yield { type: 'done', fullText, totalTokens }
}

/**
 * Non-streaming version — for tests or simple one-off calls.
 */
export async function chat(messages) {
  const response = await openai.chat.completions.create({
    ...buildParams(),
    messages
  })

  return {
    text: response.choices[0].message.content,
    totalTokens: response.usage?.total_tokens ?? 0
  }
}
