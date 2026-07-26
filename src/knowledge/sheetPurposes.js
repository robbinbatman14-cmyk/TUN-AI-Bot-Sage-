// ============================================================
// Sheet Purposes
// A curated label an admin can attach to a linked Google Sheet, so
// the classifier can automatically route a natural-language request
// ("list all members", "show the roster") to the right structured
// source without the user needing to say "from the sheet". Kept as
// a small fixed set (plus "other") rather than free text, so the
// classifier prompt can list them plainly and match reliably.
// ============================================================
const SHEET_PURPOSES = [
  { key: 'member_roster', label: 'Member Roster' },
  { key: 'academy_records', label: 'Academy Records' },
  { key: 'audit_records', label: 'Audit Records' },
  { key: 'grant_database', label: 'Grant Database' },
  { key: 'tax_table', label: 'Tax Table' },
  { key: 'war_assignments', label: 'War Assignments' },
  { key: 'other', label: 'Other / Custom' }
];

function labelFor(key) {
  return SHEET_PURPOSES.find(p => p.key === key)?.label || key;
}

module.exports = { SHEET_PURPOSES, labelFor };
