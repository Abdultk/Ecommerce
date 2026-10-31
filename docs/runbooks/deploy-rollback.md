# Deploy and rollback

## Pipeline

1. PR → CI (`.github/workflows/ci.yml`): format, lint, typecheck, unit + coverage, build, `pnpm audit`, gitleaks, dependency review, API integration tests, E2E. Vercel builds preview deployments for `hp-web` and `hp-admin` on every PR.
2. Merge to `main` → CI again → staging deploy (Render deploy hooks for staging `hp-api`/`hp-worker`; Vercel staging/preview). `render.yaml` sets `autoDeploy: false`, so Render only deploys when triggered.
3. Production: promote after staging is green (planned `deploy.yml` with a GitHub `production` environment requiring approval: trigger Render deploy hooks, wait for `/api/v1/health`, `vercel deploy --prod` for both apps, then `infra/scripts/smoke.sh`). Until `deploy.yml` exists, do these steps by hand from the dashboards.

Render runs `prisma migrate deploy` as `preDeployCommand`; if it fails the deploy stops and the old version keeps serving.

## Release checklist

- [ ] CI green on the exact commit; staging smoke-tested (checkout in Stripe test mode).
- [ ] Migrations are additive (expand → migrate data → contract). No column dropped in the release that stops using it.
- [ ] New env vars added to Render env groups / Vercel **before** deploying code that requires them (env validation fails fast at boot).
- [ ] Deploy API + worker first, then frontends (frontends must tolerate the old API for a few minutes).
- [ ] Watch for 15 min: Sentry new issues, Render 5xx/latency, a real (or test) order, B1/B2 alerts.

## Rollback

Decide quickly: if a SEV1 started with a release, roll back first and investigate after.

| Component            | How                                                                                                                                                                                       | Time    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Storefront / admin   | Vercel → project → Deployments → previous production deployment → **Promote** (instant, no rebuild)                                                                                       | < 1 min |
| API                  | Render → `hp-api` → Events → previous successful deploy → **Rollback**                                                                                                                    | 2–5 min |
| Worker               | Same on `hp-worker` (roll back together with the API when they share code changes)                                                                                                        | 2–5 min |
| Database             | Never roll back migrations by hand. Because migrations are additive, the previous build runs on the new schema. If data was corrupted, use [backup-restore.md](backup-restore.md) (PITR). | —       |
| Config/secret change | Restore the previous value in the env group, then redeploy/restart                                                                                                                        | 2–5 min |
| Edge rule            | Cloudflare → Security → WAF/Rules → disable the new rule                                                                                                                                  | < 1 min |

A rollback with Render's auto-deploy disabled stays in place until the next deploy hook; fix forward through the normal pipeline. After any rollback: post in `#hp-incidents`, open an incident doc if customers were affected ([incident-response.md](incident-response.md)).

## Data-changing operations

One-off production scripts or SQL require a second engineer, a backup checkpoint (note the time for PITR), and an audit line in the change log. Run them from the Render shell of `hp-api`, never from a laptop with the production `DATABASE_URL`.
