// ============================================================
// Google Sheets Source Reader (Section 29 - Dynamic Knowledge
// Sources: structured tabular data)
// Reads a Google Sheet via its public export endpoint, same
// no-OAuth approach as googleDocsSource.js — the sheet must be
// shared as "Anyone with the link – Viewer". Same security
// tradeoff applies: the raw sheet is then reachable by anyone with
// the URL, independent of the Discord visibility tier set on it
// inside UNAI.
//
// Unlike prose documents, tabular data is converted into ROW-BASED
// chunks (each chunk holding a group of complete rows with their
// column headers), not the generic character-count chunker in
// knowledgeStore.js — a 900-character cut has no idea where one
// row ends and the next begins, and could easily slice a roster
// entry in half, corrupting exactly the kind of row/column lookup
// this feature exists for. See CHUNK_SEPARATOR in knowledgeStore.js.
// ============================================================
const XLSX = require('xlsx');
const knowledgeStore = require('./knowledgeStore');

const ROWS_PER_CHUNK = 25;

function extractGoogleSheetId(input) {
  const trimmed = (input || '').trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) return trimmed; // already looks like a bare sheet ID
  throw new Error('Could not find a Google Sheet ID in that link. Expected something like https://docs.google.com/spreadsheets/d/SHEET_ID/edit');
}

/** Turns one sheet/tab's rows (array-of-arrays, first row = headers) into row-group text chunks. */
function sheetToChunks(sheetName, rows) {
  if (rows.length === 0) return { chunks: [], rowCount: 0 };
  const headers = rows[0].map((h, i) => {
    const label = (h ?? '').toString().trim();
    return label || `Column ${i + 1}`;
  });
  const dataRows = rows.slice(1).filter(row => row.some(cell => (cell ?? '').toString().trim() !== ''));
  if (dataRows.length === 0) return { chunks: [], rowCount: 0 };

  const chunks = [];
  for (let i = 0; i < dataRows.length; i += ROWS_PER_CHUNK) {
    const group = dataRows.slice(i, i + ROWS_PER_CHUNK);
    const lines = group.map((row, idx) => {
      const rowNum = i + idx + 2; // +2: 1-indexed, and skip the header row
      const fields = headers.map((h, colIdx) => `${h}: ${(row[colIdx] ?? '').toString().trim() || '(blank)'}`).join(' | ');
      return `Row ${rowNum} — ${fields}`;
    });
    chunks.push(`[Sheet: ${sheetName}]\n${lines.join('\n')}`);
  }
  return { chunks, rowCount: dataRows.length };
}

/**
 * Fetches a Google Sheet as .xlsx (all tabs), parses every sheet into
 * row-group chunks, and returns a hash of the RAW downloaded bytes for
 * change detection — same reasoning as googleDocsSource.js: never hash
 * anything derived, only the actual source bytes, so re-syncing an
 * unchanged sheet costs nothing.
 * @param {string} sheetId
 * @returns {Promise<{rawHash: string, content: string, sheetNames: string[], rowCount: number}>}
 */
async function fetchGoogleSheet(sheetId) {
  const crypto = require('crypto');
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`;
  const res = await fetch(url, { redirect: 'follow' });

  if (res.status === 401 || res.status === 403) {
    throw new Error('Access denied. Share the Google Sheet as "Anyone with the link – Viewer" (Share button → General access → Anyone with the link) and try again.');
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch the Google Sheet (HTTP ${res.status}). Double-check the link is correct.`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());

  // A real .xlsx file is a ZIP archive — same "PK" magic-byte check used
  // for .docx, catching the "got a sign-in page instead" case.
  if (buffer.length < 2 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new Error('Received something other than a spreadsheet — this sheet is likely not shared publicly. Set sharing to "Anyone with the link – Viewer".');
  }

  const rawHash = crypto.createHash('sha256').update(buffer).digest('hex');

  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch (err) {
    throw new Error(`Failed to parse the spreadsheet: ${err.message}`);
  }

  const allChunks = [];
  let rowCount = 0;
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    const { chunks, rowCount: sheetRowCount } = sheetToChunks(sheetName, rows);
    allChunks.push(...chunks);
    rowCount += sheetRowCount;
  }

  if (allChunks.length === 0) {
    throw new Error('The Google Sheet appears to be empty (no data rows found in any tab).');
  }

  // Joined with the same boundary marker knowledgeStore.js's chunker
  // recognizes, so indexing splits along real row-group boundaries
  // instead of an arbitrary character count.
  const content = allChunks.join(knowledgeStore.CHUNK_SEPARATOR);

  return { rawHash, content, sheetNames: workbook.SheetNames, rowCount };
}

module.exports = { extractGoogleSheetId, fetchGoogleSheet };
