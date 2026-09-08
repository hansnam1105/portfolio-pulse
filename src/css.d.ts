/**
 * Ambient declaration for plain (non-CSS-Modules) global stylesheet imports.
 *
 * `node_modules/next/types/global.d.ts` declares `*.module.css` (CSS Modules)
 * but not a bare `*.css`, so `import "./globals.css"` in src/app/layout.tsx —
 * a standard Next.js App Router pattern for a root stylesheet — fails
 * `next build`'s type-check step ("Cannot find module or type declarations
 * for side-effect import") without this. globals.css itself `@import`s the
 * generated tokens.css (bun scripts/compile-tokens.ts); this declaration
 * covers both.
 */
declare module "*.css";
