import type { ReactNode } from "react";

/**
 * Minimal renderer for the markdown subset the briefing model actually emits
 * (`overview_md` / `body_md`): paragraphs, `- ` bullet lists, and `**bold**`.
 *
 * Deliberately not a markdown library and deliberately not
 * `dangerouslySetInnerHTML`. The input is LLM output, and this app ships a
 * strict CSP with no `unsafe-inline` (src/middleware.ts); rendering real
 * React nodes means nothing the model returns can ever become markup.
 * Anything outside this subset renders as its literal text, which is the
 * safe failure mode — the previous behaviour rendered `**like this**`
 * verbatim for every emphasis the model used.
 */
/**
 * Currency-shaped tokens the briefing model writes into its prose — "793600
 * KRW", "₩793,600", "$34.41". They can't be marked up at the render site like
 * every other amount in the app because the model, not this codebase, decides
 * where they appear, so the hide-amounts toggle would otherwise miss them
 * entirely. This is a heuristic and it fails safe: an unmatched number simply
 * stays visible, exactly as it does today.
 */
const CURRENCY_TOKEN =
  /((?:[₩$]\s?\d[\d,]*(?:\.\d+)?)|(?:\d[\d,]*(?:\.\d+)?\s?(?:KRW|USD|원|달러)))/g;

function renderMoney(text: string, keyPrefix: string): ReactNode[] {
  // `split` on a regex with one capture group puts the captured tokens at the
  // odd indices, so position alone identifies them. (Never `.test()` here — the
  // `g` flag makes it stateful via lastIndex.)
  return text.split(CURRENCY_TOKEN).map((segment, i) =>
    i % 2 === 1 ? (
      <span className="money" key={`${keyPrefix}-m${i}`}>
        {segment}
      </span>
    ) : (
      segment
    ),
  );
}

function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((segment, i) =>
    segment.startsWith("**") && segment.endsWith("**") ? (
      <strong key={i}>{renderMoney(segment.slice(2, -2), `b${i}`)}</strong>
    ) : (
      <span key={i}>{renderMoney(segment, `t${i}`)}</span>
    ),
  );
}

export function ProseMd({ md, lang = "ko" }: { md: string; lang?: string }) {
  const lines = md.split("\n").filter((line) => line.trim().length > 0);

  const blocks: ReactNode[] = [];
  let bullets: string[] = [];

  const flushBullets = () => {
    if (bullets.length === 0) return;
    blocks.push(
      <ul className="prose prose--list" lang={lang} key={`ul-${blocks.length}`}>
        {bullets.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bullet?.[1]) {
      bullets.push(bullet[1]);
      continue;
    }
    flushBullets();
    blocks.push(
      <p className="prose" lang={lang} key={`p-${blocks.length}`}>
        {renderInline(trimmed)}
      </p>,
    );
  }
  flushBullets();

  return <>{blocks}</>;
}
