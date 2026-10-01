# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [PoC Closure] - 2026-10-01

### Changed

- Closed the project after concluding the proof of concept; active development
  and hosted service operation have ended.
- Stopped the application, web server, scheduled briefings, and automatic
  startup; paused UptimeRobot monitoring and outage alerts.
- Retained source code and existing data. The Oracle VM remains running;
  cloud resources and subscriptions have not been terminated.

## PoC development history

### Added

- Initial implementation of Portfolio Pulse: schema, server-side provider
  gateway, transaction import parser, and daily-briefing generation backend.
- Five app screens: Today's Briefing, Portfolio, Holding detail,
  Transactions, and Upload.
- Test suite covering unit, integration, and end-to-end scenarios.
- Google OAuth sign-in restricted to a single allowlisted account (ADR-0005),
  with a sign-out control in the tab bar and route protection via
  `middleware.ts`.

### Changed

- Migrated hosting from Vercel to a self-managed Oracle Cloud Always Free VM
  (Nginx + Let's Encrypt + PM2 + system cron), replacing `vercel.json`
  (ADR-0006).
- Naver news search migrated to NAVER API HUB (new host, path, and auth
  header names); FMP moved off its retired `/api/v3/` endpoints to
  `/stable/profile`.

### Fixed

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
