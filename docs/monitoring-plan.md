# Operational monitoring follow-up

> **Closed on 2026-10-01:** the PoC has concluded. The service is stopped and
> its UptimeRobot monitor is paused. The pending work below is historical and
> is no longer active. See the [closure record](service-pause.md).

Status: external monitor and Discord integration configured by the user;
monitor-specific alert routing and down/recovery delivery remain unverified.
Updated 2026-09-11. Discord replaces the earlier email alert choice;
the user confirmed email notifications are disabled.

## Confirmed setup

User-provided screenshots show an HTTP monitor named
`portfolio-pulse.duckdns.org` in the Up state, `Discord integration #1` marked
Active, and an UptimeRobot message in Discord confirming the alert contact was
added successfully. This confirms channel connectivity, not a down/recovery test.
The screenshots do not expose the full monitored URL, polling interval, or the
monitor's selected notification integrations. Do not store the webhook URL here.

## Existing behavior

`src/app/api/health/route.ts` reads job records and provider metadata from the
database. It returns HTTP 200 when those queries succeed, even when a job failed.
Its `lastOk` is `bool_or(ok)` over provider history: one historical success can
mask subsequent failures. It is not the status of the latest call. The cron
script invokes the job but has no alert delivery mechanism.

## Minimum scope

1. An external check must detect HTTPS/DNS/VM/application unavailability; a
   process on the same VM cannot reliably report that VM going offline.
2. Health evaluation must distinguish failed jobs, overdue briefings, and stuck
   running jobs. Use the persisted briefing generation time as evidence of
   output freshness, not merely a recent cron invocation. Account for Seoul
   dates and the actual production cron schedule before selecting deadlines.
3. Provider health must report the latest call status and last successful call
   time separately. Partial provider failure is a degraded state, not necessarily
   an application outage. Existing cache behavior must inform freshness limits.
4. Deliver an alert on a confirmed failure and on recovery. Deduplicate unchanged
   failures. Do not send holdings, financial amounts, raw provider errors, or
   credentials to the alert destination.

## Pending decisions and acceptance

- Confirm the monitor targets `https://portfolio-pulse.duckdns.org/api/health`,
  uses the intended five-minute interval, and has `Discord integration #1`
  selected for down/recovery notifications.
- Confirm production scheduling and agree on freshness/grace periods; the cron
  script's example is not evidence of the installed crontab.
- Verify HTTP failure, database failure, stale briefing, stuck job, latest provider
  failure after an earlier success, and recovery with controlled fixtures.
- Verify down/recovery delivery safely with a separate test monitor or a supported
  service test; do not interrupt production merely to test notifications. The
  contact-added message has already arrived, but no incident/recovery alert is
  evidenced yet. No Codex recurring automation was created.
