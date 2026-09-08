/**
 * Pure diff-preview computation for `/upload` (spec 0002 §OQ-1 flow: parse →
 * diff vs. current → resolve → commit). Consumes the JSON shape
 * `POST /api/upload` already returns (src/app/api/upload/route.ts) and
 * classifies each row without re-implementing any of that route's server
 * logic — this only decides how the preview UI should present the response.
 */
import { toDecimal } from "@/lib/money";

export interface UploadParsedRow {
  rowNumber: number;
  rawLabel: string;
  currency: "KRW" | "USD";
  market: "KRX" | "US";
  marketValue: string;
  costBasisTotal: string;
  securityId: number | null;
  resolvedVia: "name" | "symbol" | "alias" | null;
}

export interface UploadUnresolvedRow {
  rowNumber: number;
  reason: string;
  raw: Record<string, unknown>;
}

export interface UploadDiffVsCurrentRow {
  securityId: number;
  rawLabel: string;
  incomingMarketValue: string;
  incomingCostBasisTotal: string;
  currentQuantity: string | null;
  currentCostBasis: string | null;
}

export type DiffStatus = "new" | "changed" | "unchanged";

export interface DiffPreviewRow extends UploadDiffVsCurrentRow {
  status: DiffStatus;
}

/**
 * Classifies each `diffVsCurrent` row: "new" when the security has no
 * existing current_holding cost basis to compare against, "unchanged" when
 * the incoming cost basis exactly matches, "changed" otherwise. Uses
 * decimal.js comparison, never string equality or float coercion, since
 * these are money values (ADR-0001).
 */
export function computeDiffPreview(diffVsCurrent: readonly UploadDiffVsCurrentRow[]): DiffPreviewRow[] {
  return diffVsCurrent.map((row) => {
    let status: DiffStatus;
    if (row.currentCostBasis === null) {
      status = "new";
    } else if (toDecimal(row.incomingCostBasisTotal).equals(toDecimal(row.currentCostBasis))) {
      status = "unchanged";
    } else {
      status = "changed";
    }
    return { ...row, status };
  });
}

export interface UploadSummary {
  totalRows: number;
  resolvedRows: number;
  unresolvedRowNumbers: number[];
  /** True only when every parsed row resolved to a security — the commit
   * route (src/app/api/upload/commit/route.ts) aborts the whole write
   * (no partial commit) if any row is still unresolved. */
  readyToCommit: boolean;
}

export function summarizeUpload(
  parsed: readonly UploadParsedRow[],
  unresolved: readonly UploadUnresolvedRow[],
): UploadSummary {
  const unresolvedRowNumbers = [...new Set(unresolved.map((u) => u.rowNumber))].sort((a, b) => a - b);
  return {
    totalRows: parsed.length,
    resolvedRows: parsed.filter((p) => p.securityId !== null).length,
    unresolvedRowNumbers,
    readyToCommit: unresolvedRowNumbers.length === 0,
  };
}

/** Extracts a bindable raw label from an unresolved row, when one is present
 * (resolution-stage unresolved rows always carry it; parser-stage validation
 * failures may not — those can't be fixed by an alias binding). */
export function bindableRawLabel(row: UploadUnresolvedRow): string | null {
  const label = row.raw["rawLabel"];
  return typeof label === "string" ? label : null;
}
