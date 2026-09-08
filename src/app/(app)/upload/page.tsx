import { db } from "@/db";
import { security } from "@/db/schema";
import { todayInSeoul } from "@/lib/dates";
import { UploadFlow, type SecurityOption } from "./UploadFlow";

/**
 * Upload — `/upload`. Functionally required (spec 0002 §Scope explicitly
 * defers ITS visual design — OQ-1 — but the app has no other way to create a
 * `portfolio_snapshot`; `/transactions` only adjusts an existing one). Uses
 * the same token system, layout conventions and shared components
 * (Badge/EmptyState/appbar/.card/.btn) as the four designed screens; not
 * given the same design-iteration polish per the dispatch brief.
 *
 * Flow: pick file → POST /api/upload (parse-only preview) → review parsed
 * rows, diff vs. latest snapshot, and any unresolved/warning rows → resolve
 * aliases → confirm → POST /api/upload/commit.
 */
// Never statically prerendered: the security list backing the alias picker
// changes as new securities are resolved, and this page has no dynamic API
// (searchParams/params) to implicitly opt out of static generation like the
// other 4 screens do — without this, `next build` would freeze an empty
// securities list into the page at build time.
export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const allSecurities = await db.select().from(security);
  const securityOptions: SecurityOption[] = allSecurities
    .map((s) => ({
      id: s.id,
      label: s.market === "US" ? s.symbol : `${s.nameLocal} (${s.symbol})`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <>
      <header className="appbar">
        <h1>포트폴리오 업로드</h1>
      </header>
      <main className="viewport">
        <UploadFlow securities={securityOptions} todayIso={todayInSeoul()} />
      </main>
    </>
  );
}
