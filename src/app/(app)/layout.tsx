import type { ReactNode } from "react";
import { headers } from "next/headers";
import { TabBar } from "@/components/TabBar";
import { AMOUNT_VISIBILITY_BOOT_SCRIPT } from "@/components/AmountVisibilityToggle";

/**
 * App shell for the 5 in-scope screens (spec 0002 §1.1): a max-width mobile
 * column, each page renders its own `<header class="appbar">` (title/back/
 * as-of differ per screen so it isn't hoisted here), a scrolling content
 * area, and the fixed-bottom `TabBar`.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  // Applies the stored hide-amounts preference before first paint, so balances
  // never flash visible on load. Needs the per-request CSP nonce (middleware.ts
  // sets `script-src 'self' 'nonce-…'` with no `unsafe-inline`). Lives in this
  // layout rather than the root one so /login stays statically rendered.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <div className="app-shell">
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: AMOUNT_VISIBILITY_BOOT_SCRIPT }} />
      {children}
      <TabBar />
    </div>
  );
}
