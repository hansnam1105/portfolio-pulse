import type { ReactNode } from "react";
import { TabBar } from "@/components/TabBar";

/**
 * App shell for the 5 in-scope screens (spec 0002 §1.1): a max-width mobile
 * column, each page renders its own `<header class="appbar">` (title/back/
 * as-of differ per screen so it isn't hoisted here), a scrolling content
 * area, and the fixed-bottom `TabBar`.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      {children}
      <TabBar />
    </div>
  );
}
