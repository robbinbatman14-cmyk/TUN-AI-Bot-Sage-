// ============================================================
// Google Docs Source Reader (Section 29 - Dynamic Knowledge
// Sources; image analysis)
// Reads a Google Doc via its public export endpoint rather than
// the full Google Docs API — deliberately avoids needing a Google
// Cloud project, service account, or OAuth setup. The tradeoff is
// that the doc must be shared as "Anyone with the link – Viewer".
// That's a real security tradeoff worth knowing: the raw document
// is then reachable by anyone who has the URL, independent of
// whatever Discord visibility tier you set for it in UNAI. Fine
// for a Member Guide; think twice for anything genuinely sensitive.
//
// Exports as .docx rather than .txt (a change from the original
// text-only version) specifically so embedded images (diagrams,
// flowcharts, screenshots) can be extracted via the same mammoth-
// based pipeline used for uploaded .docx files, not just prose text.
// ============================================================
const crypto = require('crypto');
const textExtractor = require('./textExtractor');

function extractGoogleDocId(input) {
  const trimmed = (input || '').trim();
  const match = trimmed.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) return trimmed; // already looks like a bare doc ID
  throw new Error('Could not find a Google Doc ID in that link. Expected something like https://docs.google.com/document/d/DOC_ID/edit');
}

/**
 * Fetches a Google Doc as .docx, extracts its text and embedded images,
 * and returns a hash of the RAW downloaded bytes (not the extracted text,
 * and never of any AI-generated description) — this is what change
 * detection in sourceManager.js compares against. Hashing raw bytes
 * matters: if we hashed the final text (which, once images are analyzed,
 * includes AI-generated descriptions), the hash would drift on every
 * sync even when nothing in the actual document changed, since LLM
 * output isn't perfectly deterministic run to run — that would silently
 * burn a full re-analysis (and vision API calls) on every sync cycle
 * for no reason.
 * @param {string} docId
 * @returns {Promise<{rawHash: string, text: string, images: Array<{base64:string, contentType:string}>}>}
 */
async function fetchGoogleDoc(docId) {
  const url = `https://docs.google.com/document/d/${docId}/export?format=docx`;
  const res = await fetch(url, { redirect: 'follow' });

  if (res.status === 401 || res.status === 403) {
    throw new Error('Access denied. Share the Google Doc as "Anyone with the link – Viewer" (Share button → General access → Anyone with the link) and try again.');
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch the Google Doc (HTTP ${res.status}). Double-check the link is correct.`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());

  // A real .docx file is a ZIP archive and always starts with the "PK"
  // magic bytes. A denied/unshared doc typically comes back as an HTML
  // sign-in page instead (still HTTP 200) — catch that case explicitly
  // rather than trying to parse a login page as a Word document.
  if (buffer.length < 2 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new Error('Received something other than a Word document — this doc is likely not shared publicly. Set sharing to "Anyone with the link – Viewer".');
  }

  const rawHash = crypto.createHash('sha256').update(buffer).digest('hex');

  const { text, images } = await textExtractor.extractDocxTextAndImages(buffer);
  if (!text.trim() && images.length === 0) {
    throw new Error('The Google Doc appears to be empty.');
  }

  return { rawHash, text, images };
}

module.exports = { extractGoogleDocId, fetchGoogleDoc };
