import { describe, it, expect } from "bun:test";
import {
  add,
  Decimal,
  divSafe,
  gt,
  gte,
  isNegative,
  isZero,
  lt,
  mul,
  sub,
  toDecimal,
  toNumericString,
  ZERO,
} from "@/lib/money";

/**
 * Spec 0001 acceptance criteria: "Money values round-trip through parse ->
 * store -> display with no floating-point drift; unit tests cover KRW
 * (integer-like) and USD (2-dp) plus a fractional-share quantity."
 */
describe("money", () => {
  describe("KRW (integer-like)", () => {
    it("round-trips a large integer-like value with no drift", () => {
      const raw = "1234567890"; // as it would come back from Postgres `numeric`
      const value = toDecimal(raw);
      expect(toNumericString(value)).toBe("1234567890");
    });

    it("adds two KRW amounts exactly", () => {
      const result = add("1000000", "900000");
      expect(toNumericString(result)).toBe("1900000");
    });
  });

  describe("USD (2 dp)", () => {
    it("round-trips a 2-decimal value with no drift", () => {
      const raw = "1234.56";
      expect(toNumericString(toDecimal(raw))).toBe("1234.56");
    });

    it("adds 0.1 + 0.2 to exactly 0.3 (would fail under IEEE-754 floats)", () => {
      // Sanity check that the underlying language float footgun exists...
      expect(0.1 + 0.2).not.toBe(0.3);
      // ...and that our decimal-safe helper avoids it.
      const result = add("0.1", "0.2");
      expect(toNumericString(result)).toBe("0.3");
    });

    it("multiplies a fractional cost basis without drift", () => {
      const result = mul("1200.50", "3");
      expect(toNumericString(result)).toBe("3601.5");
    });
  });

  describe("fractional-share quantity", () => {
    it("round-trips a fractional quantity with no drift", () => {
      const raw = "10.123456789";
      expect(toNumericString(toDecimal(raw))).toBe("10.123456789");
    });

    it("divides a market value by a price to back-derive a fractional quantity", () => {
      const result = divSafe("1000", "3");
      expect(result).not.toBeNull();
      // decimal.js precision is set to 34 significant digits (money.ts), so this
      // does not silently truncate to a JS float's ~15-17 digit precision.
      expect(result!.toFixed()).toBe("333.3333333333333333333333333333333");
    });

    it("returns null (never Infinity/NaN) when dividing by zero", () => {
      expect(divSafe("100", "0")).toBeNull();
      expect(divSafe("0", "0")).toBeNull();
    });
  });

  describe("comparisons and helpers", () => {
    it("toDecimal accepts string, number, and Decimal inputs uniformly", () => {
      expect(toDecimal("5").equals(toDecimal(5))).toBe(true);
      expect(toDecimal(new Decimal("5")).equals(toDecimal(5))).toBe(true);
    });

    it("sub computes an exact difference", () => {
      expect(toNumericString(sub("2500000", "2500000"))).toBe("0");
    });

    it("isZero / isNegative", () => {
      expect(isZero("0")).toBe(true);
      expect(isZero("0.0")).toBe(true);
      expect(isZero(ZERO)).toBe(true);
      expect(isNegative("-1")).toBe(true);
      expect(isNegative("1")).toBe(false);
    });

    it("gt / gte / lt", () => {
      expect(gt("2", "1")).toBe(true);
      expect(gt("1", "1")).toBe(false);
      expect(gte("1", "1")).toBe(true);
      expect(lt("1", "2")).toBe(true);
      expect(lt("2", "1")).toBe(false);
    });

    it("ZERO is the additive identity", () => {
      expect(add("42.5", ZERO).toFixed()).toBe("42.5");
    });
  });
});
