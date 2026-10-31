# On-call contacts

> Placeholder. Fill in before launch (Phase 4). Keep phone numbers in the paging tool, not in git.

| Role                                            | Name                             | Primary contact                                                | Hours                                    |
| ----------------------------------------------- | -------------------------------- | -------------------------------------------------------------- | ---------------------------------------- |
| Primary on-call (engineering)                   | _TBD_                            | Better Stack on-call schedule `hp-primary`                     | 24/7 rotation, weekly handover Mon 10:00 |
| Secondary on-call                               | _TBD_                            | Better Stack schedule `hp-secondary` (escalation after 15 min) | 24/7                                     |
| Incident commander / eng lead                   | _TBD_                            | Slack `@…`                                                     | Business hours + SEV1                    |
| Business owner (customer comms, refunds policy) | _TBD_                            | Slack `@…`                                                     | Business hours + SEV1                    |
| Finance (disputes, payouts)                     | _TBD_                            | email                                                          | Business hours                           |
| Support inbox                                   | support@hearthandpan.com (_TBD_) | —                                                              | Business hours                           |

## Channels

- `#hp-alerts`: automated notifications (SEV2/SEV3)
- `#hp-incidents`: incident coordination; one channel per SEV1/SEV2

## Vendors

| Vendor                | Use for                          | How                                       |
| --------------------- | -------------------------------- | ----------------------------------------- |
| Render                | API, worker, Postgres, Key Value | Dashboard → Support; status.render.com    |
| Vercel                | Storefront, admin                | Dashboard → Help; vercel-status.com       |
| Cloudflare            | DNS, TLS, WAF, R2                | Dashboard → Support; cloudflarestatus.com |
| Stripe                | Payments, webhooks, disputes     | Dashboard → Support; status.stripe.com    |
| Resend                | Transactional email              | resend.com/support; status page           |
| Sentry / Better Stack | Monitoring                       | Vendor support portals                    |

Account owners and 2FA recovery codes are held by the business owner in the company password manager, never in this repo.
