// ============================================================
// Image Analyzer (Dynamic Knowledge Sources — image analysis)
// Turns extracted embedded images (diagrams, flowcharts, screenshots,
// infographics) into searchable text: a concise description plus OCR
// of any readable text in the image. Descriptions are appended to a
// document's indexed text as a clearly-labeled section, so the
// knowledge base can answer questions grounded in visual content,
// not just prose.
//
// Capped per document (MAX_IMAGES_PER_DOCUMENT) to protect the AI
// provider's shared request quota — a document with dozens of images
// would otherwise spend dozens of vision requests on a single index.
// ============================================================
const ai = require('../ai/providerManager');
const configManager = require('../config/configManager');

const MAX_IMAGES_PER_DOCUMENT = 15;

const DESCRIPTION_PROMPT = `This image is embedded in an alliance guide document for a Politics & War Discord community. In under 200 words: describe concisely what it shows (e.g. diagram, flowchart, screenshot, infographic, chart, table) and its key content/meaning. Then on a new line starting with "OCR:", transcribe verbatim any readable text in the image — leave it as "OCR: (none)" if there's no legible text.`;

/**
 * @param {Array<{base64: string, contentType: string}>} images
 * @returns {Promise<string[]>} one formatted text block per analyzed image
 */
async function describeImages(images) {
  if (!configManager.getBool('process_document_images')) {
    return images.length
      ? [`(This document contains ${images.length} image(s) that were not analyzed — image processing is currently disabled via /ai document-images.)`]
      : [];
  }

  const capped = images.slice(0, MAX_IMAGES_PER_DOCUMENT);
  const blocks = [];

  for (let i = 0; i < capped.length; i++) {
    const img = capped[i];
    try {
      const description = await ai.describeImage(img.base64, img.contentType, DESCRIPTION_PROMPT);
      blocks.push(`[Image ${i + 1}]\n${description.trim()}`);
    } catch (err) {
      console.error(`[UNAI] Failed to analyze image ${i + 1}:`, err.message);
      blocks.push(`[Image ${i + 1}]\n(Could not be analyzed: ${err.message})`);
    }
  }

  if (images.length > MAX_IMAGES_PER_DOCUMENT) {
    blocks.push(`(This document contains ${images.length} images; only the first ${MAX_IMAGES_PER_DOCUMENT} were analyzed to protect API quota. Consider splitting very image-heavy documents.)`);
  }

  return blocks;
}

/** Appends analyzed-image blocks to a document's extracted text as a labeled section. */
function appendImageDescriptions(text, imageBlocks) {
  if (!imageBlocks || imageBlocks.length === 0) return text;
  return `${text}\n\n--- Images in this document ---\n\n${imageBlocks.join('\n\n')}`;
}

module.exports = { describeImages, appendImageDescriptions, MAX_IMAGES_PER_DOCUMENT };
