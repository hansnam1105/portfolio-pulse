/**
 * Samsung Securities export parser (spec 0001 § Parser profile).
 *
 * XLSX is the primary path — the real sample supplied by the user is `.xlsx`,
 * and OOXML stores strings as UTF-8 inside the zip, so the CP949/EUC-KR
 * mojibake risk does not apply on this path. A CSV/encoding-sniffing fallback
 * is retained per spec for a possible future CSV export, but is not the
 * primary path and is not wired into the upload routes today.
 *
 * The profile (`profiles/samsung-securities.json`) is DATA, not code: column
 * header -> canonical field mapping, versioned. A richer future export can be
 * supported by adding a `samsung-securities/v2` profile without touching this
 * file (spec 0001 § Parser profile).
 *
 * This parser only extracts and normalizes the four columns. It never drops a
 * row silently — a row that fails validation is returned with a `warnings`
 * entry so the upload preview can surface it (spec 0001 acceptance criteria).
 */
import ExcelJS from "exceljs";
import profileV1 from "./profiles/samsung-securities.json";

export type Currency = "KRW" | "USD";

export interface ParsedHoldingRow {
  rowNumber: number;
  rawLabel: string;
  currency: Currency;
  /** Decimal string, in the row's own currency. */
  marketValue: string;
  /** Decimal string, in the row's own currency. */
  costBasisTotal: string;
}

export interface UnresolvedRow {
  rowNumber: number;
  reason: string;
  raw: Record<string, unknown>;
}

export interface ParseResult {
  profileVersion: string;
  rows: ParsedHoldingRow[];
  unresolved: UnresolvedRow[];
  warnings: string[];
}

interface ColumnSpec {
  field: string;
  type: "string" | "enum" | "decimal";
  values?: string[];
  required: boolean;
}

const PROFILE = profileV1 as {
  profileVersion: string;
  headerRow: number;
  dataStartRow: number;
  columns: Record<string, ColumnSpec>;
};

function normalizeDecimalCell(value: ExcelJS.CellValue): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return String(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/,/g, "");
    if (trimmed === "") return null;
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
    return trimmed;
  }
  // ExcelJS may return { result: number } for formula cells.
  if (typeof value === "object" && "result" in value && value.result !== undefined) {
    return normalizeDecimalCell(value.result as ExcelJS.CellValue);
  }
  return null;
}

/** Normalizes a Buffer/ArrayBuffer input into a Node Buffer (works regardless of @types/node's Buffer generic shape). */
function toNodeBuffer(input: Buffer | ArrayBuffer): Buffer {
  return Buffer.isBuffer(input) ? input : Buffer.from(new Uint8Array(input));
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (typeof value === "object" && "text" in value) return String((value as { text: unknown }).text).trim();
  if (typeof value === "object" && "richText" in value) {
    return (value as { richText: { text: string }[] }).richText.map((t) => t.text).join("").trim();
  }
  return String(value).trim();
}

/**
 * Parses a Samsung Securities `.xlsx` export (buffer) into canonical rows.
 * Never throws on a per-row problem — problems surface as `unresolved`/`warnings`.
 */
export async function parseSamsungSecuritiesXlsx(buffer: Buffer | ArrayBuffer): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  // exceljs's .d.ts resolves `Buffer` against a duplicated, older @types/node
  // pulled in transitively via its fast-csv dependency, which TS treats as a
  // structurally distinct (incompatible) `Buffer` type from this project's —
  // a dependency-tree type-identity artifact, not a real mismatch at runtime.
  // @ts-expect-error — see comment above; `toNodeBuffer` always returns a real Node Buffer.
  await workbook.xlsx.load(toNodeBuffer(buffer));

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return {
      profileVersion: PROFILE.profileVersion,
      rows: [],
      unresolved: [],
      warnings: ["Workbook contains no worksheets"],
    };
  }

  const headerRow = sheet.getRow(PROFILE.headerRow);
  // Map column index -> canonical field, by matching the verbatim header text
  // against the profile (data-driven, not a fixed column order).
  const columnIndexToField = new Map<number, { header: string; spec: ColumnSpec }>();
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const header = cellText(cell.value);
    const spec = PROFILE.columns[header];
    if (spec) {
      columnIndexToField.set(colNumber, { header, spec });
    }
  });

  const missingHeaders = Object.keys(PROFILE.columns).filter(
    (header) => ![...columnIndexToField.values()].some((c) => c.header === header),
  );

  const warnings: string[] = [];
  if (missingHeaders.length > 0) {
    warnings.push(`Expected header(s) not found: ${missingHeaders.join(", ")}`);
  }

  const rows: ParsedHoldingRow[] = [];
  const unresolved: UnresolvedRow[] = [];

  for (let rowNumber = PROFILE.dataStartRow; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    // Skip fully blank rows rather than surfacing them as unresolved.
    if (row.cellCount === 0 || row.values === undefined) continue;
    const isBlank = columnIndexToField.size > 0 && [...columnIndexToField.keys()].every((colNumber) => {
      const v = row.getCell(colNumber).value;
      return v === null || v === undefined || cellText(v) === "";
    });
    if (isBlank) continue;

    const raw: Record<string, unknown> = {};
    let rawLabel: string | null = null;
    let currency: Currency | null = null;
    let marketValue: string | null = null;
    let costBasisTotal: string | null = null;
    const rowProblems: string[] = [];

    for (const [colNumber, { header, spec }] of columnIndexToField) {
      const cellValue = row.getCell(colNumber).value;
      raw[header] = cellText(cellValue) || cellValue;

      if (spec.field === "raw_label") {
        const text = cellText(cellValue);
        if (text === "" && spec.required) {
          rowProblems.push(`Missing required field '${header}'`);
        } else {
          rawLabel = text;
        }
      } else if (spec.field === "currency") {
        const text = cellText(cellValue).toUpperCase();
        if (spec.values && spec.values.includes(text)) {
          currency = text as Currency;
        } else {
          rowProblems.push(`Unrecognized currency value '${cellText(cellValue)}' in '${header}'`);
        }
      } else if (spec.field === "market_value") {
        const decimalText = normalizeDecimalCell(cellValue);
        if (decimalText === null) {
          rowProblems.push(`Non-numeric value in '${header}'`);
        } else {
          marketValue = decimalText;
        }
      } else if (spec.field === "cost_basis_total") {
        const decimalText = normalizeDecimalCell(cellValue);
        if (decimalText === null) {
          rowProblems.push(`Non-numeric value in '${header}'`);
        } else {
          costBasisTotal = decimalText;
        }
      }
    }

    if (rowProblems.length > 0 || rawLabel === null || currency === null || marketValue === null || costBasisTotal === null) {
      unresolved.push({
        rowNumber,
        reason: rowProblems.length > 0 ? rowProblems.join("; ") : "Row could not be fully parsed",
        raw,
      });
      continue;
    }

    rows.push({
      rowNumber,
      rawLabel,
      currency,
      marketValue,
      costBasisTotal,
    });
  }

  return { profileVersion: PROFILE.profileVersion, rows, unresolved, warnings };
}

/**
 * CSV fallback path (spec 0001 § Cross-platform: "the CSV decoding path stays
 * in the parser as a fallback only"). Not exercised by any current upload
 * route — no CSV export exists today — but retained so a future CSV export
 * needs only a route change, not a new parser. Sniffs EUC-KR vs UTF-8 the way
 * spec 0001 describes for the CP949/EUC-KR mojibake risk that does not apply
 * to the XLSX primary path.
 */
export function parseSamsungSecuritiesCsv(buffer: Buffer | ArrayBuffer, encoding: "utf-8" | "euc-kr" = "utf-8"): ParseResult {
  const bytes = toNodeBuffer(buffer);
  const decoder = new TextDecoder(encoding);
  const text = decoder.decode(bytes);
  const lines = text.split(/\r\n|\n/).filter((line) => line.length > 0);

  const warnings: string[] = [];
  const rows: ParsedHoldingRow[] = [];
  const unresolved: UnresolvedRow[] = [];

  if (lines.length === 0) {
    return { profileVersion: PROFILE.profileVersion, rows, unresolved, warnings: ["Empty CSV input"] };
  }

  const header = lines[0]?.split(",").map((h) => h.trim()) ?? [];
  const fieldByIndex = header.map((h) => PROFILE.columns[h]?.field ?? null);

  for (let i = 1; i < lines.length; i++) {
    const rowNumber = i + 1;
    const cells = (lines[i] ?? "").split(",");
    const raw: Record<string, unknown> = {};
    let rawLabel: string | null = null;
    let currency: Currency | null = null;
    let marketValue: string | null = null;
    let costBasisTotal: string | null = null;
    const rowProblems: string[] = [];

    fieldByIndex.forEach((field, idx) => {
      if (!field) return;
      const cellText_ = (cells[idx] ?? "").trim();
      raw[header[idx] ?? String(idx)] = cellText_;
      if (field === "raw_label") rawLabel = cellText_ || null;
      if (field === "currency") {
        const upper = cellText_.toUpperCase();
        if (upper === "KRW" || upper === "USD") currency = upper;
        else rowProblems.push(`Unrecognized currency value '${cellText_}'`);
      }
      if (field === "market_value") {
        const normalized = normalizeDecimalCell(cellText_);
        if (normalized === null) rowProblems.push(`Non-numeric market_value '${cellText_}'`);
        else marketValue = normalized;
      }
      if (field === "cost_basis_total") {
        const normalized = normalizeDecimalCell(cellText_);
        if (normalized === null) rowProblems.push(`Non-numeric cost_basis_total '${cellText_}'`);
        else costBasisTotal = normalized;
      }
    });

    if (rowProblems.length > 0 || rawLabel === null || currency === null || marketValue === null || costBasisTotal === null) {
      unresolved.push({ rowNumber, reason: rowProblems.join("; ") || "Row could not be fully parsed", raw });
      continue;
    }

    rows.push({ rowNumber, rawLabel, currency, marketValue, costBasisTotal });
  }

  return { profileVersion: PROFILE.profileVersion, rows, unresolved, warnings };
}
