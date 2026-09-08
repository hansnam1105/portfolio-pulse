/**
 * Pure client-side validation for the add/edit transaction form (spec 0002
 * §3.4). Only checks that are knowable from the form's own fields live here —
 * the "sell exceeds current quantity" business rule is server-authoritative
 * (src/lib/holdings/current.ts `validateSellQuantity`, enforced by
 * POST/PATCH /api/transactions) and is NOT duplicated here; this module only
 * decides whether a submit attempt is even well-formed enough to send.
 *
 * `computeAmount` uses src/lib/money.ts's decimal.js helpers, not IEEE-754
 * `number` math, even though it's only a display preview — ADR-0001
 * Computational Integrity applies to every money computation in the app, not
 * just the ones that get persisted.
 */
import { mul, toDecimal } from "@/lib/money";
export type TransactionKind = "buy" | "sell" | "set_quantity" | "remove";

export interface TransactionFormValues {
  kind: TransactionKind;
  securityId: number | null;
  transactionDate: string;
  quantity: string;
  price: string;
}

export type TransactionFormField = "securityId" | "transactionDate" | "quantity" | "price";

export interface TransactionFormValidation {
  valid: boolean;
  errors: Partial<Record<TransactionFormField, string>>;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isPositiveDecimal(raw: string): boolean {
  const normalized = raw.replace(/,/g, "").trim();
  if (normalized.length === 0) return false;
  if (!/^\d+(\.\d+)?$/.test(normalized)) return false;
  return Number(normalized) > 0;
}

export function kindRequiresQuantity(kind: TransactionKind): boolean {
  return kind === "buy" || kind === "sell" || kind === "set_quantity";
}

export function kindRequiresPrice(kind: TransactionKind): boolean {
  return kind === "buy" || kind === "sell";
}

export function validateTransactionForm(values: TransactionFormValues): TransactionFormValidation {
  const errors: TransactionFormValidation["errors"] = {};

  if (values.securityId === null) {
    errors.securityId = "종목을 선택해 주세요.";
  }

  if (!DATE_RE.test(values.transactionDate)) {
    errors.transactionDate = "거래일을 YYYY-MM-DD 형식으로 입력해 주세요.";
  }

  if (kindRequiresQuantity(values.kind) && !isPositiveDecimal(values.quantity)) {
    errors.quantity = "0보다 큰 수량을 입력해 주세요.";
  }

  if (kindRequiresPrice(values.kind) && !isPositiveDecimal(values.price)) {
    errors.price = "0보다 큰 단가를 입력해 주세요.";
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

/** Normalizes a user-typed numeric string ("81,200") to a plain decimal string ("81200"). */
export function normalizeDecimalInput(raw: string): string {
  return raw.replace(/,/g, "").trim();
}

/** Computed amount = quantity × price, as a decimal string, or null if not computable. */
export function computeAmount(quantity: string, price: string): string | null {
  const q = normalizeDecimalInput(quantity);
  const p = normalizeDecimalInput(price);
  if (!isPositiveDecimal(q) || !isPositiveDecimal(p)) return null;
  return mul(toDecimal(q), toDecimal(p)).toFixed();
}
