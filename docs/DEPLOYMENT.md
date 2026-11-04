# Deployment

Status: **Phase 0 plan** — fleshed out in Phase 1 (local) and Phase 11 (production).

## Local development (Phase 1)
- `docker compose up -d` → `mysql:8.4`, `redis:7.4`, `mailpit` (SMTP catcher). File storage uses an AWS S3 dev bucket (configured in Phase 4/6).
- `pnpm install && pnpm db:migrate && pnpm db:seed && pnpm dev` (api :4000, worker, web :5173).
- Wildcard local hosts: `*.lvh.me` resolves to 127.0.0.1, so `academy1.lvh.me:5173` exercises tenant resolution without editing `/etc/hosts`.
- Cloud/CI session without Docker: MySQL 8.0 via apt + local Redis.

## Production target (AWS, Ubuntu 24.04)
| Component | Service |
|---|---|
| Edge / TLS | Nginx on EC2 (or ALB → Nginx) with wildcard cert `*.platform.com` + automated per-domain certs for custom domains (D-8) |
| SPA | Built static assets on S3 + CloudFront (or served by Nginx) |
| API | EC2 Auto Scaling group / ECS, Node 22, PM2 cluster mode (`infra/pm2/ecosystem.config.js`) or container |
| Worker | Separate instances/containers, PM2 fork mode |
| DB | Amazon RDS for MySQL 8.4, Multi-AZ, automated backups (PITR 7–35 days), read replica for analytics |
| Cache/queue | ElastiCache Redis (cluster mode disabled for BullMQ), AOF |
| Storage | S3 private + public buckets, CloudFront OAC, lifecycle rules |
| Email/SMS | SES; MSG91/Twilio; WhatsApp Cloud API |
| Secrets | AWS Secrets Manager / SSM Parameter Store |
| Monitoring | CloudWatch logs/metrics/alarms, Sentry, uptime checks |

## Release process
CI (GitHub Actions): lint → unit → integration (MySQL+Redis services) → build → e2e (Playwright) → image push → `prisma migrate deploy` (expand/contract migrations only) → rolling deploy → smoke test → automatic rollback on failed health checks.

## Backup & recovery
RDS snapshots + PITR, S3 versioning on private bucket, quarterly restore drill documented with RTO 4 h / RPO 15 min targets.
