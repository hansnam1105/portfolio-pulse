# Architecture Decision Records

Project-level architecture decisions for portfolio-pulse. One decision per file, named
`NNNN-<slug>.md` with a zero-padded sequential number.

## Format

Every ADR uses the 3-section structure plus the two mandatory review sections:

```markdown
# ADR-NNNN: <decision stated as a sentence>

- **Status**: Proposed | Accepted | Superseded by ADR-NNNN
- **Date**: YYYY-MM-DD
- **Deciders**: <agent/person>
- **Related**: <links>

## Context
What forces are in play, what constraints apply, why a decision is needed now.

## Decision
What was decided, in the active voice. Include what was rejected and why.

## Consequences
Positive and negative outcomes, and the risks accepted.

## Platform Impact   (MANDATORY)
| Platform | Impact | Files Affected |
|----------|--------|----------------|
| Claude Code | ... | ... |
| Antigravity (GEMINI.md) | ... — "None" requires explicit written justification | ... |
| templates/common | ... | ... |

## Accessibility Impact   (MANDATORY for anything affecting user-facing interaction)
Target level, affected interaction areas, verification method. A backend-only decision
may state the exemption explicitly instead.
```

## Rules

- **Immutable once accepted.** Reversing a decision means writing a *new* ADR that names its
  predecessor via `Supersedes:`; never edit an accepted record in place.
- Gate-moment rulings (gate approvals, escalations, go/no-go) additionally emit a decision record
  at `docs/decisions/DEC-YYYYMMDD-NN.md` — see the `decision-record` skill.
- English only, UTF-8 without BOM.

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [0001](0001-tech-stack-nextjs-vercel-postgres.md) | Next.js on Vercel with Neon Postgres as the portfolio-pulse stack | Proposed |
| [0002](0002-server-side-provider-gateway.md) | All external data access goes through a single server-only Provider Gateway | Proposed |
| [0003](0003-precomputed-daily-briefing-snapshot.md) | The daily briefing is a precomputed, persisted snapshot, not an on-demand generation | Proposed |
| [0004](0004-manual-holding-adjustments.md) | Manual holding adjustments are an append-only transaction layer over the snapshot, not edits to it | Proposed |
