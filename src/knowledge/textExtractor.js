// ============================================================
// Text Extractor (Section 29 - Supported Knowledge Sources)
// Converts an uploaded Discord attachment into plain text ready
// for chunking/embedding, regardless of source format.
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
 * Downloads a Discord attachment and extracts its plain text content.
 * @param {{url: string, name: string}} attachment
 * @returns {Promise<string>}
 */
async function extractText(attachment) {
  const ext = getExtension(attachment.name);
  const res = await fetch(attachment.url);

  if (ext === '.txt' || ext === '.md') {
    return res.text();
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
      return data.text;
    } catch (err) {
      throw new Error(`Failed to extract text from PDF: ${err.message}`);
    }
  }

  if (ext === '.docx') {
    const mammoth = require('mammoth');
    try {
      const result = await mammoth.extractRawText({ buffer });
      if (!result.value || !result.value.trim()) {
        throw new Error('No extractable text found in this .docx file.');
      }
      return result.value;
    } catch (err) {
      throw new Error(`Failed to extract text from DOCX: ${err.message}`);
    }
  }

  throw new Error(`Unsupported file type "${ext}". Supported types: ${SUPPORTED_EXTENSIONS.join(', ')}`);
}

module.exports = { extractText, isSupported, SUPPORTED_EXTENSIONS };
