#!/usr/bin/env bash
# Cron entry point for the daily briefing job (ADR-0006), replacing Vercel's
# vercel.json cron. Installed via crontab as:
#   CRON_TZ=Asia/Seoul
#   0 7,9,11,13,15,19,21,23,1 * * * /path/to/portfolio-pulse/scripts/run-daily-briefing.sh
set -euo pipefail
cd "$(dirname "$0")/.."
set -a
source .env
set +a
curl -fsS -X POST -H "Authorization: Bearer ${CRON_SECRET}" https://portfolio-pulse.duckdns.org/api/jobs/daily-briefing
