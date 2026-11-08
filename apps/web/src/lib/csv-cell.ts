// A spreadsheet runs a cell that starts with one of these as a formula, so
// such text is written with a leading apostrophe and read back as text.
const FORMULA_START = /^[=+\-@\t\r]/;

/** Text safe to hand a spreadsheet: a leading apostrophe defuses a formula. */
export function defuseFormula(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

/** One CSV cell: defused, and quoted when it holds a comma, a quote or a line break. */
export function csvCell(value: string): string {
  const safe = defuseFormula(value);
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** One CSV row, each cell quoted and defused as above. */
export function csvRow(row: readonly string[]): string {
  return row.map(csvCell).join(",");
}
