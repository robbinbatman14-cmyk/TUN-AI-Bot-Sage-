const OpenAI = require('openai');
const usageTracker = require('../../logging/usageTracker');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const CHAT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const EMBED_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

/**
 * @param {Array<{role:string, content:string}>} messages
 * @param {{json?: boolean, purpose?: string}} opts
 * @returns {Promise<string>} raw text response
 */
async function chat(messages, opts = {}) {
  const res = await client.chat.completions.create({
    model: CHAT_MODEL,
    messages,
    temperature: 0.3,
    response_format: opts.json ? { type: 'json_object' } : undefined
  });

  if (res.usage) {
    usageTracker.logUsage({
      provider: 'openai',
      purpose: opts.purpose || 'unknown',
      promptTokens: res.usage.prompt_tokens || 0,
      outputTokens: res.usage.completion_tokens || 0
    });
  }

  return res.choices[0].message.content;
}

/**
 * OpenAI's embeddings endpoint accepts an array of inputs in one request,
 * same batching benefit as Gemini's — used so document indexing costs
 * one request regardless of chunk count.
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
async function embedBatch(texts) {
  if (texts.length === 0) return [];
  const res = await client.embeddings.create({ model: EMBED_MODEL, input: texts });
  if (res.usage) {
    usageTracker.logUsage({
      provider: 'openai',
      purpose: 'embed',
      promptTokens: res.usage.prompt_tokens || 0,
      outputTokens: 0
    });
  }
  return res.data.map(d => d.embedding);
}

async function embed(text) {
  const [vector] = await embedBatch([text]);
  return vector;
}

/**
 * Vision: describes/OCRs a single image. gpt-4o-mini is multimodal, so
 * this reuses CHAT_MODEL rather than needing a separate vision model.
 * @param {string} base64Data - raw base64, no data: URL prefix
 * @param {string} mimeType - e.g. "image/png"
 * @param {string} prompt
 * @returns {Promise<string>}
 */
async function describeImage(base64Data, mimeType, prompt) {
  const res = await client.chat.completions.create({
    model: CHAT_MODEL,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } }
      ]
    }]
  });

  if (res.usage) {
    usageTracker.logUsage({
      provider: 'openai',
      purpose: 'vision',
      promptTokens: res.usage.prompt_tokens || 0,
      outputTokens: res.usage.completion_tokens || 0
    });
  }

  return res.choices[0].message.content;
}

module.exports = { chat, embed, embedBatch, describeImage, name: 'openai' };
