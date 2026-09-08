import { describe, expect, it } from "bun:test";
import {
  bindableRawLabel,
  computeDiffPreview,
  summarizeUpload,
  type UploadDiffVsCurrentRow,
  type UploadParsedRow,
  type UploadUnresolvedRow,
} from "@/lib/upload/diffPreview";

describe("computeDiffPreview", () => {
  it("marks a row with no current cost basis as new", () => {
    const rows: UploadDiffVsCurrentRow[] = [
      { securityId: 1, rawLabel: "가나전자", incomingMarketValue: "100", incomingCostBasisTotal: "90", currentQuantity: null, currentCostBasis: null },
    ];
    expect(computeDiffPreview(rows)[0]!.status).toBe("new");
  });

  it("marks an exact cost-basis match as unchanged", () => {
    const rows: UploadDiffVsCurrentRow[] = [
      { securityId: 1, rawLabel: "가나전자", incomingMarketValue: "100", incomingCostBasisTotal: "90.00", currentQuantity: "10", currentCostBasis: "90" },
    ];
    expect(computeDiffPreview(rows)[0]!.status).toBe("unchanged");
  });

  it("marks a differing cost basis as changed, using decimal comparison not string equality", () => {
    const rows: UploadDiffVsCurrentRow[] = [
      { securityId: 1, rawLabel: "가나전자", incomingMarketValue: "100", incomingCostBasisTotal: "95", currentQuantity: "10", currentCostBasis: "90" },
    ];
    expect(computeDiffPreview(rows)[0]!.status).toBe("changed");
  });
});

describe("summarizeUpload", () => {
  const parsed: UploadParsedRow[] = [
    { rowNumber: 1, rawLabel: "가나전자", currency: "KRW", market: "KRX", marketValue: "100", costBasisTotal: "90", securityId: 1, resolvedVia: "name" },
    { rowNumber: 2, rawLabel: "미확인종목", currency: "KRW", market: "KRX", marketValue: "50", costBasisTotal: "40", securityId: null, resolvedVia: null },
  ];

  it("is ready to commit when nothing is unresolved", () => {
    const summary = summarizeUpload([parsed[0]!], []);
    expect(summary.readyToCommit).toBe(true);
    expect(summary.unresolvedRowNumbers).toEqual([]);
  });

  it("is not ready to commit while any row is unresolved", () => {
    const unresolved: UploadUnresolvedRow[] = [{ rowNumber: 2, reason: "No matching security", raw: { rawLabel: "미확인종목" } }];
    const summary = summarizeUpload(parsed, unresolved);
    expect(summary.readyToCommit).toBe(false);
    expect(summary.unresolvedRowNumbers).toEqual([2]);
    expect(summary.totalRows).toBe(2);
    expect(summary.resolvedRows).toBe(1);
  });
});

describe("bindableRawLabel", () => {
  it("extracts rawLabel when present (resolution-stage unresolved row)", () => {
    const row: UploadUnresolvedRow = { rowNumber: 2, reason: "No matching security", raw: { rawLabel: "미확인종목", currency: "KRW" } };
    expect(bindableRawLabel(row)).toBe("미확인종목");
  });

  it("returns null when absent (parser-stage validation failure)", () => {
    const row: UploadUnresolvedRow = { rowNumber: 5, reason: "Row could not be fully parsed", raw: { 종목명: undefined } };
    expect(bindableRawLabel(row)).toBeNull();
  });
});
