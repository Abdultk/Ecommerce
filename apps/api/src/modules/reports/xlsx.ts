import writeXlsxFile, { type Cell, type SheetData } from "write-excel-file/node";
import { guardCell, type CellValue } from "./csv";

const DATE_FORMAT = "yyyy-mm-dd hh:mm:ss";

/**
 * Text cells are written as strings, never formulas, but they get the same guard as CSV so
 * a file re-saved as CSV stays safe and both formats read the same.
 */
function xlsxCell(value: CellValue): Cell {
  if (value === null) return null;
  if (value instanceof Date) return { value, type: Date, format: DATE_FORMAT };
  if (typeof value === "string") return { value: String(guardCell(value)), type: String };
  return value;
}

/** One-sheet workbook with a bold header row. */
export async function toXlsx(
  columns: readonly string[],
  rows: readonly (readonly CellValue[])[],
): Promise<Buffer> {
  const data: SheetData = [
    columns.map((c): Cell => ({ value: c, type: String, fontWeight: "bold" })),
    ...rows.map((row) => row.map(xlsxCell)),
  ];
  return writeXlsxFile(data).toBuffer();
}
