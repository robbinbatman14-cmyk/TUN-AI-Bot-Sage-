// ============================================================
// Google Docs Source Reader (Section 29 - Dynamic Knowledge
// Sources)
// Reads a Google Doc's plain text via its public export endpoint
// rather than the full Google Docs API. This deliberately avoids
// needing a Google Cloud project, service account, or OAuth setup —
// the tradeoff is that the doc must be shared as "Anyone with the
// link – Viewer". That's a real security tradeoff worth knowing:
// the raw document is then reachable by anyone who has the URL,
// independent of whatever Discord visibility tier you set for it
// in UNAI. Fine for a Member Guide; think twice for anything
// genuinely sensitive.
// ============================================================
function extractGoogleDocId(input) {
  const trimmed = (input || '').trim();
  const match = trimmed.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) return trimmed; // already looks like a bare doc ID
  throw new Error('Could not find a Google Doc ID in that link. Expected something like https://docs.google.com/document/d/DOC_ID/edit');
}

async function fetchGoogleDocText(docId) {
  const url = `https://docs.google.com/document/d/${docId}/export?format=txt`;
  const res = await fetch(url, { redirect: 'follow' });

  if (res.status === 401 || res.status === 403) {
    throw new Error('Access denied. Share the Google Doc as "Anyone with the link – Viewer" (Share button → General access → Anyone with the link) and try again.');
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch the Google Doc (HTTP ${res.status}). Double-check the link is correct.`);
  }

  const text = await res.text();
  // Google returns a 200 with an HTML sign-in/permission page instead of
  // plain text for docs that aren't actually publicly link-shared — catch
  // that case explicitly rather than indexing a login page as "content".
  if (/^\s*<(!doctype html|html)/i.test(text)) {
    throw new Error('Received a sign-in/permission page instead of document text — this doc is not shared publicly. Set sharing to "Anyone with the link – Viewer".');
  }
  if (!text.trim()) {
    throw new Error('The Google Doc appears to be empty.');
  }
  return text;
}

module.exports = { extractGoogleDocId, fetchGoogleDocText };
