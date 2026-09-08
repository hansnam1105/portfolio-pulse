/**
 * `current_holding` — the exact computation (ADR-0004, spec 0001 § current_holding).
 *
 * "My current portfolio" = the latest `portfolio_snapshot`'s holdings, folded
 * with every non-voided, non-superseded `manual_transaction` dated after that
 * snapshot's `as_of_date`, in `(transaction_date, created_at)` order. This is
 * the single place this fold exists — the daily briefing job and every screen
 * that shows "what I own now" must go through this function, never re-derive
 * it. All arithmetic uses src/lib/money.ts decimal helpers; never IEEE-754.
 *
 * Pure and side-effect free: callers load the snapshot holding, the
 * transaction rows, and (optionally) the latest close price from Postgres and
 * pass them in, which keeps this fully unit-testable without a database.
 */
import { Decimal, ZERO, add, divSafe, mul, sub, toDecimal, type DecimalInput } from "@/lib/money";
import type { Currency } from "@/lib/parsers/samsung-securities";

export type QuantityBasis = "exact" | "estimated";
export type TransactionKind = "buy" | "sell" | "set_quantity" | "remove";

/** `H` — the latest snapshot's holding row for this security, or null if absent. */
export interface SnapshotHoldingInput {
  /** v2: NULLABLE. Present only if a future, richer parser profile supplies it. */
  quantity: DecimalInput | null;
  /** 매수금액, exact, always present when H exists. */
  costBasisTotal: DecimalInput;
  /** 평가금액, exact, always present when H exists. */
  marketValueAtUpload: DecimalInput;
  currency: Currency;
}

/** One `manual_transaction` row, pre-filtering not required — this module
 * applies the ADR-0004 §3 filter (date, voided, superseded) itself. */
export interface ManualTransactionInput {
  id: number;
  kind: TransactionKind;
  quantity: DecimalInput | null;
  price: DecimalInput | null;
  fees: DecimalInput;
  costBasisTotal: DecimalInput | null;
  /** Asia/Seoul calendar date, YYYY-MM-DD — the ordering + supersession key. */
  transactionDate: string;
  /** Used as the tie-break within the same transactionDate. */
  createdAt: string;
  voidedAt: string | null;
  supersededBySnapshotId: number | null;
}

export interface ComputeCurrentHoldingParams {
  securityId: number;
  /** `S.as_of_date` — the latest snapshot's effective date. */
  snapshotAsOfDate: string | null;
  /** `H` — null if this security is absent from the latest snapshot (newly bought). */
  holding: SnapshotHoldingInput | null;
  /** All manual_transaction rows for this security; this function applies the
   * ADR-0004 §3 filter and ordering itself. */
  transactions: readonly ManualTransactionInput[];
  /** `price_daily(security, S.as_of_date)` — required only to back-derive a
   * missing quantity (v1 profile). `null`/zero triggers the degenerate
   * "stale" fallback per ADR-0004 §3. */
  priceAtAsOfDate: DecimalInput | null;
  /** `latest_close(security)` — used only to compute display value/P&L; the
   * fold's quantity/cost-basis result does not depend on it. */
  latestClose?: DecimalInput | null;
}

export interface CurrentHoldingOk {
  status: "ok";
  securityId: number;
  quantityCurrent: Decimal;
  costBasis: Decimal;
  quantityBasis: QuantityBasis;
  /** null when `latestClose` was not supplied. */
  valueCurrent: Decimal | null;
  unrealizedPl: Decimal | null;
}

export interface CurrentHoldingStale {
  status: "stale";
  securityId: number;
  /** `H.marketValueAtUpload`, frozen "as of `as_of_date`" per ADR-0004 §3. */
  frozenValue: Decimal;
  asOfDate: string;
  /** T, listed separately rather than silently folded into a wrong total. */
  unmergedTransactions: readonly ManualTransactionInput[];
}

export type CurrentHoldingResult = CurrentHoldingOk | CurrentHoldingStale;

/** Applies the ADR-0004 §3 filter and ordering to a security's raw transaction rows. */
export function selectApplicableTransactions(
  transactions: readonly ManualTransactionInput[],
  snapshotAsOfDate: string | null,
): ManualTransactionInput[] {
  return transactions
    .filter((t) => t.voidedAt === null)
    .filter((t) => t.supersededBySnapshotId === null)
    .filter((t) => snapshotAsOfDate === null || t.transactionDate > snapshotAsOfDate)
    .sort((a, b) => {
      if (a.transactionDate !== b.transactionDate) {
        return a.transactionDate < b.transactionDate ? -1 : 1;
      }
      return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
    });
}

export function computeCurrentHolding(params: ComputeCurrentHoldingParams): CurrentHoldingResult {
  const applicable = selectApplicableTransactions(params.transactions, params.snapshotAsOfDate);

  // Base leg (from the export).
  let q: Decimal;
  let c: Decimal;
  let quantityBasis: QuantityBasis;

  if (params.holding === null) {
    q = ZERO;
    c = ZERO;
    quantityBasis = "exact"; // nothing to estimate; the position starts at zero
  } else if (params.holding.quantity !== null) {
    q = toDecimal(params.holding.quantity);
    c = toDecimal(params.holding.costBasisTotal);
    quantityBasis = "exact";
  } else {
    // No quantity in the export (profile v1) -> back-derive, or fall back to stale.
    const price = params.priceAtAsOfDate === null ? null : toDecimal(params.priceAtAsOfDate);
    const derivedQuantity = price === null ? null : divSafe(params.holding.marketValueAtUpload, price);
    if (derivedQuantity === null) {
      // price_daily missing or zero for as_of_date -> degenerate fallback (ADR-0004 §3).
      return {
        status: "stale",
        securityId: params.securityId,
        frozenValue: toDecimal(params.holding.marketValueAtUpload),
        asOfDate: params.snapshotAsOfDate ?? "",
        unmergedTransactions: applicable,
      };
    }
    q = derivedQuantity;
    c = toDecimal(params.holding.costBasisTotal);
    quantityBasis = "estimated";
  }

  for (const t of applicable) {
    switch (t.kind) {
      case "buy": {
        const quantity = toDecimal(t.quantity ?? 0);
        const price = toDecimal(t.price ?? 0);
        const fees = toDecimal(t.fees);
        q = add(q, quantity);
        c = add(c, add(mul(quantity, price), fees));
        break;
      }
      case "sell": {
        const quantity = toDecimal(t.quantity ?? 0);
        // Proportional cost relief at the average cost BEFORE this row.
        const avgCostBefore = q.isZero() ? ZERO : (divSafe(c, q) ?? ZERO);
        q = sub(q, quantity);
        c = sub(c, mul(quantity, avgCostBefore));
        break;
      }
      case "set_quantity": {
        q = toDecimal(t.quantity ?? 0);
        c = t.costBasisTotal !== null ? toDecimal(t.costBasisTotal) : c;
        quantityBasis = "exact"; // set_quantity upgrades the position to exact (ADR-0004 §3)
        break;
      }
      case "remove": {
        q = ZERO;
        c = ZERO;
        break;
      }
    }
  }

  const latestClose = params.latestClose == null ? null : toDecimal(params.latestClose);
  const valueCurrent = latestClose === null ? null : mul(q, latestClose);
  const unrealizedPl = valueCurrent === null ? null : sub(valueCurrent, c);

  return {
    status: "ok",
    securityId: params.securityId,
    quantityCurrent: q,
    costBasis: c,
    quantityBasis,
    valueCurrent,
    unrealizedPl,
  };
}

export interface SellValidationResult {
  ok: boolean;
  /** Present when `ok` is false; names the current quantity per WCAG 3.3.3 /
   * spec 0001 acceptance criteria ("names the current quantity"). */
  message?: string;
}

/**
 * Write-time guard for `POST /api/transactions` (ADR-0004): a sell that would
 * drive quantity below zero is rejected before the row is ever inserted, with
 * an error naming the current quantity. Call this against the
 * `current_holding` computed from the existing transaction set, BEFORE
 * inserting the new sell.
 */
export function validateSellQuantity(
  currentQuantity: DecimalInput,
  sellQuantity: DecimalInput,
): SellValidationResult {
  const current = toDecimal(currentQuantity);
  const sell = toDecimal(sellQuantity);
  if (sell.greaterThan(current)) {
    return {
      ok: false,
      message: `Cannot sell ${sell.toFixed()} shares: current quantity is only ${current.toFixed()}.`,
    };
  }
  return { ok: true };
}
