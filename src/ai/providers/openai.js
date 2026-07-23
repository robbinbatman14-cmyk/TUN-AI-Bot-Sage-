const OpenAI = require('openai');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const CHAT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const EMBED_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

/**
 * @param {Array<{role:string, content:string}>} messages
 * @param {{json?: boolean}} opts
 * @returns {Promise<string>} raw text response
 */
async function chat(messages, opts = {}) {
  const res = await client.chat.completions.create({
    model: CHAT_MODEL,
    messages,
    temperature: 0.3,
    response_format: opts.json ? { type: 'json_object' } : undefined
  });
  return res.choices[0].message.content;
}

async function embed(text) {
  const res = await client.embeddings.create({ model: EMBED_MODEL, input: text });
  return res.data[0].embedding;
}

module.exports = { chat, embed, name: 'openai' };
