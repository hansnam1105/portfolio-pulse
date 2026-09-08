"use client";

/**
 * `TabBar` — the app's only global navigation (spec 0002 §1.1): 4 primary
 * destinations, fixed bottom, ≥44px targets, `env(safe-area-inset-bottom)`
 * padding. No drawer, no profile menu — just a 5th "sign out" control (added
 * for ADR-0005's single-user Google auth), styled identically to the tabs.
 *
 * DEVIATION FROM MOCKUP (flagged per dispatch instructions): the visual
 * alpha (docs/mockups/alpha-v1.html) uses `role="tablist"`/`role="tab"` with
 * `aria-controls` because it is a single static page that swaps `<section>`
 * panels via JS. Here each destination is a real route (a distinct page), so
 * the ARIA tabs pattern (which requires same-page `tabpanel`s and roving
 * keyboard focus) does not apply — using it would misrepresent the structure
 * to assistive tech. This renders a standard `<nav>` landmark with links and
 * `aria-current="page"` on the active one, which is the correct pattern for
 * multi-page navigation, while keeping the mockup's visual language (`.tabbar`
 * class, glyphs, spacing) unchanged.
 *
 * SCOPE DEVIATION (also flagged): spec 0002's wireframe lists the 4th tab as
 * [설정] (/settings), which is explicitly out of scope for this dispatch. The
 * dispatch brief requires /upload to be functionally reachable (it's the only
 * way to create a portfolio_snapshot), so this tab bar substitutes [업로드]
 * for [설정] rather than linking to a page that doesn't exist. /holdings/[id]
 * is intentionally not a tab destination — spec 0002 treats it as a drill-in
 * from Portfolio/Briefing, not a primary destination.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

const TABS = [
  { href: "/", label: "브리핑", glyph: "◉" },
  { href: "/portfolio", label: "포트폴리오", glyph: "▦" },
  { href: "/transactions", label: "거래", glyph: "⇄" },
  { href: "/upload", label: "업로드", glyph: "⇧" },
] as const;

export function TabBar() {
  const pathname = usePathname();

  return (
    <nav className="tabbar" aria-label="주요 화면">
      {TABS.map((tab) => {
        const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
        return (
          <Link key={tab.href} href={tab.href} aria-current={active ? "page" : undefined}>
            <span className="glyph" aria-hidden="true">
              {tab.glyph}
            </span>
            {tab.label}
          </Link>
        );
      })}
      <button type="button" onClick={() => signOut({ callbackUrl: "/api/auth/signin" })}>
        <span className="glyph" aria-hidden="true">
          ⏻
        </span>
        로그아웃
      </button>
    </nav>
  );
}
