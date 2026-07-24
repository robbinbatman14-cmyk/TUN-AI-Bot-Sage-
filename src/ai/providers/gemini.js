// ============================================================
// Google Gemini provider — Version 1.0 default (free-tier friendly).
// Uses @google/genai, Google's current unified SDK (the older
// @google/generative-ai package is deprecated). Implements the
// same chat()/embed() shape as the OpenAI and Anthropic providers
// so providerManager.js and everything above it stays unchanged
// no matter which provider is active (Section 107).
// ============================================================
const { GoogleGenAI } = require('@google/genai');
const usageTracker = require('../../logging/usageTracker');

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Uses the auto-updating "-lite" alias rather than a hardcoded generation
// (e.g. gemini-2.5-flash-lite) because Google has started gating older
// generations behind "existing projects only" — a brand-new API key can get
// a 404 "no longer available to new users" on a hardcoded older model ID.
//
// Specifically flash-LITE, not plain flash: gemini-flash-latest currently
// resolves to a brand-new preview model (gemini-3.6-flash at time of
// writing) that Google has provisioned with a tiny free-tier quota — as
// low as 20 requests/day, which a Discord bot burns through in minutes
// since each question costs 2+ calls (classify + answer). The Flash-Lite
// line has consistently kept a far more generous free daily quota
// (roughly 1,000-1,500 requests/day) across generations, since it's
// Google's designated high-volume/low-cost tier rather than their newest
// showcase model. Override with GEMINI_MODEL in .env if you want a
// specific pinned version instead of always-latest.
const CHAT_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
const EMBED_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';

function extractRetryDelaySeconds(err) {
  const match = /retry in ([\d.]+)s/i.exec(err?.message || '');
  if (match) return Math.min(Number(match[1]), 30); // cap wait at 30s
  return 5;
}

async function generateWithRetry(params, attempt = 1) {
  try {
    return await client.models.generateContent(params);
  } catch (err) {
    if (err?.status === 429 && attempt < 3) {
      const waitSeconds = extractRetryDelaySeconds(err);
      console.warn(`[Gemini] Rate limited, retrying in ${waitSeconds}s (attempt ${attempt}/2)...`);
      await new Promise(r => setTimeout(r, waitSeconds * 1000));
      return generateWithRetry(params, attempt + 1);
    }
    throw err;
  }
}

/**
 * @param {Array<{role:string, content:string}>} messages - first "system" message is split out
 * @param {{json?: boolean}} opts
 */
async function chat(messages, opts = {}) {
  const systemMsg = messages.find(m => m.role === 'system');
  const rest = messages.filter(m => m.role !== 'system');

  const contents = rest.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  const config = {};
  if (systemMsg) config.systemInstruction = systemMsg.content;
  if (opts.json) config.responseMimeType = 'application/json';

  let response;
  try {
    response = await generateWithRetry({ model: CHAT_MODEL, contents, config });
  } catch (err) {
    if (err?.status === 404 || /no longer available|not found/i.test(err?.message || '')) {
      throw new Error(
        `Gemini model "${CHAT_MODEL}" is unavailable for this API key (${err.message}). ` +
        `Try setting GEMINI_MODEL=gemini-flash-lite-latest in .env (the auto-updating alias), ` +
        `or run "npm run list-gemini-models" to see exactly which models your key can access.`
      );
    }
    if (err?.status === 429) {
      throw new Error(
        `Gemini free-tier quota exceeded even after retrying (${err.message}). ` +
        `Either wait for the daily quota to reset, enable billing on the same Google AI Studio project for higher limits, ` +
        `or run "/ai provider openai" (or anthropic) to switch providers if you have another key configured.`
      );
    }
    throw err;
  }

  const text = response.text;
  if (typeof text !== 'string') {
    throw new Error('Gemini returned an unexpected response shape (no .text field). The response may have been blocked by safety filters.');
  }

  const usage = response.usageMetadata;
  if (usage) {
    usageTracker.logUsage({
      provider: 'gemini',
      purpose: opts.purpose || 'unknown',
      promptTokens: usage.promptTokenCount || 0,
      outputTokens: usage.candidatesTokenCount || 0
    });
  }

  return text;
}

// Community-reported practical cap on how many texts Gemini's
// batchEmbedContents endpoint accepts per call; chunked conservatively
// under that so a very large document still works, just in more than
// one request rather than one-per-chunk.
const EMBED_BATCH_SIZE = 100;

/**
 * Embeds many texts in as few API requests as possible. This is the
 * main lever for free-tier embedding quota: Gemini's embedContent
 * endpoint accepts an array and returns one embedding per input while
 * only counting as ONE request against the daily quota — so indexing
 * a 20-chunk document costs 1 request here instead of 20.
 * @param {string[]} texts
 * @returns {Promise<number[][]>} one embedding vector per input, same order
 */
async function embedBatch(texts) {
  if (texts.length === 0) return [];

  const allValues = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    const response = await client.models.embedContent({ model: EMBED_MODEL, contents: batch });

    const values = response.embeddings?.map(e => e.values);
    if (!values || values.length !== batch.length) {
      throw new Error(`Gemini batch embedding response didn't return one vector per input (expected ${batch.length}, got ${values?.length ?? 0}).`);
    }
    allValues.push(...values);

    if (response.usageMetadata) {
      usageTracker.logUsage({
        provider: 'gemini',
        purpose: 'embed',
        promptTokens: response.usageMetadata.promptTokenCount || 0,
        outputTokens: 0
      });
    }
  }
  return allValues;
}

async function embed(text) {
  const [vector] = await embedBatch([text]);
  return vector;
}

module.exports = { chat, embed, embedBatch, name: 'gemini' };
