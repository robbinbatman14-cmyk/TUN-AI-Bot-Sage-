// ============================================================
// Diagnostic: lists every Gemini model your GEMINI_API_KEY can
// currently access, so you can pick a working model ID if the
// default alias ever errors out for your key.
// Run with: npm run list-gemini-models
// ============================================================
require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

(async () => {
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY is not set in .env');
    process.exit(1);
  }
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  console.log('Models available to your API key:\n');
  let page = await client.models.list();
  while (true) {
    for (const model of page.page || page) {
      const actions = model.supportedActions?.join(', ') || model.supportedGenerationMethods?.join(', ') || '';
      console.log(`- ${model.name}  [${actions}]`);
    }
    if (page.hasNextPage && page.hasNextPage()) {
      page = await page.nextPage();
    } else {
      break;
    }
  }
})().catch(err => {
  console.error('Failed to list models:', err.message);
  process.exit(1);
});
