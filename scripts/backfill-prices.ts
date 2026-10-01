/**
 * One-off (re-runnable) historical price backfill.
 *
 * The daily job only ever writes *today's* prices, so `price_daily` starts the
 * day collection is switched on and the value charts have nothing to draw
 * until weeks later. This fills the window in from each provider's history:
 *
 *   KRX  — one call per trading date per product; each returns the whole market
 *   US   — one Yahoo call per symbol (see src/lib/providers/yahoo.ts for why
 *          Yahoo and not Finnhub/FMP, and why it is confined to this script)
 *   FX   — a single ECOS range call for the whole window
 *
 * Idempotent: every write is an upsert keyed by (security_id, trade_date) /
 * (pair, rate_date), so re-running only refreshes.
 *
 *   bun --preload ./scripts/preload-server-only.ts scripts/backfill-prices.ts [days]
 */
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { fxRateDaily, priceDaily, security } from "@/db/schema";
import { createDefaultGatewayDeps } from "@/lib/providers/gateway";
import { fetchKrxEtfDailyTrades, fetchKrxStockDailyTrades, findKrxClose } from "@/lib/providers/krx";
import { fetchYahooDailyCloses } from "@/lib/providers/yahoo";
import { fetchEcosStatistic } from "@/lib/providers/ecos";
import { todayInSeoul } from "@/lib/dates";

const DEFAULT_DAYS = 90;
const days = Number(process.argv[2] ?? DEFAULT_DAYS);
if (!Number.isFinite(days) || days <= 0) {
  console.error(`Usage: backfill-prices.ts [days]  (got ${process.argv[2]})`);
  process.exit(1);
}

const db = drizzle(new Pool({ connectionString: process.env.DATABASE_URL! }));
const gateway = createDefaultGatewayDeps();

function shiftDate(yyyyMmDd: string, delta: number): string {
  const dt = new Date(`${yyyyMmDd}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function isWeekend(yyyyMmDd: string): boolean {
  const day = new Date(`${yyyyMmDd}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

async function upsertPrice(row: {
  securityId: number;
  tradeDate: string;
  close: string;
  prevClose: string | null;
  currency: "KRW" | "USD";
  source: string;
}) {
  await db
    .insert(priceDaily)
    .values(row)
    .onConflictDoUpdate({
      target: [priceDaily.securityId, priceDaily.tradeDate],
      set: { close: row.close, prevClose: row.prevClose, source: row.source },
    });
}

async function main() {
  // Asia/Seoul, matching every other date in the app (spec 0001 § Cross-platform).
  const today = todayInSeoul();
  const start = shiftDate(today, -days);
  console.log(`Backfilling ${start} .. ${today}`);

  const securities = await db.select().from(security);
  const krx = securities.filter((s) => s.market === "KRX");
  const us = securities.filter((s) => s.market === "US");
  console.log(`${krx.length} KRX / ${us.length} US securities`);

  // --- KRX: one call per product per trading date, whole market each time ---
  const krxBySymbol = new Map(krx.map((s) => [s.symbol, s.id]));
  let krxWrites = 0;
  for (let date = start; date <= today; date = shiftDate(date, 1)) {
    if (isWeekend(date)) continue;
    for (const fetchProduct of [fetchKrxStockDailyTrades, fetchKrxEtfDailyTrades]) {
      const result = await fetchProduct(gateway, { tradeDate: date });
      if (!result.ok || !result.data) continue;
      for (const [symbol, securityId] of krxBySymbol) {
        const match = findKrxClose(result.data, symbol);
        if (!match) continue;
        await upsertPrice({
          securityId,
          tradeDate: match.tradeDate,
          close: match.close,
          prevClose: match.prevClose,
          currency: "KRW",
          source: "krx",
        });
        krxWrites += 1;
      }
    }
    process.stdout.write(".");
  }
  console.log(`\nKRX: ${krxWrites} rows upserted`);

  // --- US: one Yahoo call per symbol ---
  const range = days <= 31 ? "1mo" : days <= 93 ? "3mo" : days <= 186 ? "6mo" : "1y";
  let usWrites = 0;
  for (const sec of us) {
    const result = await fetchYahooDailyCloses(gateway, { symbol: sec.symbol, range });
    if (!result.ok || !result.data) {
      console.warn(`  ${sec.symbol}: ${result.error}`);
      continue;
    }
    let previous: number | null = null;
    for (const point of result.data) {
      if (point.tradeDate < start) {
        previous = point.close;
        continue;
      }
      await upsertPrice({
        securityId: sec.id,
        tradeDate: point.tradeDate,
        close: String(point.close),
        prevClose: previous === null ? null : String(previous),
        currency: "USD",
        source: "yahoo",
      });
      previous = point.close;
      usWrites += 1;
    }
    console.log(`  ${sec.symbol}: ${result.data.length} points`);
  }
  console.log(`US: ${usWrites} rows upserted`);

  // --- FX: one ECOS range call ---
  const compact = (d: string) => d.replace(/-/g, "");
  const fxResult = await fetchEcosStatistic(gateway, {
    statCode: "731Y001",
    cycle: "D",
    startDate: compact(start),
    endDate: compact(today),
    itemCode1: "0000001",
  });
  let fxWrites = 0;
  if (fxResult.ok && fxResult.data) {
    for (const row of fxResult.data.StatisticSearch.row) {
      const rateDate = `${row.TIME.slice(0, 4)}-${row.TIME.slice(4, 6)}-${row.TIME.slice(6, 8)}`;
      await db
        .insert(fxRateDaily)
        .values({ pair: "USDKRW", rateDate, rate: row.DATA_VALUE, source: "ecos" })
        .onConflictDoUpdate({
          target: [fxRateDaily.pair, fxRateDaily.rateDate],
          set: { rate: row.DATA_VALUE, source: "ecos" },
        });
      fxWrites += 1;
    }
  } else {
    console.warn(`  FX: ${fxResult.error}`);
  }
  console.log(`FX: ${fxWrites} rows upserted`);

  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
