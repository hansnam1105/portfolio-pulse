import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { newsItem, newsLink, priceDaily, security } from "@/db/schema";
import { getCurrentPortfolio, findHoldingRow } from "@/lib/holdings/list";
import { divSafe, mul, sub, toDecimal } from "@/lib/money";
import { formatMoneyAbs, formatPercentAbs, formatQuantity, formatTimestampCompact } from "@/lib/format";
import { buildSparkline } from "@/lib/sparkline";
import { PLFigure } from "@/components/PLFigure";
import { Badge } from "@/components/Badge";
import { Disclaimer } from "@/components/Disclaimer";
import { EmptyState } from "@/components/StateViews";

/**
 * Holding detail — `/holdings/[securityId]` (spec 0002 §3.3).
 */
// Never statically prerendered — current_holding, price history and news
// reflect live DB state.
export const dynamic = "force-dynamic";

export default async function HoldingDetailPage({
  params,
}: {
  params: Promise<{ securityId: string }>;
}) {
  const { securityId: securityIdParam } = await params;
  const securityId = Number(securityIdParam);
  if (!Number.isInteger(securityId) || securityId <= 0) notFound();

  const [secRows, portfolio] = await Promise.all([
    db.select().from(security).where(eq(security.id, securityId)).limit(1),
    getCurrentPortfolio(),
  ]);
  const sec = secRows[0];
  if (!sec) notFound();

  const row = findHoldingRow(portfolio, securityId);

  const [priceRows, newsLinkRows] = await Promise.all([
    db
      .select()
      .from(priceDaily)
      .where(eq(priceDaily.securityId, securityId))
      .orderBy(desc(priceDaily.tradeDate))
      .limit(30),
    db
      .select({ item: newsItem })
      .from(newsLink)
      .innerJoin(newsItem, eq(newsLink.newsItemId, newsItem.id))
      .where(eq(newsLink.securityId, securityId))
      .orderBy(desc(newsItem.publishedAt))
      .limit(20),
  ]);

  const history = [...priceRows].reverse().map((p) => ({ tradeDate: p.tradeDate, close: Number(p.close) }));
  const geometry = buildSparkline(history);

  const newsItems = newsLinkRows.map((r) => r.item).filter((i) => i.kind === "news").slice(0, 10);
  const disclosureItems = newsLinkRows.map((r) => r.item).filter((i) => i.kind === "disclosure").slice(0, 10);

  const displayName = sec.market === "US" ? sec.symbol : sec.nameLocal;

  return (
    <>
      <header className="appbar">
        <Link className="back" href="/portfolio">
          <span className="chev" aria-hidden="true">
            ‹
          </span>
          <h1>{sec.market === "US" ? <span lang="en">{displayName}</span> : displayName}</h1>
        </Link>
      </header>
      <main className="viewport">
        {!row ? (
          <EmptyState title="보유 정보를 찾을 수 없습니다" description="현재 포트폴리오에 이 종목이 포함되어 있지 않습니다." />
        ) : (
          <>
            <PositionHeader row={row} sec={sec} />

            <h2 className="section">30일 가격 추이</h2>
            <div className="card">
              {geometry ? (
                <>
                  <svg
                    className="spark"
                    viewBox={`0 0 ${geometry.width} ${geometry.height}`}
                    role="img"
                    aria-label={`최근 ${history.length}일 가격 추이. ${formatMoneyAbs(geometry.min, sec.currency)}에서 ${formatMoneyAbs(geometry.max, sec.currency)} 사이에서 등락했습니다.`}
                  >
                    <path className="area" d={geometry.areaPath} />
                    <path className="line" d={geometry.linePath} />
                  </svg>
                  <div className="spark-range">
                    <span>
                      {history.length}일 최저{" "}
                      <span className="money">{formatMoneyAbs(geometry.min, sec.currency)}</span>
                    </span>
                    <span>
                      최고 <span className="money">{formatMoneyAbs(geometry.max, sec.currency)}</span>
                    </span>
                  </div>
                </>
              ) : (
                <p className="prose">가격 이력이 없습니다.</p>
              )}
            </div>

            <PositionFacts row={row} sec={sec} snapshotAsOfDate={portfolio.latestSnapshot?.asOfDate ?? null} />

            <h2 className="section">
              관련 뉴스 <span className="count">{newsItems.length}</span>
            </h2>
            <div className="card">
              {newsItems.length === 0 ? (
                <p className="prose">관련 뉴스가 없습니다.</p>
              ) : (
                <ul className="news">
                  {newsItems.map((n) => (
                    <li key={n.id}>
                      <a className="news__link" href={n.url} target="_blank" rel="noreferrer">
                        <span className="news__body">
                          <span className="news__title" lang={n.lang}>
                            {n.title}
                          </span>
                          <span className="news__src">{formatTimestampCompact(n.publishedAt)}</span>
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <h2 className="section">
              공시 <span className="count">{disclosureItems.length}</span>
            </h2>
            <div className="card">
              {disclosureItems.length === 0 ? (
                <p className="prose">공시가 없습니다.</p>
              ) : (
                <ul className="news">
                  {disclosureItems.map((n) => (
                    <li key={n.id}>
                      <a className="news__link" href={n.url} target="_blank" rel="noreferrer">
                        <span className="news__body">
                          <span className="news__title" lang={n.lang}>
                            {n.title}
                          </span>
                          <span className="news__src">{formatTimestampCompact(n.publishedAt)}</span>
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="btn-row">
              <Link className="btn btn--secondary" href={`/transactions?securityId=${securityId}&kind=set_quantity`}>
                수량 조정
              </Link>
              <Link className="btn btn--secondary" href={`/transactions?securityId=${securityId}`}>
                거래 입력
              </Link>
            </div>

            <Disclaimer />
          </>
        )}
      </main>
    </>
  );
}

function PositionHeader({
  row,
  sec,
}: {
  row: NonNullable<ReturnType<typeof findHoldingRow>>;
  sec: { symbol: string; market: "KRX" | "US"; currency: "KRW" | "USD" };
}) {
  const { result } = row;

  if (result.status === "stale") {
    return (
      <div className="card hero">
        <div className="hero__label">평가금액</div>
        <div className="hero__value money">{formatMoneyAbs(result.frozenValue, sec.currency)}</div>
        <div className="meta" style={{ marginTop: "var(--space-sm)" }}>
          {sec.symbol} · {sec.market} · {result.asOfDate} 기준 (시세 지연)
        </div>
        <div className="divider" />
        <Badge variant="stale">시세 지연</Badge>
        {result.unmergedTransactions.length > 0 && (
          <p className="meta" style={{ marginTop: "var(--space-sm)" }}>
            {result.asOfDate} 이후 입력된 거래 {result.unmergedTransactions.length}건은 시세 지연으로 인해 합산되지 않고
            별도로 표시됩니다. 거래 내역에서 확인할 수 있습니다.
          </p>
        )}
      </div>
    );
  }

  const value = result.valueCurrent;
  const pl = value !== null ? sub(value, result.costBasis) : null;
  const plPct = pl !== null && !result.costBasis.isZero() ? divSafe(mul(pl, 100), result.costBasis) : null;

  return (
    <div className="card hero">
      <div className="hero__label">평가금액</div>
      <div className="hero__value money">{value !== null ? formatMoneyAbs(value, sec.currency) : "—"}</div>
      {pl !== null && (
        <div className="hero__delta">
          <PLFigure amount={pl} currency={sec.currency} percent={plPct} />
        </div>
      )}
      <div className="meta" style={{ marginTop: "var(--space-sm)" }}>
        {sec.symbol} · {sec.market}
        {row.weightPct ? ` · 비중 ${formatPercentAbs(row.weightPct)}%` : ""}
      </div>
      {result.quantityBasis === "estimated" && (
        <>
          <div className="divider" />
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", flexWrap: "wrap" }}>
            <Badge variant="estimated">추정 수량</Badge>
            <span className="meta">
              <strong>{formatQuantity(result.quantityCurrent)}주 (추정)</strong> — 업로드 파일에 수량이 없어 평가금액
              ÷ 종가로 계산한 값입니다.
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function PositionFacts({
  row,
  sec,
  snapshotAsOfDate,
}: {
  row: NonNullable<ReturnType<typeof findHoldingRow>>;
  sec: { currency: "KRW" | "USD" };
  snapshotAsOfDate: string | null;
}) {
  const { result } = row;

  return (
    <>
      <h2 className="section">보유 내역</h2>
      <div className="card">
        <dl style={{ margin: 0 }}>
          {result.status === "ok" ? (
            <>
              <div className="kv">
                <dt>평균 단가</dt>
                <dd>
                  {result.quantityCurrent.isZero() ? (
                    "—"
                  ) : (
                    <span className="money">
                      {formatMoneyAbs(divSafe(result.costBasis, result.quantityCurrent) ?? toDecimal(0), sec.currency)}
                    </span>
                  )}
                  {result.quantityBasis === "estimated" && (
                    <span style={{ fontWeight: 600, color: "var(--color-text-muted)" }}> (추정)</span>
                  )}
                </dd>
              </div>
              <div className="kv">
                <dt>수량</dt>
                <dd>
                  {formatQuantity(result.quantityCurrent)}주
                  {result.quantityBasis === "estimated" && (
                    <span style={{ fontWeight: 600, color: "var(--color-text-muted)" }}> (추정)</span>
                  )}
                </dd>
              </div>
              <div className="kv">
                <dt>매수금액</dt>
                <dd><span className="money">{formatMoneyAbs(result.costBasis, sec.currency)}</span></dd>
              </div>
            </>
          ) : (
            <div className="kv">
              <dt>평가금액 (시세 지연)</dt>
              <dd><span className="money">{formatMoneyAbs(result.frozenValue, sec.currency)}</span></dd>
            </div>
          )}
          <div className="kv">
            <dt>기준일</dt>
            <dd>{snapshotAsOfDate ?? "—"}</dd>
          </div>
        </dl>
      </div>
    </>
  );
}
