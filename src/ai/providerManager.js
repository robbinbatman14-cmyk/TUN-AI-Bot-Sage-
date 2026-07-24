// ============================================================
// AI Provider Manager (Section 107 / 108)
// The rest of the application calls chat()/embed() from HERE
// and never imports openai/anthropic/gemini directly. Switching
// providers is a config change (/ai provider openai|anthropic),
// not a code change.
// ============================================================
const configManager = require('../config/configManager');
const openai = require('./providers/openai');
const anthropic = require('./providers/anthropic');
const gemini = require('./providers/gemini');

const PROVIDERS = { openai, anthropic, gemini };

function currentProvider() {
  const name = configManager.get('ai_provider') || 'gemini';
  return PROVIDERS[name] || gemini;
}

async function chat(messages, opts = {}) {
  const provider = currentProvider();
  try {
    return await provider.chat(messages, opts);
  } catch (err) {
    console.error(`[AI Provider Error] ${provider.name}:`, err.message);
    throw err;
  }
}

// Embeddings use whichever provider is active — this is what makes
// "/ai provider openai" later switch BOTH chat and knowledge-base
// search over to OpenAI with no code change. The one exception is
// Anthropic, which has no embeddings API at all: if it's the active
// chat provider, embeddings fall back to Gemini (or OpenAI) so the
// knowledge base keeps working even while chat runs on Claude.
async function embed(text) {
  const provider = currentProvider();
  if (provider.name === 'anthropic') {
    if (process.env.GEMINI_API_KEY) return gemini.embed(text);
    if (process.env.OPENAI_API_KEY) return openai.embed(text);
    throw new Error('Anthropic has no embeddings API, and neither GEMINI_API_KEY nor OPENAI_API_KEY is set for a fallback embedding provider.');
  }
  return provider.embed(text);
}

/**
 * Batched form of embed() — embeds many texts in as few requests as
 * possible (see each provider's embedBatch). Always prefer this over
 * calling embed() in a loop when embedding more than one piece of text,
 * since looping burns one quota-counted request per item instead of one
 * request for the whole batch.
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
async function embedBatch(texts) {
  const provider = currentProvider();
  if (provider.name === 'anthropic') {
    if (process.env.GEMINI_API_KEY) return gemini.embedBatch(texts);
    if (process.env.OPENAI_API_KEY) return openai.embedBatch(texts);
    throw new Error('Anthropic has no embeddings API, and neither GEMINI_API_KEY nor OPENAI_API_KEY is set for a fallback embedding provider.');
  }
  return provider.embedBatch(texts);
}

/**
 * Vision: describes/OCRs a single image. Unlike embed()/embedBatch(),
 * no Anthropic-fallback branch is needed — all three providers implement
 * this natively (Gemini, GPT-4o-mini, and Claude are all multimodal),
 * so this just routes to whichever provider is currently active.
 * @param {string} base64Data - raw base64, no data: URL prefix
 * @param {string} mimeType - e.g. "image/png"
 * @param {string} prompt
 * @returns {Promise<string>}
 */
async function describeImage(base64Data, mimeType, prompt) {
  const provider = currentProvider();
  try {
    return await provider.describeImage(base64Data, mimeType, prompt);
  } catch (err) {
    console.error(`[AI Provider Error] ${provider.name} (vision):`, err.message);
    throw err;
  }
}

module.exports = {
  chat, embed, embedBatch, describeImage,
  currentProviderName: () => currentProvider().name,
  PROVIDERS: Object.keys(PROVIDERS)
};
