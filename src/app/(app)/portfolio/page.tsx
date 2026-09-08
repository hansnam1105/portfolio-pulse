import Link from "next/link";
import { getCurrentPortfolio, type PortfolioHoldingRow } from "@/lib/holdings/list";
import { add, divSafe, mul, sub, Decimal, ZERO } from "@/lib/money";
import { formatMoneyAbs, formatMoneyAbsSpaced, formatPercentAbs } from "@/lib/format";
import { PLFigure } from "@/components/PLFigure";
import { Badge } from "@/components/Badge";
import { SegmentedFilter } from "@/components/SegmentedFilter";
import { EmptyState } from "@/components/StateViews";

type MarketFilter = "all" | "kr" | "us";

// Never statically prerendered — current_holding reflects live DB state.
export const dynamic = "force-dynamic";

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ market?: string }>;
}) {
  const { market: marketParam } = await searchParams;
  const filter: MarketFilter = marketParam === "kr" || marketParam === "us" ? marketParam : "all";

  const portfolio = await getCurrentPortfolio();

  const visibleRows = portfolio.rows.filter((r) => {
    if (filter === "kr") return r.security.market === "KRX";
    if (filter === "us") return r.security.market === "US";
    return true;
  });
  const krRows = portfolio.rows.filter((r) => r.security.market === "KRX");
  const usRows = portfolio.rows.filter((r) => r.security.market === "US");

  return (
    <>
      <header className="appbar">
        <h1>포트폴리오</h1>
        {portfolio.latestSnapshot && <span className="asof">기준일 {portfolio.latestSnapshot.asOfDate.slice(5)}</span>}
      </header>
      <main className="viewport">
        {portfolio.rows.length === 0 ? (
          <EmptyState
            title="보유 종목이 없습니다"
            description="파일을 업로드하거나 거래를 직접 입력해 보유 종목을 추가할 수 있습니다."
            action={
              <div className="btn-row" style={{ marginTop: 0 }}>
                <Link className="btn btn--secondary" href="/upload">
                  업로드
                </Link>
                <Link className="btn btn--secondary" href="/transactions">
                  거래 직접 입력
                </Link>
              </div>
            }
          />
        ) : (
          <>
            <TotalCard portfolio={portfolio} />

            <SegmentedFilter
              paramName="market"
              ariaLabel="시장 필터"
              defaultValue="all"
              options={[
                { value: "all", label: "전체" },
                { value: "kr", label: "국내" },
                { value: "us", label: "해외" },
              ]}
            />

            {(filter === "all" || filter === "kr") && krRows.length > 0 && (
              <MarketGroup title="국내 (KRX)" caption="국내 보유 종목" rows={filter === "all" ? krRows : visibleRows} currency="KRW" />
            )}
            {(filter === "all" || filter === "us") && usRows.length > 0 && (
              <MarketGroup title="해외 (US)" caption="해외 보유 종목" rows={filter === "all" ? usRows : visibleRows} currency="USD" />
            )}
            {visibleRows.length === 0 && (
              <EmptyState title="해당 시장에 보유 종목이 없습니다" />
            )}

            <div style={{ marginTop: "var(--space-lg)" }}>
              <Link className="btn btn--primary" href="/transactions">
                ＋ 거래 입력
              </Link>
            </div>
          </>
        )}
      </main>
    </>
  );
}

function TotalCard({ portfolio }: { portfolio: Awaited<ReturnType<typeof getCurrentPortfolio>> }) {
  const pl = sub(portfolio.totalValueKrw, portfolio.totalCostBasisKrw);
  const plPct = divSafe(mul(pl, 100), portfolio.totalCostBasisKrw);

  return (
    <div className="card hero">
      <div className="hero__label">
        총 평가금액 <span style={{ fontWeight: 400 }}>(KRW 환산)</span>
      </div>
      <div className="hero__value">{formatMoneyAbsSpaced(portfolio.totalValueKrw, "KRW")}</div>
      <div className="divider" />
      <dl style={{ margin: 0 }}>
        <div className="kv">
          <dt>매수금액</dt>
          <dd>{formatMoneyAbs(portfolio.totalCostBasisKrw, "KRW")}</dd>
        </div>
        <div className="kv">
          <dt>평가손익</dt>
          <dd>
            <PLFigure amount={pl} currency="KRW" percent={plPct} />
          </dd>
        </div>
        {portfolio.fxRate ? (
          <div className="kv">
            <dt>적용 환율</dt>
            <dd>
              {new Decimal(portfolio.fxRate.rate).toFixed(2)}원/USD · {portfolio.fxRate.rateDate.slice(5)}
            </dd>
          </div>
        ) : (
          <div className="kv">
            <dt>적용 환율</dt>
            <dd>정보 없음</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function MarketGroup({
  title,
  caption,
  rows,
  currency,
}: {
  title: string;
  caption: string;
  rows: PortfolioHoldingRow[];
  currency: "KRW" | "USD";
}) {
  const subtotal = rows.reduce((sum, r) => {
    if (r.result.status === "ok" && r.result.valueCurrent !== null) return add(sum, r.result.valueCurrent);
    if (r.result.status === "stale") return add(sum, r.result.frozenValue);
    return sum;
  }, ZERO);

  return (
    <>
      <div className="group-head">
        <span>{title}</span>
        <span className="subtotal">{formatMoneyAbs(subtotal, currency)}</span>
      </div>
      <table className="holdings">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">종목</th>
            <th scope="col">평가금액</th>
            <th scope="col">평가손익</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <HoldingRow key={row.security.securityId} row={row} />
          ))}
        </tbody>
      </table>
    </>
  );
}

function HoldingRow({ row }: { row: PortfolioHoldingRow }) {
  const { security, result } = row;
  const isUs = security.market === "US";
  const nameNode = isUs ? <span lang="en">{security.symbol}</span> : security.nameLocal;

  const noValue =
    (result.status === "ok" && (result.valueCurrent === null || result.valueCurrent.isZero())) || false;

  return (
    <tr>
      <td colSpan={3}>
        <Link className="row" href={`/holdings/${security.securityId}`}>
          <span className="row__main">
            <span className="row__name">
              {nameNode}
              {result.status === "ok" && result.quantityBasis === "estimated" && <Badge variant="estimated">추정 수량</Badge>}
              {result.status === "stale" && <Badge variant="stale">시세 지연</Badge>}
              {noValue && <Badge variant="stale">평가금액 없음</Badge>}
            </span>
            <span className="row__sub">
              {security.symbol}
              {noValue ? " · 비중 계산 제외" : row.weightPct ? ` · 비중 ${formatPercentAbs(row.weightPct)}%` : ""}
            </span>
          </span>
          <span className="row__fig">
            {result.status === "ok" && !noValue && result.valueCurrent !== null && (
              <>
                <span className="row__value">{formatMoneyAbs(result.valueCurrent, security.currency)}</span>
                {!result.costBasis.isZero() && (() => {
                  const plAmount = sub(result.valueCurrent, result.costBasis);
                  return (
                    <PLFigure
                      amount={plAmount}
                      currency={security.currency}
                      percent={divSafe(mul(plAmount, 100), result.costBasis)}
                    />
                  );
                })()}
              </>
            )}
            {result.status === "stale" && (
              <span className="row__value">
                {formatMoneyAbs(result.frozenValue, security.currency)}
                <span className="row__krw">{result.asOfDate.slice(5)} 기준</span>
              </span>
            )}
            {noValue && <span className="row__value" style={{ color: "var(--color-text-muted)" }}>—</span>}
            {isUs && row.valueKrw && result.status !== "stale" && !noValue && (
              <span className="row__krw">{formatMoneyAbs(row.valueKrw, "KRW")} 환산</span>
            )}
          </span>
        </Link>
      </td>
    </tr>
  );
}
