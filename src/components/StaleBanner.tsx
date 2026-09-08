/**
 * `StaleBanner` — spec 0002 §2.4. Shown whenever the briefing carries
 * `status='partial'` / a non-empty `degraded_sources`. Information, not an
 * error — `role="status"`, never `--color-danger`.
 */
const PROVIDER_LABELS: Record<string, string> = {
  ecos: "환율/거시지표 제공자(ECOS)",
  krx: "국내 시세 제공자(KRX)",
  dart: "공시 제공자(DART)",
  naver: "국내 뉴스 제공자(Naver)",
  finnhub: "해외 시세/뉴스 제공자(Finnhub)",
  fmp: "해외 기업정보 제공자(FMP)",
};

export interface StaleBannerProps {
  degradedSources: string[];
  /** Compact "MM-DD HH:mm" (Asia/Seoul) of the last known-good collection. */
  lastGoodAt?: string | null;
}

export function StaleBanner({ degradedSources, lastGoodAt }: StaleBannerProps) {
  if (degradedSources.length === 0) return null;

  const labels = degradedSources.map((s) => PROVIDER_LABELS[s] ?? s).join(", ");

  return (
    <div className="stale-banner" role="status">
      <span className="icon" aria-hidden="true">
        ⓘ
      </span>
      <span>
        <strong>시세 지연</strong> — {labels} 응답이 원활하지 않아 일부 수치가 최신이 아닙니다.
        {lastGoodAt ? ` 마지막 정상 수집 ${lastGoodAt}.` : ""}
      </span>
    </div>
  );
}
