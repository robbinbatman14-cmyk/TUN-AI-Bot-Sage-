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

module.exports = { chat, embed, currentProviderName: () => currentProvider().name, PROVIDERS: Object.keys(PROVIDERS) };
