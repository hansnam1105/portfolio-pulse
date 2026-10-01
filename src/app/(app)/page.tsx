import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { briefing, briefingItem, jobRun, newsItem } from "@/db/schema";
import { todayInSeoul } from "@/lib/dates";
import { getCurrentPortfolio } from "@/lib/holdings/list";
import { add, divSafe, mul, sub, Decimal, ZERO } from "@/lib/money";
import { formatAsOfHeader, formatMoneyAbsSpaced, formatPercentAbs, formatTimestampCompact } from "@/lib/format";
import { PLFigure } from "@/components/PLFigure";
import { StaleBanner } from "@/components/StaleBanner";
import { Disclaimer } from "@/components/Disclaimer";
import { EmptyState } from "@/components/StateViews";
import { PortfolioValueChart } from "@/components/PortfolioValueChart";
import { buildPortfolioValueSeries, tradeDateAxis } from "@/lib/holdings/history";
import { ProseMd } from "@/components/ProseMd";

/**
 * Today's Briefing — `/` (spec 0002 §3.1).
 *
 * NOTE on the hero delta: spec 0002's wireframe labels it "전일 대비" (vs.
 * yesterday). The backend does not store a prior-day *portfolio total* nor a
 * `prevClose` for KRX holdings (only US/Finnhub quotes carry `prevClose`;
 * spec 0001's KRX daily-close fetch stores `close` only) — so an exact
 * day-over-day change cannot be computed without inventing a number. Per this
 * app's own Computational Integrity principle (never show a derived figure
 * with the authority of a reported one), this renders "매수 대비" (vs. cost
 * basis) instead — always exactly computable from `current_holding`. Flagged
 * here and in the dispatch report rather than silently reproducing a label
 * spec 0002 wrote for a number the current backend can't produce.
 */
// Never statically prerendered — reads live DB state (today's briefing,
// current holdings) that must be fresh on every request.
/** Trading days shown in the value chart — matches the backfill window. */
const CHART_WINDOW_DAYS = 90;

export const dynamic = "force-dynamic";

export default async function BriefingPage() {
  const today = todayInSeoul();

  const [portfolio, briefingRows, lastJobRuns] = await Promise.all([
    getCurrentPortfolio(),
    db.select().from(briefing).where(eq(briefing.briefingDate, today)).limit(1),
    db
      .select()
      .from(jobRun)
      .where(eq(jobRun.jobName, "daily-briefing"))
      .orderBy(desc(jobRun.runDate))
      .limit(1),
  ]);

  // Constant-quantity backcast over the chart window (see history.ts): the
  // ledger holds one synthetic buy per position, so a true replay would show
  // zero until that date and then jump.
  const valueSeries = buildPortfolioValueSeries({
    holdings: portfolio.rows
      .filter((r) => r.result.status === "ok")
      .map((r) => ({
        securityId: r.security.securityId,
        currency: r.security.currency,
        quantity: r.result.status === "ok" ? r.result.quantityCurrent : ZERO,
      })),
    priceRows: portfolio.priceRows,
    fxRows: portfolio.fxRows,
    dates: tradeDateAxis(portfolio.priceRows, CHART_WINDOW_DAYS),
  });

  const todaysBriefing = briefingRows[0] ?? null;
  const lastJobRun = lastJobRuns[0] ?? null;

  // Gate on whether there are any current holdings at all, not on whether a
  // broker-export snapshot exists — ADR-0004 supports a portfolio built
  // entirely from manual_transaction rows with zero snapshots, and that case
  // must not be misreported as "no portfolio uploaded yet".
  const hasSnapshot = portfolio.rows.length > 0;
  const asOfLabel = portfolio.latestSnapshot ? formatAsOfHeader(portfolio.latestSnapshot.asOfDate) : null;

  let items: {
    securityId: number;
    headline: string;
    bodyMd: string;
    sentiment: string;
    citedNewsIds: number[];
  }[] = [];
  let newsKindById = new Map<number, "news" | "disclosure">();

  if (todaysBriefing) {
    const rows = await db.select().from(briefingItem).where(eq(briefingItem.briefingId, todaysBriefing.id));
    const weightBySecurityId = new Map(portfolio.rows.map((r) => [r.security.securityId, r.weightPct?.toNumber() ?? -1]));
    items = [...rows]
      .sort((a, b) => (weightBySecurityId.get(b.securityId) ?? -1) - (weightBySecurityId.get(a.securityId) ?? -1))
      .map((r) => ({
        securityId: r.securityId,
        headline: r.headline,
        bodyMd: r.bodyMd,
        sentiment: r.sentiment,
        citedNewsIds: r.citedNewsIds,
      }));

    const allCitedIds = [...new Set(items.flatMap((i) => i.citedNewsIds))];
    if (allCitedIds.length > 0) {
      const newsRows = await db
        .select({ id: newsItem.id, kind: newsItem.kind })
        .from(newsItem)
        .where(inArray(newsItem.id, allCitedIds));
      newsKindById = new Map(newsRows.map((r) => [r.id, r.kind]));
    }
  }

  return (
    <>
      <header className="appbar">
        <h1>오늘의 브리핑</h1>
        {asOfLabel && <span className="asof">{asOfLabel}</span>}
      </header>
      <main className="viewport">
        {!hasSnapshot ? (
          <EmptyState
            title="아직 업로드된 포트폴리오가 없습니다"
            description="증권사 거래내역 파일을 업로드하면 브리핑이 시작됩니다."
            action={
              <Link className="btn btn--primary" href="/upload">
                포트폴리오 업로드
              </Link>
            }
          />
        ) : (
          <>
            {todaysBriefing && todaysBriefing.degradedSources.length > 0 && (
              <StaleBanner
                degradedSources={todaysBriefing.degradedSources}
                lastGoodAt={todaysBriefing.generatedAt ? formatTimestampCompact(todaysBriefing.generatedAt) : null}
              />
            )}

            <HeroSummary
              totalValueKrw={portfolio.totalValueKrw}
              totalCostBasisKrw={portfolio.totalCostBasisKrw}
              rows={portfolio.rows}
            />

            <PortfolioValueChart series={valueSeries} />

            <h2 className="section">간밤 시장 요약</h2>
            <div className="card">
              {todaysBriefing?.overviewMd ? (
                <ProseMd md={todaysBriefing.overviewMd} />
              ) : (
                <p className="prose" lang="ko">
                  {lastJobRun
                    ? `오늘의 브리핑이 아직 생성되지 않았습니다. 마지막 작업 실행: ${lastJobRun.startedAt ? formatTimestampCompact(lastJobRun.startedAt) : "기록 없음"}.`
                    : "오늘의 브리핑이 아직 생성되지 않았습니다."}
                </p>
              )}
            </div>

            {items.length > 0 && (
              <>
                <h2 className="section">
                  종목별 브리핑 <span className="count">{items.length}</span>
                </h2>
                {items.map((item) => {
                  const row = portfolio.rows.find((r) => r.security.securityId === item.securityId);
                  const newsCount = item.citedNewsIds.filter((id) => newsKindById.get(id) === "news").length;
                  const discCount = item.citedNewsIds.filter((id) => newsKindById.get(id) === "disclosure").length;
                  const isEnglishTicker = row?.security.market === "US";

                  return (
                    <article className="card" key={item.securityId}>
                      <div className="brief-card__head">
                        <h3>
                          {isEnglishTicker ? <span lang="en">{row?.security.symbol}</span> : row?.security.nameLocal}
                        </h3>
                        {row?.result.status === "ok" && !row.result.costBasis.isZero() && (() => {
                          const plAmount = sub(row.result.valueCurrent ?? ZERO, row.result.costBasis);
                          return (
                            <PLFigure
                              amount={plAmount}
                              currency={row.security.currency}
                              percent={divSafe(mul(plAmount, 100), row.result.costBasis)}
                              amountHidden
                            />
                          );
                        })()}
                      </div>
                      <div className="brief-card__sub">
                        {row?.security.market === "KRX" ? `${row.security.symbol} · KRX` : `US · ${row?.security.symbol ?? ""}`}
                        {row?.result.status === "stale" && (
                          <span className="badge badge--stale" style={{ marginLeft: 6 }}>
                            시세 지연
                          </span>
                        )}
                      </div>
                      <ProseMd md={item.bodyMd} />
                      {(newsCount > 0 || discCount > 0) && (
                        <Link className="brief-card__links" href={`/holdings/${item.securityId}`}>
                          ▸ {newsCount > 0 && `관련 뉴스 ${newsCount}건`}
                          {newsCount > 0 && discCount > 0 && " · "}
                          {discCount > 0 && `공시 ${discCount}건`}
                        </Link>
                      )}
                    </article>
                  );
                })}
              </>
            )}

            <Disclaimer />
          </>
        )}
      </main>
    </>
  );
}

function HeroSummary({
  totalValueKrw,
  totalCostBasisKrw,
  rows,
}: {
  totalValueKrw: Decimal;
  totalCostBasisKrw: Decimal;
  rows: Awaited<ReturnType<typeof getCurrentPortfolio>>["rows"];
}) {
  const pl = sub(totalValueKrw, totalCostBasisKrw);
  const plPct = divSafe(mul(pl, 100), totalCostBasisKrw);

  const krValue = rows
    .filter((r) => r.security.market === "KRX")
    .reduce((sum, r) => (r.valueKrw ? add(sum, r.valueKrw) : sum), ZERO);
  const usValue = rows
    .filter((r) => r.security.market === "US")
    .reduce((sum, r) => (r.valueKrw ? add(sum, r.valueKrw) : sum), ZERO);
  const krPct = divSafe(mul(krValue, 100), totalValueKrw);
  const usPct = divSafe(mul(usValue, 100), totalValueKrw);

  return (
    <div className="card hero">
      <div className="hero__label">총 평가금액</div>
      <div className="hero__value money">{formatMoneyAbsSpaced(totalValueKrw, "KRW")}</div>
      <div className="hero__delta">
        <PLFigure amount={pl} currency="KRW" percent={plPct} />
        <span className="cmp">매수 대비</span>
      </div>
      {!totalValueKrw.isZero() && (
        <>
          <div className="alloc" aria-hidden="true">
            <span style={{ width: `${krPct?.toFixed(2) ?? 0}%`, background: "var(--color-primary)" }} />
            <span style={{ width: `${usPct?.toFixed(2) ?? 0}%`, background: "var(--color-slate-200)" }} />
          </div>
          <div className="alloc-legend">
            <span>
              <i style={{ background: "var(--color-primary)" }} />
              국내 {krPct ? formatPercentAbs(krPct) : "0.00"}%
            </span>
            <span>
              <i style={{ background: "var(--color-slate-200)" }} />
              해외 {usPct ? formatPercentAbs(usPct) : "0.00"}%
            </span>
          </div>
        </>
      )}
    </div>
  );
}
