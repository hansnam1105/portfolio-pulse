# portfolio-pulse — Design Guide

**Status: `alpha — full design-foundation pass deferred until after visual direction is approved`**

This is a **fast first-pass** record, not a completed `docs/design-foundation.md` derivation. It exists
so the visual alpha (`docs/mockups/alpha-v1.html`) is traceable to a decision rather than to taste.
The deferred steps are listed in § Deferred below and mirrored in the UI spec's Open Questions.

Related: [`docs/specs/0001-portfolio-pulse-system-design.md § Accessibility`](specs/0001-portfolio-pulse-system-design.md),
[`docs/specs/0002-portfolio-pulse-ui-spec.md`](specs/0002-portfolio-pulse-ui-spec.md), `tokens.json`.

---

## 1. The decision this pass exists to record

The product displays gain and loss on every screen. Two things had to be settled before any pixel
could be drawn, because both are load-bearing on correctness rather than on style:

1. **Which hue means "up"** — settled by the user (Q4 in spec v3): **Korean convention app-wide,
   `up = red`, `down = blue`**, for KRX *and* US holdings alike. No per-market switching.
2. **Whether up/down may reuse the existing `success`/`danger` tokens** — settled here: **no.**

### Why gain/loss are separate tokens from success/danger

`--color-success` / `--color-danger` and `--color-value-up` / `--color-value-down` express different
concepts that happen to reach for the same hues, and collapsing them produces contradictions on a
single screen:

- A "거래가 저장되었습니다" toast is a **success** — green, positive, an outcome of the user's action.
- A holding up 3.2% is **value-up** — red under the Korean convention, and it is neither good nor bad;
  it is a direction. The app does not give investment advice (spec § Computational Integrity), so it
  must not encode "up" as "good".
- A failed sell validation is **danger** — red, and it would sit adjacent to a red gain badge. Two
  reds, two unrelated meanings, one screen.

So `tokens.json`'s semantic layer names these tokens for **meaning, not hue** — `value-up` /
`value-down`, exactly as spec § Accessibility requires — and points them at their own primitive
families (`crimson` / `cobalt`) rather than at `red-500` / `blue-500`. If the convention is ever
reversed, one semantic line changes and no component changes.

### Why the colour is never load-bearing

Under a single app-wide convention, a US-market user reading red as "down" would misread every
figure — so colour carries no unique information anywhere. Every P/L figure renders as
**sign + arrow + colour + accessible name**:

```html
<span class="pl pl--up">
  <span aria-hidden="true">▲</span>+1,240,000원
  <span class="sr-only">상승</span>
</span>
```

Removing the colour leaves `▲ +1,240,000원 상승`, which is complete. That is what makes the
single-convention choice safe (WCAG 1.4.1), and it is equally what makes it survive a red-green or
blue-yellow colour-vision deficiency, a greyscale print, and a screen reader.

---

## 2. `design_decisions` record

```yaml
design_decisions:
  philosophy:
    - principle: "Figures are the interface; chrome recedes."
      rationale: >
        Every screen's job is a number the user will act on. Density, tabular alignment and
        restrained colour serve legibility of figures; decoration competes with them.
    - principle: "Colour reinforces, never informs."
      rationale: >
        Spec § Accessibility makes gain/loss-by-colour-alone non-negotiable. Treating colour as
        redundant everywhere (not just on P/L) keeps the rule from eroding screen by screen.
    - principle: "Uncertainty is shown, not smoothed."
      rationale: >
        The broker export carries no share count, so some quantities are back-derived, and a failed
        provider leaves stale prices. Spec § Computational Integrity forbids presenting a derived or
        stale figure with the authority of a reported one, so `estimated` and `stale` are first-class
        visual states with their own tokens — not opacity or italics.
  color:
    selected: >
      3-layer token set (Primitive → Semantic ← [data-theme]). Directional finance colour is carried
      by meaning-named semantic roles --color-value-up / --color-value-down / --color-value-flat,
      each with fg/bg/border, backed by dedicated crimson / cobalt primitive families that are
      distinct from the generic red (danger) and blue (primary) families.
    rationale: >
      Korean market convention, confirmed by the user (spec Q4): up = red, down = blue, applied
      app-wide to KRX and US holdings so one colour never means two things on one screen. Named for
      meaning so the convention lives in exactly one place. Kept separate from success/danger so a
      confirmation toast and a rising-price badge cannot collide. Verified AA against the light
      surface: value-up #c8102e 5.9:1, value-down #0b4fcf 6.9:1, stale/estimated #546376 6.1:1;
      dark theme value-up #ff6b6b 6.4:1, value-down #6fa8ff 7.4:1 on #111827.
  typography:
    body:    { selected: "system-ui / Pretendard-class Korean sans (deferred — see § Deferred)", rationale: "Briefing is long-form Korean prose; body face must be Hangul-optimized at 0.875–1rem. Alpha uses the platform Korean UI stack to avoid shipping a webfont decision before the direction is approved." }
    heading: { selected: "Same family, heavier weight", rationale: "A dense figures-first UI does not need a second face; weight and size carry hierarchy at lower cost than a display font." }
    numeric: { selected: "Body family with font-variant-numeric: tabular-nums", rationale: "MANDATORY — figures are domain-critical and appear in aligned columns (holdings grid, transaction log). Proportional digits make columns of money unreadable." }
  spacing:   { scale: "4px base — xs .25 / sm .5 / md 1 / lg 1.5 / xl 2rem (unchanged from template)", rationale: "Already a consistent 4px grid; changing it buys nothing for the alpha and would churn every future component." }
  radius:    { scale: "4 / 8 / 16px (unchanged)", rationale: "Dense data UI; small radii on rows and badges, 16px reserved for cards so the card boundary reads without a heavy border." }
  motion:    { policy: "150/250/400ms; prefers-reduced-motion collapses all durations to 0ms (emitted automatically by compile-tokens.ts v1.2.0)", rationale: "Spec § Accessibility requires reduced-motion for sparklines and transitions; the compiler already guarantees it, so no component may opt out." }
  iconography: { library: "DEFERRED — alpha uses inline glyph/SVG triangles for direction only", rationale: "Direction arrows are required by the accessibility rule and cannot wait; a full library choice (size/stroke defaults, aria-label policy) is not on the critical path for approving a visual direction." }
```

---

## 3. Token changes made in this pass

Semantic layer only; the primitive layer gained three new colour families because the existing ones
could not express the decision above without collision.

| Added | Layer | Purpose |
|-------|-------|---------|
| `crimson.{50,200,300,600,700,800,900}` | primitive | Backs `value-up`. Distinct from `red.*` (danger). |
| `cobalt.{50,200,300,600,700,800,900}` | primitive | Backs `value-down`. Distinct from `blue.*` (primary). |
| `slate.{50,200,300,600,700,800,900}` | primitive | Backs `stale` / `estimated` / `value-flat` / muted text. |
| `neutral.{100,200,800}` | primitive | Surface / border steps the template lacked. |
| `--color-value-up`, `-bg`, `-border` | semantic | Gain. Sign + arrow always accompany. |
| `--color-value-down`, `-bg`, `-border` | semantic | Loss. |
| `--color-value-flat`, `-bg`, `-border` | semantic | Exactly 0.00% — neither direction. |
| `--color-stale`, `-bg`, `-border` | semantic | `degraded_sources`: price is stale because a provider failed. Distinct from `warning` (an amber advisory) and from `danger` (an error). |
| `--color-estimated`, `-bg`, `-border` | semantic | `quantity_basis = 'estimated'` — a back-derived share count. |
| `--color-surface`, `-sunken`, `--color-border`, `--color-text-muted` | semantic | Needed by cards/rows; previously absent. |

All of the above are also defined in `themes.dark` and `themes.high-contrast`, so the
`[data-theme]` contract holds — the file already supported the pattern, so no follow-up is owed
here. `stale` and `estimated` currently share the slate ramp; they are separate tokens precisely so
they can diverge after the direction is approved without touching components.

---

## 4. Deferred

Not blocking the visual alpha; revisit once the user approves the direction.

- **Korean webfont decision** (Pretendard vs. platform stack) — needs a self-hosting/licensing call.
- **Icon library** — one library, fixed size/stroke, `aria-label` policy for icon-only controls.
- **Full component sheet** — component-token layer (`--button-primary-bg` etc.) is entirely unwritten.
- **`stale` vs. `estimated` visual differentiation** — same ramp today.
- **Dark-theme visual QA** — token values are AA-verified by calculation, not yet eyeballed in situ.
- **`/upload` and `/settings` screens** — not designed in this pass (see UI spec Open Questions).
- **Elevation/shadow review for dark surfaces** — inherited from the template unchanged.

---

*Last updated: 2026-09-08 — alpha token pass (design-lead).*
