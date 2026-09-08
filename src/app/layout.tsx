import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

/**
 * Root layout (spec 0002 §1.1: mobile-first, 390×844 design target, reflows
 * up). `lang="ko"` on the document per spec §5 — English passages (tickers,
 * quoted headlines) carry their own `lang="en"` at the point of use.
 *
 * Theme: tokens.json ships a `[data-theme="dark"]` block and every component
 * class in globals.css consumes semantic color tokens exclusively, so setting
 * `data-theme="dark"` on `<html>` (e.g. from a future settings toggle) is
 * fully wired. It is deliberately NOT auto-activated from OS preference here:
 * docs/design.md OQ-4 states dark values are AA-verified by calculation only
 * and have not been reviewed in situ, and the user-approved visual alpha
 * (docs/mockups/alpha-v1.html) itself renders light-only. Auto-flipping every
 * dark-mode OS user into an unreviewed palette would go beyond what was
 * approved. `/settings` (where a manual toggle would live) is out of this
 * dispatch's scope per the brief.
 */
export const metadata: Metadata = {
  title: "portfolio-pulse",
  description: "포트폴리오 브리핑",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
