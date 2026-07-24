// ============================================================
// Text Extractor (Section 29 - Supported Knowledge Sources)
// Converts an uploaded Discord attachment into plain text (and,
// for .docx, embedded images) ready for chunking/embedding.
// Image extraction only applies to .docx, since that's the format
// mammoth can pull embedded images out of directly. PDF image
// extraction was deliberately left out — the well-known Node
// libraries for it either need native build tools (the same class
// of Windows Build Tools pain hit earlier with better-sqlite3) or
// page rasterization via a canvas backend, which carries the same
// risk. Flagged as a known gap rather than silently skipped.
// ============================================================
const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.pdf', '.docx'];

function getExtension(filename) {
  const match = filename.toLowerCase().match(/\.[a-z0-9]+$/);
  return match ? match[0] : '';
}

function isSupported(filename) {
  return SUPPORTED_EXTENSIONS.includes(getExtension(filename));
}

/**
 * Extracts both raw text and embedded images from a .docx buffer using
 * mammoth's image hook (mammoth.images.imgElement), which intercepts
 * each embedded image during conversion and hands back its bytes.
 * @param {Buffer} buffer
 * @returns {Promise<{text: string, images: Array<{base64: string, contentType: string}>}>}
 */
async function extractDocxTextAndImages(buffer) {
  const mammoth = require('mammoth');
  const images = [];

  // convertToHtml is what triggers the image-read hook; the HTML output
  // itself is discarded — extractRawText (below) is what's actually used
  // for the document's text content, since it's cleaner plain text.
  await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement(async image => {
        const base64 = await image.read('base64');
        images.push({ base64, contentType: image.contentType || 'image/png' });
        return {}; // no src needed — HTML output isn't used
      })
    }
  );

  const textResult = await mammoth.extractRawText({ buffer });
  return { text: textResult.value, images };
}

/**
 * Downloads a Discord attachment and extracts its content.
 * @param {{url: string, name: string}} attachment
 * @returns {Promise<{text: string, images: Array<{base64: string, contentType: string}>}>}
 */
async function extractContent(attachment) {
  const ext = getExtension(attachment.name);
  const res = await fetch(attachment.url);

  if (ext === '.txt' || ext === '.md') {
    return { text: await res.text(), images: [] };
  }

  const buffer = Buffer.from(await res.arrayBuffer());

  if (ext === '.pdf') {
    // Lazy-required so a missing/broken pdf-parse install doesn't break
    // the whole bot — only .pdf uploads would fail, with a clear error.
    const pdfParse = require('pdf-parse');
    try {
      const data = await pdfParse(buffer);
      if (!data.text || !data.text.trim()) {
        throw new Error('No extractable text found (this is likely a scanned/image-only PDF, which needs OCR — not supported here).');
      }
      return { text: data.text, images: [] }; // PDF image extraction not supported — see file header
    } catch (err) {
      throw new Error(`Failed to extract text from PDF: ${err.message}`);
    }
  }

  if (ext === '.docx') {
    try {
      const { text, images } = await extractDocxTextAndImages(buffer);
      if (!text || !text.trim()) {
        throw new Error('No extractable text found in this .docx file.');
      }
      return { text, images };
    } catch (err) {
      throw new Error(`Failed to extract content from DOCX: ${err.message}`);
    }
  }

  throw new Error(`Unsupported file type "${ext}". Supported types: ${SUPPORTED_EXTENSIONS.join(', ')}`);
}

/** Back-compat convenience for callers that only want the text. */
async function extractText(attachment) {
  return (await extractContent(attachment)).text;
}

module.exports = { extractContent, extractText, extractDocxTextAndImages, isSupported, SUPPORTED_EXTENSIONS };
