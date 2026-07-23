// ============================================================
// API Usage & Cost Monitoring (Section 77)
// Logs token counts per call (when the provider reports them) so
// admins can see real usage via /ai costs, not just guess from
// provider dashboards. Cost estimates are rough — providers change
// pricing without notice — so figures are clearly labeled as
// estimates, never presented as exact billing.
// ============================================================
const db = require('../config/db');

// Rough published per-1M-token pricing, USD. Free-tier Gemini use is $0
// unless the project has billing enabled, so this is a ceiling estimate,
// not what you're actually being charged on the free tier.
const PRICING_PER_MILLION_TOKENS = {
  gemini: { input: 0.10, output: 0.40 },
  openai: { input: 0.15, output: 0.60 },
  anthropic: { input: 3.00, output: 15.00 }
};

function logUsage({ provider, purpose, promptTokens = 0, outputTokens = 0 }) {
  db.prepare(`
    INSERT INTO api_usage (provider, purpose, prompt_tokens, output_tokens) VALUES (?, ?, ?, ?)
  `).run(provider, purpose, promptTokens || 0, outputTokens || 0);
}

function estimateCost(provider, promptTokens, outputTokens) {
  const rate = PRICING_PER_MILLION_TOKENS[provider];
  if (!rate) return null;
  return (promptTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
}

function usageSummary({ sinceHours = 24 } = {}) {
  const rows = db.prepare(`
    SELECT provider, purpose, COUNT(*) as calls, SUM(prompt_tokens) as prompt_tokens, SUM(output_tokens) as output_tokens
    FROM api_usage
    WHERE timestamp >= datetime('now', ?)
    GROUP BY provider, purpose
  `).all(`-${sinceHours} hours`);

  let totalCalls = 0, totalCost = 0;
  const byProvider = {};
  for (const row of rows) {
    totalCalls += row.calls;
    const cost = estimateCost(row.provider, row.prompt_tokens || 0, row.output_tokens || 0);
    if (cost !== null) totalCost += cost;
    byProvider[row.provider] = byProvider[row.provider] || { calls: 0, promptTokens: 0, outputTokens: 0 };
    byProvider[row.provider].calls += row.calls;
    byProvider[row.provider].promptTokens += row.prompt_tokens || 0;
    byProvider[row.provider].outputTokens += row.output_tokens || 0;
  }

  return { totalCalls, estimatedCostUSD: totalCost, byProvider, breakdown: rows };
}

module.exports = { logUsage, usageSummary };
