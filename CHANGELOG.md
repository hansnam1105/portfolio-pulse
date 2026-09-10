# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Initial implementation of Portfolio Pulse: schema, server-side provider
  gateway, transaction import parser, and daily-briefing generation backend.
- Five app screens: Today's Briefing, Portfolio, Holding detail,
  Transactions, and Upload.
- Test suite covering unit, integration, and end-to-end scenarios.
- Google OAuth sign-in restricted to a single allowlisted account (ADR-0005),
  with a sign-out control in the tab bar and route protection via
  `middleware.ts`.
- Value-history charts: a per-holding change-rate sparkline on the Portfolio
  screen and a total portfolio value chart on the Briefing screen, both over a
  3-month window. Series are a constant-quantity backcast and are labelled as
  such on screen.
- A "hide amounts" toggle in the tab bar: currency figures blur while every
  percentage stays readable, persisted across sessions and applied before
  first paint so balances never flash on load.
- `scripts/backfill-prices.ts` — re-runnable historical price/FX backfill from
  KRX, Yahoo and ECOS, so the charts have history from day one (ADR-0007).
- US holdings now also get Korean-language news from Naver. Finnhub's
  company-news endpoint covers companies but not ETFs, which is why `SCHD` and
  `DIVB` previously had no news at all.

### Changed

- Migrated hosting from Vercel to a self-managed Oracle Cloud Always Free VM
  (Nginx + Let's Encrypt + PM2 + system cron), replacing `vercel.json`
  (ADR-0006).
- Naver news search migrated to NAVER API HUB (new host, path, and auth
  header names); FMP moved off its retired `/api/v3/` endpoints to
  `/stable/profile`.

### Fixed

- A blank price field from KRX (a security that didn't trade that session)
  threw `[DecimalError] Invalid argument` and aborted the whole daily job;
  such a row is now reported as "no data" for that security alone.
- ECOS base rate and USD/KRW lookups no longer request the current,
  not-yet-published month/day — they fall back to the most recently
  published period, matching the same fix already applied to KRX.
- The daily briefing reported every holding's value and P/L as
  "unavailable": the job loaded prices only when a `portfolio_snapshot`
  existed, so a portfolio built entirely from manual transactions never got
  a `latestClose`.
- Briefing text now renders its markdown (bold, bullet lists) instead of
  showing `**literal asterisks**`.
- CPI is now fetched from ECOS (901Y009) instead of always reaching the
  briefing prompt as "unavailable".

### Fixed

- Security dependency updates across the project.
