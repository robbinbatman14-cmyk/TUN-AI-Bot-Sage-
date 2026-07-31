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
  if (match) return Math.min(Number(match[1]) + 1, 35); // +1s buffer, cap wait at 35s
  return 5;
}

/**
 * Google's 429 errors cover two very different situations, and treating
 * them the same is actively misleading: a per-minute/burst limit clears
 * within seconds and a short retry genuinely helps; a per-day (RPD) limit
 * won't clear until midnight Pacific Time no matter how long you wait
 * this session — retrying it just wastes time and adds pointless delay
 * before showing the real problem. Google's error always names the quota
 * ("...PerDay..." vs "...PerMinute...") so this is detected directly from
 * the message rather than guessed.
 */
function classifyQuotaError(err) {
  const msg = err?.message || '';
  if (/PerDay/i.test(msg)) return 'daily';
  if (/PerMinute/i.test(msg)) return 'per_minute';
  return 'unknown';
}

/**
 * Generic retry-with-backoff wrapper for any Gemini SDK call, used for
 * both chat (generateContent) and embeddings (embedContent). Skips
 * retrying entirely for a daily-quota 429 (see classifyQuotaError) since
 * no amount of waiting within a retry loop fixes that — it fails fast
 * instead, so the caller's error message shows up immediately rather
 * than after ~100s of pointless retries.
 * @param {() => Promise<any>} fn
 */
async function withRetry(fn, attempt = 1) {
  try {
    return await fn();
  } catch (err) {
    if (err?.status === 429 && classifyQuotaError(err) === 'daily') {
      throw err; // fail fast — retrying cannot help a daily cap
    }
    if (err?.status === 429 && attempt < 3) {
      const waitSeconds = extractRetryDelaySeconds(err);
      console.warn(`[Gemini] Rate limited (per-minute), retrying in ${waitSeconds}s (attempt ${attempt}/2)...`);
      await new Promise(r => setTimeout(r, waitSeconds * 1000));
      return withRetry(fn, attempt + 1);
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
    response = await withRetry(() => client.models.generateContent({ model: CHAT_MODEL, contents, config }));
  } catch (err) {
    if (err?.status === 404 || /no longer available|not found/i.test(err?.message || '')) {
      throw new Error(
        `Gemini model "${CHAT_MODEL}" is unavailable for this API key (${err.message}). ` +
        `Try setting GEMINI_MODEL=gemini-flash-lite-latest in .env (the auto-updating alias), ` +
        `or run "npm run list-gemini-models" to see exactly which models your key can access.`
      );
    }
    if (err?.status === 429) {
      if (classifyQuotaError(err) === 'daily') {
        throw new Error(
          `Gemini's free-tier DAILY quota is used up for this model (${err.message}). ` +
          `This resets at midnight Pacific Time — it's not a short-lived limit, so retrying now (or in a minute) won't help no matter how many times you try today. ` +
          `Options: wait for the reset, enable billing on the same Google AI Studio project for much higher limits, ` +
          `or run "/ai provider openai" (or anthropic) to switch providers if you have another key configured.`
        );
      }
      throw new Error(
        `Gemini free-tier quota exceeded even after retrying (${err.message}). ` +
        `This looks like a short-lived per-minute limit, not the daily cap — waiting a bit and trying again should work. ` +
        `If it keeps happening, enable billing on the same Google AI Studio project for higher limits.`
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

// Kept intentionally modest (well under the community-reported ~150-item
// practical cap): a real production error showed a free-tier embedding
// quota metric named "EmbedContentRequestsPerMinute...FreeTier" with a
// limit of 100 — since we can't be certain whether that quota counts per
// HTTP call or per text item inside a batch, staying well under 100
// items per call is cheap insurance either way, combined with the retry
// logic below for whichever case turns out to be true.
const EMBED_BATCH_SIZE = 40;

/**
 * Embeds many texts in as few API requests as possible, with automatic
 * retry-with-backoff on rate-limit errors (see withRetry) and a short
 * pacing delay between batches so a large multi-batch document doesn't
 * burst several requests in the same instant.
 * @param {string[]} texts
 * @returns {Promise<number[][]>} one embedding vector per input, same order
 */
async function embedBatch(texts) {
  if (texts.length === 0) return [];

  const allValues = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);

    let response;
    try {
      response = await withRetry(() => client.models.embedContent({ model: EMBED_MODEL, contents: batch }));
    } catch (err) {
      if (err?.status === 429) {
        if (classifyQuotaError(err) === 'daily') {
          throw new Error(
            `Gemini's free-tier DAILY embedding quota is used up (${err.message}). ` +
            `This resets at midnight Pacific Time — retrying now, or in a minute, or even later today won't help; it's not a short-lived limit. ` +
            `Options: wait for the reset, enable billing on the same Google AI Studio project for much higher limits, ` +
            `or run "/ai provider openai" if you have an OpenAI key configured, which uses a separate embedding quota entirely.`
          );
        }
        throw new Error(
          `Gemini embedding quota exceeded even after retrying (${err.message}). ` +
          `This looks like a short-lived per-minute limit, not the daily cap — waiting a bit and retrying (e.g. /knowledge reindex) should work. ` +
          `If it keeps happening, enable billing on the same Google AI Studio project for higher limits.`
        );
      }
      throw err;
    }

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

    // Small pacing gap between batches (not after the last one) so a
    // large document's several batches don't all fire in the same instant.
    if (i + EMBED_BATCH_SIZE < texts.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return allValues;
}

async function embed(text) {
  const [vector] = await embedBatch([text]);
  return vector;
}

/**
 * Vision: describes/OCRs a single image. Used for indexing images found
 * inside uploaded/synced documents (Dynamic Knowledge Sources — image
 * analysis). Uses the same CHAT_MODEL as chat() since Gemini's Flash-Lite
 * line is multimodal, so this doesn't cost a separate model's quota.
 * @param {string} base64Data - raw base64, no data: URL prefix
 * @param {string} mimeType - e.g. "image/png"
 * @param {string} prompt
 * @returns {Promise<string>}
 */
async function describeImage(base64Data, mimeType, prompt) {
  const response = await withRetry(() => client.models.generateContent({
    model: CHAT_MODEL,
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType, data: base64Data } },
        { text: prompt }
      ]
    }]
  }));

  const text = response.text;
  if (typeof text !== 'string') {
    throw new Error('Gemini vision returned an unexpected response shape (no .text field). The image may have been blocked by safety filters.');
  }

  const usage = response.usageMetadata;
  if (usage) {
    usageTracker.logUsage({
      provider: 'gemini',
      purpose: 'vision',
      promptTokens: usage.promptTokenCount || 0,
      outputTokens: usage.candidatesTokenCount || 0
    });
  }

  return text;
}

module.exports = { chat, embed, embedBatch, describeImage, name: 'gemini' };
