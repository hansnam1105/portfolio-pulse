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
function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((segment, i) =>
    segment.startsWith("**") && segment.endsWith("**") ? (
      <strong key={i}>{segment.slice(2, -2)}</strong>
    ) : (
      segment
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
