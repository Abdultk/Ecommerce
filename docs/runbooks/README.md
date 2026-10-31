# Runbooks

Operational procedures for Hearth & Pan. Production: API + worker + Postgres + Key Value on Render (`render.yaml`), storefront and admin on Vercel, Cloudflare in front, Stripe, Resend (SMTP), R2.

| Page                                           | Use it when                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| [Incident response](incident-response.md)      | Anything customer-facing is broken. Start here.                    |
| [On-call contacts](on-call.md)                 | You need to page someone or reach a vendor.                        |
| [Monitoring and alerts](monitoring.md)         | An alert fired; or you are changing alerting.                      |
| [Deploy and rollback](deploy-rollback.md)      | Shipping, or undoing a bad release.                                |
| [Backup and restore](backup-restore.md)        | Data loss/corruption, restore drills, RTO/RPO.                     |
| [Rotating secrets](secrets-rotation.md)        | Scheduled rotation or a suspected leak.                            |
| [Stripe webhooks](stripe-webhooks.md)          | Orders stuck in `PENDING_PAYMENT` after payment; webhook failures. |
| [Stuck reservations](stuck-reservations.md)    | Stock shows reserved but no live checkout holds it.                |
| [Edge security (Cloudflare)](edge-security.md) | Changing TLS, WAF, rate-limit or header settings.                  |

## Conventions

- Severity: **SEV1** checkout/payments down or data loss; **SEV2** degraded (slow, partial feature loss, emails delayed); **SEV3** internal/admin-only or cosmetic.
- Never paste secrets, card data or customer PII into tickets, chat or these docs.
- Every manual production change (SQL, secret, config) gets a line in the incident or change log: who, when, what, why.
- Never run `prisma migrate reset` or `prisma migrate dev` against any shared environment.
