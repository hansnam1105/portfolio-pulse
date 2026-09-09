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

### Fixed

- Security dependency updates across the project.
