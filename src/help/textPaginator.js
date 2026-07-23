// ============================================================
// Text Paginator
// Splits an array of text lines into pages that each stay under
// maxCharsPerPage, never breaking a line in the middle unless a
// single line alone exceeds the whole budget (in which case it's
// hard-wrapped). Used by /help, and reusable by any future command
// whose output could grow without bound.
// Discord hard limits this exists to respect: embed description
// ≤ 4096 chars, embed total ≤ 6000 chars, message content ≤ 2000
// chars. Callers should pick maxCharsPerPage comfortably under
// whichever of those applies, to leave room for title/footer/etc.
// ============================================================
function paginateLines(lines, maxCharsPerPage = 3500) {
  const pages = [];
  let current = [];
  let currentLen = 0;

  const flush = () => {
    if (current.length) {
      pages.push(current.join('\n'));
      current = [];
      currentLen = 0;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine ?? '';
    if (line.length > maxCharsPerPage) {
      // A single line longer than a whole page: hard-wrap it rather
      // than let it break pagination entirely.
      flush();
      for (let i = 0; i < line.length; i += maxCharsPerPage) {
        pages.push(line.slice(i, i + maxCharsPerPage));
      }
      continue;
    }
    const addedLen = line.length + 1; // +1 for the newline joining it
    if (currentLen + addedLen > maxCharsPerPage) flush();
    current.push(line);
    currentLen += addedLen;
  }
  flush();

  return pages.length ? pages : [''];
}

module.exports = { paginateLines };
