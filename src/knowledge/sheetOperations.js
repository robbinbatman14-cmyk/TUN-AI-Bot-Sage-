// ============================================================
// Sheet Operations Engine
// Executes spreadsheet-style operations (sort, rank/top-N, filter,
// count, average, sum) as REAL computation against parsed rows —
// never by asking the model to eyeball a text dump and compute an
// answer itself. That distinction is the whole point: an LLM
// reasoning over a printed table is unreliable for exact sorting/
// counting even on a small sheet, and is silently WRONG on a large
// one — if "top 10 by score" only sees the first 40 chunks (the cap
// in answerEngine.js) because the model never gets the whole sheet,
// the real top scorers could be sitting past the cutoff and never
// considered. Doing the operation here means it runs against every
// row, correctly, before the model ever sees the result.
// ============================================================

/** Coerces a cell value to a number, tolerating "$50,000,000", "12%", etc. */
function coerceNumber(value) {
  if (typeof value === 'number') return value;
  const cleaned = String(value ?? '').replace(/[$,%\s]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Finds the column index best matching a natural-language column name. */
function findColumnIndex(headers, columnName) {
  if (!columnName) return -1;
  const lower = columnName.toLowerCase().trim();
  let idx = headers.findIndex(h => h.toLowerCase().trim() === lower);
  if (idx !== -1) return idx;
  idx = headers.findIndex(h => h.toLowerCase().includes(lower) || lower.includes(h.toLowerCase()));
  return idx;
}

/** Picks whichever tab in a multi-tab sheet actually has the needed column(s). */
function findTabWithColumns(structuredSheets, columnNames) {
  const needed = columnNames.filter(Boolean);
  for (const sheet of structuredSheets) {
    if (needed.every(name => findColumnIndex(sheet.headers, name) !== -1)) {
      return sheet;
    }
  }
  return null;
}

const OPERATORS = {
  '>': (a, b) => a > b,
  '<': (a, b) => a < b,
  '>=': (a, b) => a >= b,
  '<=': (a, b) => a <= b,
  '==': (a, b) => a === b,
  'contains': (a, b) => String(a).toLowerCase().includes(String(b).toLowerCase())
};

/**
 * @param {Array<{name, headers, rows}>} structuredSheets
 * @param {object} op - classifier-produced operation spec (see classifier.js)
 * @returns {{success: boolean, text?: string, error?: string}}
 */
function applyOperation(structuredSheets, op) {
  const neededColumns = [op.column, op.filter_column].filter(Boolean);
  const sheet = findTabWithColumns(structuredSheets, neededColumns);
  if (!sheet) {
    const available = structuredSheets.map(s => `${s.name} [${s.headers.join(', ')}]`).join('; ');
    return { success: false, error: `Couldn't find a tab containing the column(s) "${neededColumns.join('", "')}". Available: ${available}` };
  }

  // Use the nation/leader/name-like first column as a label for each row
  // in output, falling back to "Row N" if nothing obviously name-like exists.
  const labelIdx = sheet.headers.findIndex(h => /nation|name|leader|member/i.test(h));

  const rowLabel = (row, i) => (labelIdx !== -1 ? row[labelIdx] : `Row ${i + 2}`);

  switch (op.type) {
    case 'sort':
    case 'top_n':
    case 'bottom_n': {
      const colIdx = findColumnIndex(sheet.headers, op.column);
      if (colIdx === -1) return { success: false, error: `Column "${op.column}" not found. Available: ${sheet.headers.join(', ')}` };

      const withValues = sheet.rows
        .map((row, i) => ({ row, i, value: coerceNumber(row[colIdx]) }))
        .filter(r => r.value !== null);

      const direction = op.type === 'bottom_n' ? 'asc' : (op.direction || 'desc');
      withValues.sort((a, b) => (direction === 'asc' ? a.value - b.value : b.value - a.value));

      const limit = op.type === 'sort' ? withValues.length : Math.min(op.limit || 10, withValues.length);
      const top = withValues.slice(0, limit);

      const lines = top.map((r, idx) => `${idx + 1}. ${rowLabel(r.row, r.i)} — ${sheet.headers[colIdx]}: ${r.row[colIdx]}`);
      const title = op.type === 'sort'
        ? `All ${withValues.length} rows sorted by ${sheet.headers[colIdx]} (${direction === 'asc' ? 'ascending' : 'descending'})`
        : `Top ${limit} by ${sheet.headers[colIdx]} (${sheet.name})`;
      return { success: true, text: `${title}:\n${lines.join('\n')}` };
    }

    case 'count':
    case 'filter': {
      const colIdx = findColumnIndex(sheet.headers, op.filter_column || op.column);
      if (colIdx === -1) return { success: false, error: `Column "${op.filter_column || op.column}" not found. Available: ${sheet.headers.join(', ')}` };

      const operator = OPERATORS[op.filter_operator] || OPERATORS['=='];
      const isNumericCompare = ['>', '<', '>=', '<='].includes(op.filter_operator);
      const compareValue = isNumericCompare ? coerceNumber(op.filter_value) : op.filter_value;

      const matches = sheet.rows.filter((row, i) => {
        const cellRaw = row[colIdx];
        const cellValue = isNumericCompare ? coerceNumber(cellRaw) : cellRaw;
        if (isNumericCompare && cellValue === null) return false;
        return operator(cellValue, compareValue);
      });

      if (op.type === 'count') {
        return { success: true, text: `${matches.length} row(s) in ${sheet.name} match: ${sheet.headers[colIdx]} ${op.filter_operator} ${op.filter_value}.` };
      }
      const lines = matches.slice(0, 50).map((row, idx) => `${idx + 1}. ${rowLabel(row, idx)} — ${sheet.headers[colIdx]}: ${row[colIdx]}`);
      const truncNote = matches.length > 50 ? ` (showing first 50 of ${matches.length})` : '';
      return { success: true, text: `${matches.length} row(s) match${truncNote}:\n${lines.join('\n')}` };
    }

    case 'average':
    case 'sum': {
      const colIdx = findColumnIndex(sheet.headers, op.column);
      if (colIdx === -1) return { success: false, error: `Column "${op.column}" not found. Available: ${sheet.headers.join(', ')}` };

      const values = sheet.rows.map(row => coerceNumber(row[colIdx])).filter(v => v !== null);
      if (values.length === 0) return { success: false, error: `No numeric values found in column "${sheet.headers[colIdx]}".` };

      const sum = values.reduce((a, b) => a + b, 0);
      const result = op.type === 'sum' ? sum : sum / values.length;
      const label = op.type === 'sum' ? 'Sum' : 'Average';
      return { success: true, text: `${label} of ${sheet.headers[colIdx]} across ${values.length} row(s) in ${sheet.name}: ${result.toLocaleString(undefined, { maximumFractionDigits: 2 })}` };
    }

    default:
      return { success: false, error: `Unknown operation type "${op.type}".` };
  }
}

module.exports = { applyOperation, coerceNumber, findColumnIndex };
