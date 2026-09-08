import { describe, it, expect } from "bun:test";
import {
  computeCurrentHolding,
  selectApplicableTransactions,
  validateSellQuantity,
  type ManualTransactionInput,
  type SnapshotHoldingInput,
} from "@/lib/holdings/current";

const SNAPSHOT_DATE = "2026-09-01";

function tx(overrides: Partial<ManualTransactionInput> & Pick<ManualTransactionInput, "id" | "kind">): ManualTransactionInput {
  return {
    quantity: null,
    price: null,
    fees: "0",
    costBasisTotal: null,
    transactionDate: "2026-09-02",
    createdAt: "2026-09-02T00:00:00.000Z",
    voidedAt: null,
    supersededBySnapshotId: null,
    ...overrides,
  };
}

const baseHolding: SnapshotHoldingInput = {
  quantity: "10",
  costBasisTotal: "1000",
  marketValueAtUpload: "1100",
  currency: "KRW",
};

describe("selectApplicableTransactions", () => {
  it("excludes a voided transaction", () => {
    const transactions = [
      tx({ id: 1, kind: "buy", quantity: "1", price: "10", transactionDate: "2026-09-02" }),
      tx({ id: 2, kind: "buy", quantity: "1", price: "10", transactionDate: "2026-09-03", voidedAt: "2026-09-04T00:00:00.000Z" }),
    ];
    const result = selectApplicableTransactions(transactions, SNAPSHOT_DATE);
    expect(result.map((t) => t.id)).toEqual([1]);
  });

  it("excludes a superseded transaction", () => {
    const transactions = [
      tx({ id: 1, kind: "buy", quantity: "1", price: "10", transactionDate: "2026-09-02" }),
      tx({ id: 2, kind: "buy", quantity: "1", price: "10", transactionDate: "2026-09-03", supersededBySnapshotId: 99 }),
    ];
    const result = selectApplicableTransactions(transactions, SNAPSHOT_DATE);
    expect(result.map((t) => t.id)).toEqual([1]);
  });

  it("excludes a transaction dated on or before the snapshot's as_of_date (no double-counting)", () => {
    const transactions = [
      tx({ id: 1, kind: "buy", quantity: "1", price: "10", transactionDate: SNAPSHOT_DATE }), // same day as snapshot
      tx({ id: 2, kind: "buy", quantity: "1", price: "10", transactionDate: "2026-08-15" }), // before snapshot
      tx({ id: 3, kind: "buy", quantity: "1", price: "10", transactionDate: "2026-09-02" }), // after snapshot
    ];
    const result = selectApplicableTransactions(transactions, SNAPSHOT_DATE);
    expect(result.map((t) => t.id)).toEqual([3]);
  });

  it("includes everything when there is no prior snapshot (snapshotAsOfDate = null)", () => {
    const transactions = [tx({ id: 1, kind: "buy", quantity: "1", price: "10", transactionDate: "2020-01-01" })];
    const result = selectApplicableTransactions(transactions, null);
    expect(result.map((t) => t.id)).toEqual([1]);
  });

  it("orders by transactionDate then createdAt as a tie-break", () => {
    const transactions = [
      tx({ id: 1, kind: "buy", quantity: "1", price: "10", transactionDate: "2026-09-03", createdAt: "2026-09-03T09:00:00.000Z" }),
      tx({ id: 2, kind: "buy", quantity: "1", price: "10", transactionDate: "2026-09-02", createdAt: "2026-09-02T05:00:00.000Z" }),
      tx({ id: 3, kind: "buy", quantity: "1", price: "10", transactionDate: "2026-09-03", createdAt: "2026-09-03T01:00:00.000Z" }),
    ];
    const result = selectApplicableTransactions(transactions, SNAPSHOT_DATE);
    expect(result.map((t) => t.id)).toEqual([2, 3, 1]);
  });
});

describe("computeCurrentHolding — the ADR-0004 fold", () => {
  it("a buy after the snapshot date increases current quantity and cost basis", () => {
    const result = computeCurrentHolding({
      securityId: 1,
      snapshotAsOfDate: SNAPSHOT_DATE,
      holding: baseHolding,
      transactions: [
        tx({ id: 1, kind: "buy", quantity: "5", price: "20", fees: "1", transactionDate: "2026-09-05" }),
      ],
      priceAtAsOfDate: null,
      latestClose: null,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    // q = 10 + 5 = 15; c = 1000 + (5*20 + 1) = 1101
    expect(result.quantityCurrent.toFixed()).toBe("15");
    expect(result.costBasis.toFixed()).toBe("1101");
    expect(result.quantityBasis).toBe("exact");
  });

  it("a transaction dated before/at the snapshot's as_of_date does not double-count", () => {
    const result = computeCurrentHolding({
      securityId: 1,
      snapshotAsOfDate: SNAPSHOT_DATE,
      holding: baseHolding,
      transactions: [
        // Already reflected in the snapshot itself — must be ignored by the fold.
        tx({ id: 1, kind: "buy", quantity: "999", price: "1", transactionDate: "2026-08-01" }),
        tx({ id: 2, kind: "buy", quantity: "999", price: "1", transactionDate: SNAPSHOT_DATE }),
      ],
      priceAtAsOfDate: null,
      latestClose: null,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.quantityCurrent.toFixed()).toBe("10");
    expect(result.costBasis.toFixed()).toBe("1000");
  });

  it("set_quantity overrides quantity (and cost basis when supplied) and upgrades quantityBasis to exact", () => {
    const result = computeCurrentHolding({
      securityId: 1,
      snapshotAsOfDate: SNAPSHOT_DATE,
      holding: { ...baseHolding, quantity: null }, // v1 profile: no quantity, would otherwise be "estimated"
      transactions: [
        tx({ id: 1, kind: "set_quantity", quantity: "42", costBasisTotal: "4200", transactionDate: "2026-09-05" }),
      ],
      priceAtAsOfDate: "110", // would otherwise back-derive an estimated quantity
      latestClose: null,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.quantityCurrent.toFixed()).toBe("42");
    expect(result.costBasis.toFixed()).toBe("4200");
    expect(result.quantityBasis).toBe("exact");
  });

  it("set_quantity without a cost basis leaves the running cost basis untouched", () => {
    const result = computeCurrentHolding({
      securityId: 1,
      snapshotAsOfDate: SNAPSHOT_DATE,
      holding: baseHolding,
      transactions: [tx({ id: 1, kind: "set_quantity", quantity: "7", transactionDate: "2026-09-05" })],
      priceAtAsOfDate: null,
      latestClose: null,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.quantityCurrent.toFixed()).toBe("7");
    expect(result.costBasis.toFixed()).toBe("1000"); // unchanged from the snapshot
  });

  it("a voided transaction is excluded from the fold entirely", () => {
    const result = computeCurrentHolding({
      securityId: 1,
      snapshotAsOfDate: SNAPSHOT_DATE,
      holding: baseHolding,
      transactions: [
        tx({
          id: 1,
          kind: "buy",
          quantity: "1000",
          price: "1",
          transactionDate: "2026-09-05",
          voidedAt: "2026-09-06T00:00:00.000Z",
        }),
      ],
      priceAtAsOfDate: null,
      latestClose: null,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.quantityCurrent.toFixed()).toBe("10"); // unchanged from the snapshot
    expect(result.costBasis.toFixed()).toBe("1000");
  });

  it("sell reduces quantity and relieves cost basis proportionally at the average cost before the sale", () => {
    const result = computeCurrentHolding({
      securityId: 1,
      snapshotAsOfDate: SNAPSHOT_DATE,
      // avg cost = 1000 / 10 = 100 per share
      holding: baseHolding,
      transactions: [tx({ id: 1, kind: "sell", quantity: "4", transactionDate: "2026-09-05" })],
      priceAtAsOfDate: null,
      latestClose: null,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.quantityCurrent.toFixed()).toBe("6");
    expect(result.costBasis.toFixed()).toBe("600"); // 1000 - 4*100
  });

  it("remove zeroes out both quantity and cost basis", () => {
    const result = computeCurrentHolding({
      securityId: 1,
      snapshotAsOfDate: SNAPSHOT_DATE,
      holding: baseHolding,
      transactions: [tx({ id: 1, kind: "remove", transactionDate: "2026-09-05" })],
      priceAtAsOfDate: null,
      latestClose: null,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.quantityCurrent.toFixed()).toBe("0");
    expect(result.costBasis.toFixed()).toBe("0");
  });

  it("computes valueCurrent/unrealizedPl from latestClose when supplied", () => {
    const result = computeCurrentHolding({
      securityId: 1,
      snapshotAsOfDate: SNAPSHOT_DATE,
      holding: baseHolding,
      transactions: [],
      priceAtAsOfDate: null,
      latestClose: "150",
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.valueCurrent?.toFixed()).toBe("1500"); // 10 * 150
    expect(result.unrealizedPl?.toFixed()).toBe("500"); // 1500 - 1000
  });

  it("leaves valueCurrent/unrealizedPl null when latestClose is not supplied", () => {
    const result = computeCurrentHolding({
      securityId: 1,
      snapshotAsOfDate: SNAPSHOT_DATE,
      holding: baseHolding,
      transactions: [],
      priceAtAsOfDate: null,
      latestClose: null,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.valueCurrent).toBeNull();
    expect(result.unrealizedPl).toBeNull();
  });

  it("starts a brand-new position at zero when absent from the snapshot", () => {
    const result = computeCurrentHolding({
      securityId: 1,
      snapshotAsOfDate: SNAPSHOT_DATE,
      holding: null,
      transactions: [tx({ id: 1, kind: "buy", quantity: "3", price: "50", transactionDate: "2026-09-05" })],
      priceAtAsOfDate: null,
      latestClose: null,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.quantityCurrent.toFixed()).toBe("3");
    expect(result.costBasis.toFixed()).toBe("150");
  });

  it("back-derives an estimated quantity from marketValueAtUpload / priceAtAsOfDate when quantity is absent (v1 profile)", () => {
    const result = computeCurrentHolding({
      securityId: 1,
      snapshotAsOfDate: SNAPSHOT_DATE,
      holding: { quantity: null, costBasisTotal: "900", marketValueAtUpload: "1000", currency: "KRW" },
      transactions: [],
      priceAtAsOfDate: "100",
      latestClose: null,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.quantityCurrent.toFixed()).toBe("10"); // 1000 / 100
    expect(result.quantityBasis).toBe("estimated");
  });

  it("falls back to 'stale' when quantity is absent and priceAtAsOfDate is null (ADR-0004 §3 degenerate case)", () => {
    const result = computeCurrentHolding({
      securityId: 1,
      snapshotAsOfDate: SNAPSHOT_DATE,
      holding: { quantity: null, costBasisTotal: "900", marketValueAtUpload: "1000", currency: "KRW" },
      transactions: [tx({ id: 1, kind: "buy", quantity: "1", price: "1", transactionDate: "2026-09-05" })],
      priceAtAsOfDate: null,
      latestClose: null,
    });
    expect(result.status).toBe("stale");
    if (result.status !== "stale") throw new Error("unreachable");
    expect(result.frozenValue.toFixed()).toBe("1000");
    expect(result.asOfDate).toBe(SNAPSHOT_DATE);
    // Unmerged transactions are surfaced, not silently dropped or wrongly folded.
    expect(result.unmergedTransactions.map((t) => t.id)).toEqual([1]);
  });

  it("falls back to 'stale' when priceAtAsOfDate is zero (never divides by zero)", () => {
    const result = computeCurrentHolding({
      securityId: 1,
      snapshotAsOfDate: SNAPSHOT_DATE,
      holding: { quantity: null, costBasisTotal: "900", marketValueAtUpload: "1000", currency: "KRW" },
      transactions: [],
      priceAtAsOfDate: "0",
      latestClose: null,
    });
    expect(result.status).toBe("stale");
  });

  it("a fractional-share buy round-trips without floating-point drift", () => {
    const result = computeCurrentHolding({
      securityId: 1,
      snapshotAsOfDate: SNAPSHOT_DATE,
      holding: { quantity: "1.1", costBasisTotal: "132.5", marketValueAtUpload: "140", currency: "USD" },
      transactions: [tx({ id: 1, kind: "buy", quantity: "0.111111111", price: "10.5", fees: "0.5", transactionDate: "2026-09-05" })],
      priceAtAsOfDate: null,
      latestClose: null,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.quantityCurrent.toFixed()).toBe("1.211111111");
  });
});

describe("validateSellQuantity", () => {
  it("allows a sell that does not exceed the current quantity", () => {
    expect(validateSellQuantity("10", "10")).toEqual({ ok: true });
    expect(validateSellQuantity("10", "5")).toEqual({ ok: true });
  });

  it("rejects a sell that would drive quantity below zero, naming the current quantity", () => {
    const result = validateSellQuantity("5", "6");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("5");
    expect(result.message).toContain("6");
  });
});
