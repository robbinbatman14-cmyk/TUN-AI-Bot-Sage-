const Anthropic = require('@anthropic-ai/sdk');
const usageTracker = require('../../logging/usageTracker');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';

/**
 * @param {Array<{role:string, content:string}>} messages - first "system" message is split out
 * @param {{json?: boolean, purpose?: string}} opts
 */
async function chat(messages, opts = {}) {
  const systemMsg = messages.find(m => m.role === 'system');
  const rest = messages.filter(m => m.role !== 'system');

  let system = systemMsg ? systemMsg.content : undefined;
  if (opts.json) {
    system = (system || '') + '\n\nRespond with ONLY valid JSON, no prose, no markdown fences.';
  }

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system,
    messages: rest.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
  });

  if (res.usage) {
    usageTracker.logUsage({
      provider: 'anthropic',
      purpose: opts.purpose || 'unknown',
      promptTokens: res.usage.input_tokens || 0,
      outputTokens: res.usage.output_tokens || 0
    });
  }

  return res.content.map(b => (b.type === 'text' ? b.text : '')).join('\n');
}

// Anthropic has no first-party embeddings endpoint, so embeddings
// always fall back to Gemini or OpenAI (see ai/providerManager.js)
// regardless of which provider is chosen for chat.
async function embed() {
  throw new Error('Anthropic does not provide an embeddings API. Embeddings fall back to Gemini/OpenAI — see src/ai/providerManager.js.');
}

async function embedBatch() {
  throw new Error('Anthropic does not provide an embeddings API. Embeddings fall back to Gemini/OpenAI — see src/ai/providerManager.js.');
}

module.exports = { chat, embed, embedBatch, name: 'anthropic' };
