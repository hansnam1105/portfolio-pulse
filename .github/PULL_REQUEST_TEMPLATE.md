## Summary

<!-- What does this PR do, and why? Link an ADR under docs/adr/ if this is an
     architectural decision, or the relevant spec section under docs/specs/. -->

## Type of change

- [ ] Bug fix
- [ ] New feature / screen
- [ ] Architecture / infra change (new or updated ADR included)
- [ ] Docs only
- [ ] Dependency / chore

## Checklist

- [ ] `bun run test:app` passes locally
- [ ] `bun run build` succeeds
- [ ] `CHANGELOG.md` updated under `[Unreleased]`
- [ ] No secret, API key, or `.env` value committed (check `git diff` — only `.env.sample` should ever change, never `.env`)
- [ ] Money/quantity values use `src/lib/money.ts` (`Decimal`), never native `number` arithmetic
- [ ] If the data model changed: a Drizzle migration is included (`bun run db:generate`) and applied (`bun run db:migrate`)
- [ ] If this touches a screen: checked against `docs/specs/0002-portfolio-pulse-ui-spec.md` (WCAG 2.1 AA — labels, focus order, touch targets, no color-only signal)

## Screenshots

<!-- For any visual change, before/after. Delete this section if not applicable. -->

## Related

<!-- Closes #issue, or links to a spec/ADR -->
