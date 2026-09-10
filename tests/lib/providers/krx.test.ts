import { describe, expect, test } from "bun:test";
import { findKrxClose, type KrxDailyResponse } from "@/lib/providers/krx";

function response(rows: Record<string, string>[]): KrxDailyResponse {
  return { OutBlock_1: rows as KrxDailyResponse["OutBlock_1"] };
}

const row = (over: Record<string, string> = {}) => ({
  BAS_DD: "20260908",
  ISU_CD: "005935",
  ISU_NM: "삼성전자우",
  TDD_CLSPRC: "198400",
  CMPPREVDD_PRC: "1200",
  ...over,
});

describe("findKrxClose", () => {
  test("returns close, derived prevClose and the row's own BAS_DD", () => {
    expect(findKrxClose(response([row()]), "005935")).toEqual({
      close: "198400",
      prevClose: "197200", // close - 대비
      tradeDate: "2026-09-08",
    });
  });

  test("handles a negative day-over-day change", () => {
    const found = findKrxClose(response([row({ CMPPREVDD_PRC: "-400" })]), "005935");
    expect(found?.prevClose).toBe("198800");
  });

  test("returns null for a code that isn't in the response", () => {
    expect(findKrxClose(response([row()]), "999999")).toBeNull();
  });

  // KRX blanks these fields for securities that didn't trade that session
  // (halted, not yet listed). Feeding a blank to decimal.js throws, which would
  // abort the whole daily job for one untradeable holding.
  test("returns null instead of throwing when the close is blank", () => {
    expect(findKrxClose(response([row({ TDD_CLSPRC: "" })]), "005935")).toBeNull();
    expect(findKrxClose(response([row({ TDD_CLSPRC: "   " })]), "005935")).toBeNull();
    expect(findKrxClose(response([row({ TDD_CLSPRC: "-" })]), "005935")).toBeNull();
  });

  test("keeps the close but nulls prevClose when only the change field is blank", () => {
    const found = findKrxClose(response([row({ CMPPREVDD_PRC: "" })]), "005935");
    expect(found).toEqual({ close: "198400", prevClose: null, tradeDate: "2026-09-08" });
  });

  test("tolerates thousands separators", () => {
    const found = findKrxClose(response([row({ TDD_CLSPRC: "198,400", CMPPREVDD_PRC: "1,200" })]), "005935");
    expect(found?.close).toBe("198400");
    expect(found?.prevClose).toBe("197200");
  });
});
