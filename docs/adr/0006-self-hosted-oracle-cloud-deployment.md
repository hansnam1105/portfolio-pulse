# ADR-0006: Move hosting from Vercel to a self-managed Oracle Cloud VM

- **Status**: Accepted
- **Date**: 2026-09-08
- **Deciders**: user (approved this session)
- **Related**: [ADR-0001](0001-tech-stack-nextjs-vercel-postgres.md),
  [ADR-0005](0005-google-oauth-single-user-access.md)

---

## Context

ADR-0001 chose Vercel Hobby explicitly to avoid self-hosting, and named the reason directly: "Any
choice that makes the sole user responsible for patching a server, renewing a certificate, or
babysitting a container is expensive in the currency that actually matters here." That reasoning
hasn't changed — self-hosting is genuinely more ops burden. What changed is the user's stated goal:
after switching work computers, they want a server they personally control, reachable from their
phone, on Oracle Cloud's Always Free tier. This is a deliberate, informed reversal of ADR-0001's
hosting line only — not a re-litigation of its language/framework/database choices (Next.js, Drizzle,
Neon Postgres are unaffected and stay exactly as decided there).

## Decision

Host on a single Oracle Cloud **Always Free** VM instead of Vercel.

| Layer | ADR-0001 (Vercel) | This ADR (Oracle Cloud) |
|-------|--------------------|--------------------------|
| Compute | Vercel serverless functions | `portfolio-pulse-vm` — Ubuntu 24.04, `VM.Standard.E2.1.Micro` (1 OCPU / 1GB RAM + 4GB swap file) |
| Process manager | N/A (managed) | PM2 running `bun run start`, `pm2 startup` for boot persistence |
| TLS / reverse proxy | Managed by Vercel | Nginx + Let's Encrypt (`certbot --nginx`, auto-renewing) |
| Domain | `*.vercel.app` | `portfolio-pulse.duckdns.org` (free DuckDNS subdomain — no domain was purchased) |
| Scheduling | Vercel Cron (`vercel.json`) | System `crontab` (`CRON_TZ=UTC`) curling the same bearer-token-guarded endpoint |
| Database | Neon Postgres | **Unchanged** — still Neon, accessed the same way; hosting and database are independent choices |

Notable execution details, in case the VM is rebuilt from scratch later:

- **Shape fallback**: `VM.Standard.A1.Flex` (Ampere, the larger Always-Free shape) hit "out of host
  capacity" in this account's availability domain — a known, common Oracle Free Tier issue, not
  specific to this app. Fell back to the always-available `E2.1.Micro`, which is why RAM is only
  1GB (+4GB swap added explicitly to survive `bun install`/`next build`).
- **The VCN wizard's networking widget silently failed to attach a public IP** during instance
  creation in this account — worked around by creating the VCN separately via "Start VCN Wizard →
  Create VCN with Internet Connectivity" first, then pointing the instance at the existing VCN/subnet.
- **A VCN created via the wizard did not include an Internet Gateway or a default route** in this
  account — both had to be created manually (Internet Gateway + a `0.0.0.0/0` route rule) before the
  public IP was actually reachable. Oracle's Security List rules (22/80/443 ingress) are necessary but
  not sufficient — the box's own `iptables` (shipped by the Ubuntu cloud image) independently drops
  everything but SSH by default and needed explicit `ACCEPT` rules for 80/443 as well.
- **Nginx needs `proxy_read_timeout`/`proxy_send_timeout` raised to 300s** for this app's server
  block. The daily-briefing job runs synchronously inside its own request and takes ~75s once every
  provider is healthy (each provider call is rate-limited to 1 req/s), which exceeds Nginx's 60s
  default and made the cron caller see a 504 while the job actually completed server-side.

## Consequences

**Positive**

- The user gets what they asked for: a server they control, reachable from their phone, at zero
  recurring cost (Always Free tier + free DuckDNS subdomain + free Let's Encrypt cert).
- Decoupling hosting from the database (Neon stays put) meant this migration touched no data and
  required no export/import.
- The existing bearer-token design for the daily-briefing endpoint (ADR-0003) transferred to a plain
  crontab entry with no code change — exactly the mitigation ADR-0001 had already banked on ("migrating
  the scheduler ... is a configuration change, not a rewrite").

**Negative / risks — the exact costs ADR-0001 was trying to avoid, now accepted deliberately**

- **The user is now responsible for OS patching**, on a box with no managed-update mechanism. Not
  automated as part of this ADR; `sudo apt upgrade` is now a manual, recurring chore.
- **Certificate renewal is automated (`certbot` installs a systemd timer)** but its continued function
  depends on the box staying up and DNS staying correct — a failure mode Vercel made someone else's
  problem.
- **1GB RAM is tight.** A `next build` on-box is survivable only because of the added swap file, and is
  slow. If it ever stops working, the documented fallback is building locally and shipping the built
  artifact to the VM rather than upgrading the instance (Always Free's larger shape is capacity-
  constrained, per the fallback noted above).
- **Single point of failure, unmonitored.** Vercel's platform-level uptime/monitoring is gone; if the
  VM or Nginx or PM2 process dies, nothing currently pages the user. No monitoring was added as part of
  this ADR — flagged as a known gap, not solved here.
- **DuckDNS is a free, best-effort service**, not a purchased domain with an SLA. Acceptable for a
  personal app; would need revisiting for anything less casual.
- **The OCI public IP is ephemeral by default** — a future stop/start of the instance can change it
  and silently break the DuckDNS mapping. Reserving a static/Reserved IP in the OCI console closes this
  gap and is recommended as a near-term follow-up, not yet done as of this ADR.

## Platform Impact

| Platform | Impact | Files Affected |
|----------|--------|----------------|
| Claude Code | **No governance change.** A hosting/infrastructure decision; no hook, command, agent, or dispatch rule changes. | `vercel.json` (removed), `README.md`, `README_ko.md` |
| Antigravity (GEMINI.md) | **None — justified.** Same reasoning as ADR-0001: hosting facts live in this platform-neutral ADR and the README, not in AI-tooling governance. | N/A |
| templates/common | **None** — leaf project, no propagation path. | N/A |

## Accessibility Impact

**None.** This ADR changes where the app's process runs and how it's reached over the network; it
changes no markup, styling, or interaction pattern. Accessibility requirements remain as specified in
spec 0001 § Accessibility and ADR-0005 (for the new sign-in surface).
