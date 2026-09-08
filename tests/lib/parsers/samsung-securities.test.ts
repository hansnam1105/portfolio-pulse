import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import {
  parseSamsungSecuritiesCsv,
  parseSamsungSecuritiesXlsx,
} from "@/lib/parsers/samsung-securities";

// NEVER read the real export_sample.xlsx (project root, not committed, per spec
// 0001 Q1) — only the redacted, invented-data fixture documented in
// docs/benchmark-fixtures/samsung-securities-sample.md.
const FIXTURE_PATH = join(import.meta.dir, "..", "..", "..", "docs", "benchmark-fixtures", "samsung-securities-sample.xlsx");

async function buildWorkbookBuffer(
  headers: string[],
  rows: (string | number | null)[][],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

describe("parseSamsungSecuritiesXlsx — redacted fixture", () => {
  it("parses all 6 fixture rows with no unresolved rows and no warnings", async () => {
    const buffer = readFileSync(FIXTURE_PATH);
    const result = await parseSamsungSecuritiesXlsx(buffer);

    expect(result.profileVersion).toBe("samsung-securities/v1");
    expect(result.warnings).toEqual([]);
    expect(result.unresolved).toEqual([]);
    expect(result.rows).toHaveLength(6);
  });

  it("parses the Korean preferred-share row (우 suffix) as a distinct KRW row", async () => {
    const buffer = readFileSync(FIXTURE_PATH);
    const result = await parseSamsungSecuritiesXlsx(buffer);
    const row = result.rows.find((r) => r.rawLabel === "가나전자우");
    expect(row).toBeDefined();
    expect(row?.currency).toBe("KRW");
    expect(row?.marketValue).toBe("1000000");
    expect(row?.costBasisTotal).toBe("900000");
  });

  it("parses the common-share row as distinct from the preferred-share row", async () => {
    const buffer = readFileSync(FIXTURE_PATH);
    const result = await parseSamsungSecuritiesXlsx(buffer);
    const row = result.rows.find((r) => r.rawLabel === "가나전자");
    expect(row).toBeDefined();
    expect(row?.marketValue).toBe("2500000");
    expect(row?.costBasisTotal).toBe("2500000");
  });

  it("parses a loss position (market value < cost basis)", async () => {
    const buffer = readFileSync(FIXTURE_PATH);
    const result = await parseSamsungSecuritiesXlsx(buffer);
    const row = result.rows.find((r) => r.rawLabel === "다라바이오");
    expect(row).toBeDefined();
    expect(row?.currency).toBe("KRW");
    expect(row?.marketValue).toBe("480000");
    expect(row?.costBasisTotal).toBe("600000");
  });

  it("parses USD rows with decimal amounts", async () => {
    const buffer = readFileSync(FIXTURE_PATH);
    const result = await parseSamsungSecuritiesXlsx(buffer);
    const row = result.rows.find((r) => r.rawLabel === "SMPL");
    expect(row).toBeDefined();
    expect(row?.currency).toBe("USD");
    expect(row?.marketValue).toBe("1500");
    expect(row?.costBasisTotal).toBe("1200.5");
  });

  it("does not split a dotted US ticker on '.'", async () => {
    const buffer = readFileSync(FIXTURE_PATH);
    const result = await parseSamsungSecuritiesXlsx(buffer);
    const row = result.rows.find((r) => r.rawLabel === "SMPL.B");
    expect(row).toBeDefined();
    expect(row?.marketValue).toBe("300.25");
    expect(row?.costBasisTotal).toBe("330.75");
  });

  it("parses a fully-exited position (market value = 0) without treating it as unresolved", async () => {
    const buffer = readFileSync(FIXTURE_PATH);
    const result = await parseSamsungSecuritiesXlsx(buffer);
    const row = result.rows.find((r) => r.rawLabel === "ZZTEST ETF");
    expect(row).toBeDefined();
    expect(row?.marketValue).toBe("0");
    expect(row?.costBasisTotal).toBe("100");
  });

  it("accepts either a Buffer or a raw ArrayBuffer", async () => {
    const buffer = readFileSync(FIXTURE_PATH);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const result = await parseSamsungSecuritiesXlsx(arrayBuffer);
    expect(result.rows).toHaveLength(6);
  });
});

describe("parseSamsungSecuritiesXlsx — synthetic edge cases", () => {
  it("surfaces a missing required raw_label as unresolved, never silently dropped", async () => {
    const buffer = await buildWorkbookBuffer(
      ["종목명", "통화", "평가금액", "매수금액"],
      [["", "KRW", 1000, 900]],
    );
    const result = await parseSamsungSecuritiesXlsx(buffer);
    expect(result.rows).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]?.reason).toContain("Missing required field");
  });

  it("surfaces an unrecognized currency as unresolved", async () => {
    const buffer = await buildWorkbookBuffer(
      ["종목명", "통화", "평가금액", "매수금액"],
      [["가나전자", "EUR", 1000, 900]],
    );
    const result = await parseSamsungSecuritiesXlsx(buffer);
    expect(result.rows).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]?.reason).toContain("Unrecognized currency");
  });

  it("surfaces a non-numeric market value as unresolved", async () => {
    const buffer = await buildWorkbookBuffer(
      ["종목명", "통화", "평가금액", "매수금액"],
      [["가나전자", "KRW", "not-a-number", 900]],
    );
    const result = await parseSamsungSecuritiesXlsx(buffer);
    expect(result.rows).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]?.reason).toContain("Non-numeric value");
  });

  it("warns (but does not crash) when an expected header is missing", async () => {
    const buffer = await buildWorkbookBuffer(
      ["종목명", "통화", "평가금액"], // no 매수금액 column
      [["가나전자", "KRW", 1000]],
    );
    const result = await parseSamsungSecuritiesXlsx(buffer);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("매수금액");
  });

  it("skips fully blank rows rather than surfacing them as unresolved", async () => {
    const buffer = await buildWorkbookBuffer(
      ["종목명", "통화", "평가금액", "매수금액"],
      [
        ["가나전자", "KRW", 1000, 900],
        [null, null, null, null],
        ["다라바이오", "KRW", 2000, 1800],
      ],
    );
    const result = await parseSamsungSecuritiesXlsx(buffer);
    expect(result.rows).toHaveLength(2);
    expect(result.unresolved).toHaveLength(0);
  });

  it("returns an empty result with a warning for a workbook with no worksheets", async () => {
    const workbook = new ExcelJS.Workbook();
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const result = await parseSamsungSecuritiesXlsx(Buffer.from(arrayBuffer));
    expect(result.rows).toEqual([]);
    expect(result.warnings).toEqual(["Workbook contains no worksheets"]);
  });
});

describe("parseSamsungSecuritiesCsv — fallback path", () => {
  it("parses a well-formed UTF-8 CSV", () => {
    const csv = "종목명,통화,평가금액,매수금액\n가나전자,KRW,1000000,900000\nSMPL,USD,1500,1200.5\n";
    const result = parseSamsungSecuritiesCsv(Buffer.from(csv, "utf-8"), "utf-8");
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ rawLabel: "가나전자", currency: "KRW", marketValue: "1000000" });
    expect(result.rows[1]).toMatchObject({ rawLabel: "SMPL", currency: "USD", costBasisTotal: "1200.5" });
  });

  it("surfaces an unrecognized currency row as unresolved", () => {
    const csv = "종목명,통화,평가금액,매수금액\n가나전자,EUR,1000000,900000\n";
    const result = parseSamsungSecuritiesCsv(Buffer.from(csv, "utf-8"), "utf-8");
    expect(result.rows).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
  });

  it("returns an empty result with a warning for empty input", () => {
    const result = parseSamsungSecuritiesCsv(Buffer.from("", "utf-8"), "utf-8");
    expect(result.rows).toEqual([]);
    expect(result.warnings).toEqual(["Empty CSV input"]);
  });
});
