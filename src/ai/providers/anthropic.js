const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';

/**
 * @param {Array<{role:string, content:string}>} messages - first "system" message is split out
 * @param {{json?: boolean}} opts
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
  return res.content.map(b => (b.type === 'text' ? b.text : '')).join('\n');
}

// Anthropic has no first-party embeddings endpoint, so embeddings
// always fall back to OpenAI (see ai/embeddings.js) regardless of
// which provider is chosen for chat.
async function embed() {
  throw new Error('Anthropic does not provide an embeddings API. Embeddings always use OpenAI — see src/ai/embeddings.js.');
}

module.exports = { chat, embed, name: 'anthropic' };
