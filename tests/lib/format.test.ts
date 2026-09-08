import { describe, expect, it } from "bun:test";
import {
  directionArrow,
  directionOf,
  directionWord,
  formatMoneyAbs,
  formatMoneyAbsSpaced,
  formatMoneySigned,
  formatPercentSigned,
  formatQuantity,
} from "@/lib/format";

/**
 * PLFigure (src/components/PLFigure.tsx) is a pure presentational wrapper
 * around these direction-encoding functions — spec 0002 §2.1 requires every
 * P/L figure to carry direction via 4 redundant channels (arrow, sign,
 * colour, hidden word). These tests cover the actual direction-encoding
 * logic without needing a DOM/React test runner.
 */
describe("directionOf", () => {
  it("is up for a positive value", () => {
    expect(directionOf("1240000")).toBe("up");
  });
  it("is down for a negative value", () => {
    expect(directionOf("-310500")).toBe("down");
  });
  it("is flat for exactly zero", () => {
    expect(directionOf("0")).toBe("flat");
    expect(directionOf("0.00")).toBe("flat");
  });
});

describe("directionArrow / directionWord", () => {
  it("up uses ▲ and 상승", () => {
    expect(directionArrow("up")).toBe("▲");
    expect(directionWord("up")).toBe("상승");
  });
  it("down uses ▼ and 하락", () => {
    expect(directionArrow("down")).toBe("▼");
    expect(directionWord("down")).toBe("하락");
  });
  it("flat uses an en dash (not a hyphen) and 보합", () => {
    expect(directionArrow("flat")).toBe("–");
    expect(directionArrow("flat")).not.toBe("-");
    expect(directionWord("flat")).toBe("보합");
  });
});

describe("formatMoneySigned", () => {
  it("prefixes a positive KRW amount with + and no thousands drift", () => {
    expect(formatMoneySigned("1240000", "KRW")).toBe("+₩1,240,000");
  });
  it("uses U+2212 MINUS SIGN (not a hyphen) for a negative amount", () => {
    const out = formatMoneySigned("-310500", "KRW");
    expect(out).toBe("−₩310,500");
    expect(out).not.toContain("-");
  });
  it("renders zero with no sign", () => {
    expect(formatMoneySigned("0", "KRW")).toBe("₩0");
  });
  it("formats USD with 2 decimal places", () => {
    expect(formatMoneySigned("630", "USD")).toBe("+$630.00");
  });
});

describe("formatPercentSigned", () => {
  it("signs and rounds to 2 decimals", () => {
    expect(formatPercentSigned("8")).toBe("+8.00");
    expect(formatPercentSigned("-2.849")).toBe("−2.85");
  });
});

describe("formatMoneyAbs / formatMoneyAbsSpaced", () => {
  it("never includes a sign", () => {
    expect(formatMoneyAbs("-4060000", "KRW")).toBe("₩4,060,000");
  });
  it("spaced variant inserts a space after the currency symbol", () => {
    expect(formatMoneyAbsSpaced("87432100", "KRW")).toBe("₩ 87,432,100");
  });
});

describe("formatQuantity", () => {
  it("trims trailing zeros", () => {
    expect(formatQuantity("300.00000000")).toBe("300");
  });
  it("keeps meaningful fractional shares", () => {
    expect(formatQuantity("50.5")).toBe("50.5");
  });
});
