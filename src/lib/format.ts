/**
 * UI-layer display formatting for money, quantity, percent and P/L direction.
 *
 * src/lib/money.ts (ADR-0001 Computational Integrity) deliberately contains only
 * decimal-safe *arithmetic* — no display formatting. This module is the one place
 * a Decimal-safe value is turned into a localized display string for the UI, so no
 * screen re-implements rounding/sign/locale rules ad hoc. It never does its own
 * arithmetic beyond what's needed to format (abs/sign inspection) — real math stays
 * in src/lib/money.ts and src/lib/holdings/current.ts.
 */
import { isNegative, isZero, toDecimal, type DecimalInput } from "@/lib/money";

export type Currency = "KRW" | "USD";
export type Direction = "up" | "down" | "flat";

/**
 * Korean market convention (docs/design.md, spec 0002 §1.3): a positive value is
 * "up" (rendered red), negative is "down" (blue), exactly zero is "flat" — applied
 * app-wide to both KRX and US holdings, never per-market.
 */
export function directionOf(value: DecimalInput): Direction {
  if (isZero(value)) return "flat";
  return isNegative(value) ? "down" : "up";
}

const KRW_FORMATTER = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});
const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});
const PERCENT_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

/** Formats the *unsigned magnitude* of a money value with its currency symbol. */
export function formatMoneyAbs(value: DecimalInput, currency: Currency): string {
  const abs = toDecimal(value).abs();
  if (currency === "KRW") {
    return `₩${KRW_FORMATTER.format(abs.toNumber())}`;
  }
  return `$${USD_FORMATTER.format(abs.toNumber())}`;
}

/** Display-figure variant with a space after the symbol ("₩ 87,432,100"),
 * used for the hero total (spec 0002 §1.2 Display figure). */
export function formatMoneyAbsSpaced(value: DecimalInput, currency: Currency): string {
  return formatMoneyAbs(value, currency).replace(/^([₩$])/, "$1 ");
}

/** Formats a money value including its sign (spec 0002 §2.1: explicit +/-). */
export function formatMoneySigned(value: DecimalInput, currency: Currency): string {
  const dir = directionOf(value);
  const sign = dir === "up" ? "+" : dir === "down" ? "−" : "";
  return `${sign}${formatMoneyAbs(value, currency)}`;
}

/** Formats the unsigned magnitude of a percent value, e.g. "8.00". */
export function formatPercentAbs(value: DecimalInput): string {
  return PERCENT_FORMATTER.format(toDecimal(value).abs().toNumber());
}

/** Formats a percent value with sign, e.g. "+8.00" / "−5.00" / "0.00". */
export function formatPercentSigned(value: DecimalInput): string {
  const dir = directionOf(value);
  const sign = dir === "up" ? "+" : dir === "down" ? "−" : "";
  return `${sign}${formatPercentAbs(value)}`;
}

/** Formats a share quantity, trimming trailing zeros ("300" not "300.00000000"). */
export function formatQuantity(value: DecimalInput): string {
  const d = toDecimal(value);
  return d.toDP(4).toNumber().toLocaleString("en-US", { maximumFractionDigits: 4 });
}

/** Visually-hidden direction word per spec 0002 §2.1 (PLFigure's 4th channel). */
export function directionWord(direction: Direction): "상승" | "하락" | "보합" {
  if (direction === "up") return "상승"; // 상승
  if (direction === "down") return "하락"; // 하락
  return "보합"; // 보합
}

/** Arrow glyph per direction. Flat uses an en dash, never a hyphen (spec 0002 §2.1). */
export function directionArrow(direction: Direction): "▲" | "▼" | "–" {
  if (direction === "up") return "▲"; // ▲
  if (direction === "down") return "▼"; // ▼
  return "–"; // –
}

/** Safe percent-change helper: (current - base) / base * 100, or null if base is zero. */
export function percentChange(current: DecimalInput, base: DecimalInput): ReturnType<typeof toDecimal> | null {
  const b = toDecimal(base);
  if (b.isZero()) return null;
  return toDecimal(current).minus(b).dividedBy(b).times(100);
}

/** Formats an Asia/Seoul calendar date (YYYY-MM-DD) as "9월 8일 (월)" for headers. */
export function formatAsOfHeader(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00+09:00`);
  const formatter = new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "Asia/Seoul",
  });
  return formatter.format(d);
}

/** Formats an Asia/Seoul calendar date as "09-08" (compact, used inline). */
export function formatDateCompact(isoDate: string): string {
  return isoDate.slice(5).replace("-", "-");
}

/** Formats a timestamp as "09-08 06:12" (Asia/Seoul), used for "as of" captions. */
export function formatTimestampCompact(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}
