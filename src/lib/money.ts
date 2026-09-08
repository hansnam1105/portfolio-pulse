/**
 * Decimal-safe money and quantity helpers.
 *
 * Per ADR-0001 (Computational Integrity) and spec 0001 § Computational Integrity:
 * money and quantities are stored as Postgres `numeric` and MUST NEVER be handled
 * as IEEE-754 `number` in TypeScript. This module is the only place arithmetic on
 * money/quantity happens, including src/lib/holdings/current.ts's running
 * average-cost fold, which is exactly the kind of repeated division where float
 * drift accumulates.
 *
 * Library choice: `decimal.js`. Rationale — this app performs generic arbitrary-
 * precision decimal arithmetic (add/sub/mul/div, running averages) across two
 * currencies and derived quantities, not currency-formatted "money object" math
 * (allocation, currency-safe addition guards) that a Dinero-style library is built
 * around. decimal.js has no ESM/CJS packaging friction on Vercel's Node runtime,
 * a tiny surface, and is already a common Drizzle/Zod-ecosystem companion.
 */
import Decimal from "decimal.js";

Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

/** A decimal-safe numeric type. Accepts string, number (from JSON), or Decimal. */
export type DecimalInput = string | number | Decimal;

/** Parse a raw value (string from Postgres `numeric`, or a literal) into a Decimal. */
export function toDecimal(value: DecimalInput): Decimal {
  if (value instanceof Decimal) return value;
  return new Decimal(value);
}

/** Format a Decimal (or decimal input) back to a string suitable for a `numeric` column. */
export function toNumericString(value: DecimalInput): string {
  return toDecimal(value).toFixed();
}

export function add(a: DecimalInput, b: DecimalInput): Decimal {
  return toDecimal(a).plus(toDecimal(b));
}

export function sub(a: DecimalInput, b: DecimalInput): Decimal {
  return toDecimal(a).minus(toDecimal(b));
}

export function mul(a: DecimalInput, b: DecimalInput): Decimal {
  return toDecimal(a).times(toDecimal(b));
}

/**
 * Safe division. Returns `null` instead of throwing/producing Infinity/NaN when
 * the divisor is zero — callers (notably the quantity back-derivation in
 * current.ts, spec 0001 § current_holding) must treat this as the documented
 * "missing price" degenerate case, never as a crash or a silent zero.
 */
export function divSafe(a: DecimalInput, b: DecimalInput): Decimal | null {
  const divisor = toDecimal(b);
  if (divisor.isZero()) return null;
  return toDecimal(a).dividedBy(divisor);
}

export function isZero(value: DecimalInput): boolean {
  return toDecimal(value).isZero();
}

export function isNegative(value: DecimalInput): boolean {
  return toDecimal(value).isNegative();
}

export function gt(a: DecimalInput, b: DecimalInput): boolean {
  return toDecimal(a).greaterThan(toDecimal(b));
}

export function gte(a: DecimalInput, b: DecimalInput): boolean {
  return toDecimal(a).greaterThanOrEqualTo(toDecimal(b));
}

export function lt(a: DecimalInput, b: DecimalInput): boolean {
  return toDecimal(a).lessThan(toDecimal(b));
}

export const ZERO = new Decimal(0);

export { Decimal };
