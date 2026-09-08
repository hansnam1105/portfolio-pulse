[한국어](README_ko.md)

# Portfolio Pulse

A personal, single-user, mobile-optimized web app for tracking a combined
Korean (KRX) and US stock portfolio, with a daily Gemini-generated news
briefing summarizing what moved your holdings overnight. Built for
personal and educational use — not a commercial product, and not
investment advice.

## Screens

- **Today's Briefing** (`/`) — daily portfolio snapshot (value vs. cost
  basis) plus an AI-generated summary of relevant news for your holdings.
- **Portfolio** (`/portfolio`) — full holdings list with weights and P/L.
- **Holding detail** (`/holdings/[securityId]`) — per-security position,
  transaction history, and news.
- **Transactions** (`/transactions`) — buy/sell/adjustment ledger with
  manual entry and edit support.
- **Upload** (`/upload`) — import a Samsung Securities export (`.xlsx`) to
  bulk-load transactions.

## Tech stack

- [Next.js 15](https://nextjs.org/) (App Router) + TypeScript
- [Neon](https://neon.tech/) serverless Postgres via [Drizzle ORM](https://orm.drizzle.team/)
- [Zod](https://zod.dev/) for runtime validation at API/data boundaries
- Deployed on [Vercel](https://vercel.com/) (Hobby tier)

See [`docs/adr/0001-tech-stack-nextjs-vercel-postgres.md`](docs/adr/0001-tech-stack-nextjs-vercel-postgres.md)
for the reasoning behind these choices, and [`docs/adr/`](docs/adr/) for the
rest of the architecture decision record.

## Data sources

All external data is fetched server-side through a single provider gateway
(see [`docs/adr/0002-server-side-provider-gateway.md`](docs/adr/0002-server-side-provider-gateway.md)):

- **KRX Open API** — Korean market/exchange data
- **DART OpenAPI** — Korean corporate disclosures
- **Bank of Korea ECOS** — Korean macroeconomic indicators
- **Finnhub** — US market data and news
- **FMP (Financial Modeling Prep)** — US company fundamentals
- **Naver Search API** — Korean news search
- **Gemini API** — news analysis and daily briefing generation
- **Manual Samsung Securities export upload** (`.xlsx`) — the only supported
  way to bulk-import transaction history; there is no live brokerage
  integration

## Setup

```bash
bun install
cp .env.sample .env   # fill in DATABASE_URL and the API keys listed below
bun run db:generate
bun run db:migrate
bun run dev
```

You'll need your own Neon (or other Postgres-compatible) database and your
own API keys for: KRX, DART, ECOS, Finnhub, FMP, Naver Search, and Gemini.
See `.env.sample` for the full list of required and optional variables.

## Tests

```bash
bun run test:app
```

## License

This project is licensed under the [GNU AGPL-3.0](LICENSE).

It was originally scaffolded from the
[ai-workspace-standards](https://github.com/5throck/ai-workspace-standards)
toolkit, which is also licensed under AGPL-3.0. This repository contains
only the application itself — the multi-agent scaffolding used to build it
(agents, skills, automation scripts, session logs) is not included here.

## Disclaimer

This is a personal, educational project. It is not financial or investment
advice, and comes with no warranty of any kind. Use at your own risk.
