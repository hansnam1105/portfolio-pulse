import { describe, expect, it } from "bun:test";
import {
  computeAmount,
  kindRequiresPrice,
  kindRequiresQuantity,
  normalizeDecimalInput,
  validateTransactionForm,
  type TransactionFormValues,
} from "@/lib/transactions/formValidation";

const base: TransactionFormValues = {
  kind: "buy",
  securityId: 1,
  transactionDate: "2026-09-08",
  quantity: "50",
  price: "81200",
};

describe("validateTransactionForm", () => {
  it("passes a well-formed buy", () => {
    const result = validateTransactionForm(base);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it("requires a security", () => {
    const result = validateTransactionForm({ ...base, securityId: null });
    expect(result.valid).toBe(false);
    expect(result.errors.securityId).toBeDefined();
  });

  it("requires quantity for buy/sell/set_quantity but not remove", () => {
    expect(validateTransactionForm({ ...base, kind: "buy", quantity: "" }).errors.quantity).toBeDefined();
    expect(validateTransactionForm({ ...base, kind: "sell", quantity: "" }).errors.quantity).toBeDefined();
    expect(validateTransactionForm({ ...base, kind: "set_quantity", quantity: "" }).errors.quantity).toBeDefined();
    expect(validateTransactionForm({ ...base, kind: "remove", quantity: "" }).errors.quantity).toBeUndefined();
  });

  it("requires price for buy/sell only", () => {
    expect(validateTransactionForm({ ...base, kind: "buy", price: "" }).errors.price).toBeDefined();
    expect(validateTransactionForm({ ...base, kind: "sell", price: "" }).errors.price).toBeDefined();
    expect(validateTransactionForm({ ...base, kind: "set_quantity", price: "" }).errors.price).toBeUndefined();
    expect(validateTransactionForm({ ...base, kind: "remove", price: "" }).errors.price).toBeUndefined();
  });

  it("rejects a zero or negative quantity", () => {
    expect(validateTransactionForm({ ...base, quantity: "0" }).valid).toBe(false);
    expect(validateTransactionForm({ ...base, quantity: "-5" }).valid).toBe(false);
  });

  it("accepts a comma-formatted quantity/price", () => {
    expect(validateTransactionForm({ ...base, quantity: "1,000", price: "81,200" }).valid).toBe(true);
  });

  it("rejects a malformed date", () => {
    expect(validateTransactionForm({ ...base, transactionDate: "2026/09/08" }).errors.transactionDate).toBeDefined();
    expect(validateTransactionForm({ ...base, transactionDate: "" }).errors.transactionDate).toBeDefined();
  });
});

describe("kindRequiresQuantity / kindRequiresPrice", () => {
  it("matches ADR-0004's per-kind field requirements", () => {
    expect(kindRequiresQuantity("buy")).toBe(true);
    expect(kindRequiresQuantity("remove")).toBe(false);
    expect(kindRequiresPrice("set_quantity")).toBe(false);
    expect(kindRequiresPrice("sell")).toBe(true);
  });
});

describe("computeAmount", () => {
  it("multiplies quantity by price with decimal precision", () => {
    expect(computeAmount("50", "81200")).toBe("4060000");
  });
  it("handles comma-formatted input", () => {
    expect(computeAmount("1,000", "1,200.50")).toBe("1200500");
  });
  it("returns null when either field is not a positive number", () => {
    expect(computeAmount("", "100")).toBeNull();
    expect(computeAmount("10", "")).toBeNull();
    expect(computeAmount("0", "100")).toBeNull();
    expect(computeAmount("abc", "100")).toBeNull();
  });
});

describe("normalizeDecimalInput", () => {
  it("strips thousands separators and surrounding whitespace", () => {
    expect(normalizeDecimalInput(" 1,234,567 ")).toBe("1234567");
  });
});
