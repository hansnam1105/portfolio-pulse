import { percentChangeOverSeries, type SeriesPoint } from "@/lib/holdings/history";
import { directionOf, formatMoneyAbs, formatPercentSigned } from "@/lib/format";
import { ValueSparkline } from "@/components/ValueSparkline";

/**
 * Total portfolio value over the chart window.
 *
 * The series is a constant-quantity backcast (see src/lib/holdings/history.ts):
 * today's holdings valued at each past date's close. It answers "what would
 * today's portfolio have been worth then", NOT "what was it worth then", so the
 * caption says so outright — this app does not show a derived figure with the
 * authority of a reported one (spec 0001 § Computational Integrity).
 */
export function PortfolioValueChart({ series }: { series: SeriesPoint[] }) {
  if (series.length < 2) {
    return (
      <div className="card">
        <h2 className="section" style={{ marginTop: 0 }}>
          평가금액 추이
        </h2>
        <p className="prose" lang="ko">
          추이를 그리려면 최소 2거래일의 시세가 필요합니다.
        </p>
      </div>
    );
  }

  const changePct = percentChangeOverSeries(series);
  const direction = changePct ? directionOf(changePct) : "flat";
  const first = series[0]!;
  const last = series[series.length - 1]!;
  const low = series.reduce((min, p) => (p.value.lessThan(min.value) ? p : min), first);
  const high = series.reduce((max, p) => (p.value.greaterThan(max.value) ? p : max), first);

  return (
    <div className="card">
      <h2 className="section" style={{ marginTop: 0 }}>
        평가금액 추이
        {changePct && (
          <span className={`pl--${direction}`} style={{ fontVariantNumeric: "tabular-nums" }}>
            {formatPercentSigned(changePct)}%
          </span>
        )}
      </h2>
      <ValueSparkline
        points={series.map((p) => ({ tradeDate: p.tradeDate, close: p.value.toNumber() }))}
        direction={direction}
        ariaLabel={
          `${first.tradeDate}부터 ${last.tradeDate}까지 ${series.length}거래일 평가금액 추이. ` +
          `${changePct ? `${formatPercentSigned(changePct)}% 변화, ` : ""}` +
          `최저 ${formatMoneyAbs(low.value, "KRW")}, 최고 ${formatMoneyAbs(high.value, "KRW")}.`
        }
      />
      <div className="spark-range">
        <span>
          최저 <span className="money">{formatMoneyAbs(low.value, "KRW")}</span>
        </span>
        <span>
          최고 <span className="money">{formatMoneyAbs(high.value, "KRW")}</span>
        </span>
      </div>
      <p className="meta" style={{ marginTop: "var(--space-sm)" }}>
        현재 보유 수량 기준으로 과거 종가를 적용한 추정치입니다 · {first.tradeDate.slice(5)} ~ {last.tradeDate.slice(5)}
      </p>
    </div>
  );
}
