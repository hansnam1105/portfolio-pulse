/**
 * Value-over-time series for the Portfolio and Briefing charts.
 *
 * Pure and DOM-free, like current.ts and sparkline.ts, so the arithmetic is
 * unit-testable without a database.
 *
 * ## Constant-quantity backcast, deliberately
 *
 * These series value **today's** quantities at each past date's close, rather
 * than replaying the transaction ledger date by date. That is a real modelling
 * choice, not a shortcut: this portfolio's positions were entered as synthetic
 * `buy` rows all dated the same day (they are current positions at average
 * cost, not real purchase events), so a true replay would render the portfolio
 * as worth zero for the whole window and then jump — correct, and useless.
 *
 * The consequence is that the series answers "what would today's portfolio have
 * been worth then", NOT "what was the portfolio worth then". Per this project's
 * Computational Integrity rule, callers must label it as such on screen
 * (현재 보유 수량 기준) rather than presenting it as reported history.
 *
 * `quantityBySecurityId` is an input rather than something derived here, so
 * switching to a true per-date replay later is a caller-side change.
 */
import { add, mul, sub, divSafe, toDecimal, ZERO, type Decimal, type DecimalInput } from "@/lib/money";

export interface PriceRowInput {
  securityId: number;
  tradeDate: string; // YYYY-MM-DD
  close: DecimalInput;
}

export interface FxRowInput {
  rateDate: string; // YYYY-MM-DD
  rate: DecimalInput;
}

export interface HoldingQuantityInput {
  securityId: number;
  currency: "KRW" | "USD";
  quantity: DecimalInput;
}

export interface SeriesPoint {
  tradeDate: string;
  value: Decimal;
}

/**
 * Most recent value at or before `date`. Carrying the last close forward is
 * what makes a mixed KRX/US basket summable at all: the two markets keep
 * different trading calendars, so on any given date one side may simply not
 * have traded.
 *
 * `rows` need not be sorted.
 */
export function onOrBefore<T>(
  rows: readonly T[],
  date: string,
  dateOf: (row: T) => string,
): T | null {
  let best: T | null = null;
  let bestDate = "";
  for (const row of rows) {
    const rowDate = dateOf(row);
    if (rowDate <= date && rowDate > bestDate) {
      best = row;
      bestDate = rowDate;
    }
  }
  return best;
}

export function closeOnOrBefore(rows: readonly PriceRowInput[], date: string): Decimal | null {
  const row = onOrBefore(rows, date, (r) => r.tradeDate);
  return row ? toDecimal(row.close) : null;
}

export function fxOnOrBefore(rows: readonly FxRowInput[], date: string): Decimal | null {
  const row = onOrBefore(rows, date, (r) => r.rateDate);
  return row ? toDecimal(row.rate) : null;
}

/** Ascending distinct trade dates present in `priceRows`, optionally capped to
 * the most recent `limit` dates. */
export function tradeDateAxis(priceRows: readonly PriceRowInput[], limit?: number): string[] {
  const dates = [...new Set(priceRows.map((r) => r.tradeDate))].sort();
  return limit !== undefined && dates.length > limit ? dates.slice(dates.length - limit) : dates;
}

/**
 * One security's close series over `dates`, carrying values forward. Dates
 * before that security's first known close are omitted rather than guessed.
 */
export function buildCloseSeries(
  priceRows: readonly PriceRowInput[],
  securityId: number,
  dates: readonly string[],
): SeriesPoint[] {
  const rows = priceRows.filter((r) => r.securityId === securityId);
  if (rows.length === 0) return [];

  const points: SeriesPoint[] = [];
  for (const tradeDate of dates) {
    const close = closeOnOrBefore(rows, tradeDate);
    if (close === null) continue; // before this security's first close
    points.push({ tradeDate, value: close });
  }
  return points;
}

/**
 * Total portfolio value in KRW per date.
 *
 * A date is emitted only when **every** held security resolves a close (and FX
 * resolves, if any holding is USD). Summing a partial basket would silently
 * understate the total and read as a real dip on the chart, which is exactly
 * the class of derived-but-authoritative-looking figure this app refuses to
 * show. Holdings with zero quantity are ignored so a sold-out position can't
 * hold the whole series back.
 */
export function buildPortfolioValueSeries(params: {
  holdings: readonly HoldingQuantityInput[];
  priceRows: readonly PriceRowInput[];
  fxRows: readonly FxRowInput[];
  dates: readonly string[];
}): SeriesPoint[] {
  const held = params.holdings.filter((h) => !toDecimal(h.quantity).isZero());
  if (held.length === 0) return [];

  const pricesBySecurity = new Map<number, PriceRowInput[]>();
  for (const row of params.priceRows) {
    const list = pricesBySecurity.get(row.securityId);
    if (list) list.push(row);
    else pricesBySecurity.set(row.securityId, [row]);
  }

  const needsFx = held.some((h) => h.currency === "USD");

  const points: SeriesPoint[] = [];
  for (const tradeDate of params.dates) {
    const fx = needsFx ? fxOnOrBefore(params.fxRows, tradeDate) : null;
    if (needsFx && fx === null) continue;

    let total = ZERO;
    let complete = true;
    for (const holding of held) {
      const close = closeOnOrBefore(pricesBySecurity.get(holding.securityId) ?? [], tradeDate);
      if (close === null) {
        complete = false;
        break;
      }
      const native = mul(toDecimal(holding.quantity), close);
      total = add(total, holding.currency === "USD" ? mul(native, fx!) : native);
    }
    if (complete) points.push({ tradeDate, value: total });
  }
  return points;
}

/** Percent change from the first to the last point. Null when there aren't two
 * points or the base is zero (`divSafe`). */
export function percentChangeOverSeries(points: readonly SeriesPoint[]): Decimal | null {
  if (points.length < 2) return null;
  const first = points[0]!.value;
  const last = points[points.length - 1]!.value;
  return divSafe(mul(sub(last, first), 100), first);
}
