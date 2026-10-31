export type CellValue = string | number | boolean | Date | null;

/** Leading characters that spreadsheet apps treat as the start of a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Neutralises spreadsheet formula injection: a text cell that starts with = + - @ tab or
 * CR is prefixed with an apostrophe so it is shown as text, not executed. Numbers keep
 * their sign because they are written as numbers.
 */
export function guardCell<T extends CellValue>(value: T): T | string {
  return typeof value === "string" && FORMULA_START.test(value) ? `'${value}` : value;
}

const NEEDS_QUOTES = /[",\r\n]/;

function csvCell(value: CellValue): string {
  if (value === null) return "";
  const guarded = guardCell(value);
  const text = guarded instanceof Date ? guarded.toISOString() : String(guarded);
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 CSV (CRLF line endings) with formula-injection guarding on every text cell. */
export function toCsv(columns: readonly string[], rows: readonly (readonly CellValue[])[]): string {
  return [columns, ...rows].map((row) => `${row.map(csvCell).join(",")}\r\n`).join("");
}
