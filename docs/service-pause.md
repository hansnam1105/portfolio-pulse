# Project closed — PoC concluded

The user closed the project and concluded the PoC on 2026-10-01 (Asia/Seoul).
Active development and service operation have ended. Code and data are retained.

- Oracle host: `ubuntu@161.33.134.14`.
- PM2 app `portfolio-pulse` stopped and its stopped state saved.
- `pm2-ubuntu.service` and `nginx.service` stopped and disabled at boot.
- The daily briefing entry in the Ubuntu user's crontab is commented out.
- Verified both units inactive/disabled, no listeners on 80/443/3000, no app or
  briefing processes, and external HTTPS connection failure.
- Application files and `.env` remain on the VM. Neon database was not modified
  or deleted. The VM itself remains running; cloud resources and subscriptions
  were not terminated.
- Pre-pause configuration backup (not a database backup):
  `/home/ubuntu/portfolio-pulse-pause-20261001T130544Z/`.
- UptimeRobot monitor `803961780` (`portfolio-pulse.duckdns.org`) paused after
  explicit user approval. Verified the dashboard shows `HTTP Paused` and
  `0 Down / 0 Up / 1 Paused`; monitoring and its outage alerts are suspended.

## Historical recovery procedure (only if the project is reopened)

SSH to the host using the existing `oracle_portfolio_pulse` key, then:

```sh
export PATH=/home/ubuntu/.bun/bin:$PATH
sudo systemctl enable --now pm2-ubuntu.service
pm2 restart portfolio-pulse
pm2 save
sudo nginx -t && sudo systemctl enable --now nginx.service
curl -fsS https://portfolio-pulse.duckdns.org/api/health
```

Check certificate validity and renew with Certbot if necessary. HTTP certificate
renewal may fail while Nginx is stopped. After confirming application health,
uncomment only the paused daily briefing line with `crontab -e`; avoid replacing
the entire crontab if other jobs have since changed. Resume the UptimeRobot
monitor if it was paused. Confirm the next scheduled briefing succeeds.
