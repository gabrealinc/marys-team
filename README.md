# Mary’s Team

A shared caregiving schedule with private family planning and account-free help requests.

## Development and checks

```sh
npm ci
npm run dev
npm test
npm run build
```

The regression suites use isolated PostgreSQL (PGlite) and a simulated DOM. They never use the live database or send real email. `npm test` checks public/private boundaries, linked contacts, food booking races, routine copying, and email retries and status reporting.

## Database changes

Production builds run `scripts/migrate.ts` before compilation. Migrations are versioned in `app_migrations` and rerunnable after interruption. They create and backfill schema once; request handlers never run schema setup or global directory reconciliation. Add a new migration version whenever schema changes.

Local builds skip production migrations. To migrate a dedicated development database, set `RUN_MIGRATIONS=1` and its `DATABASE_URL` before running `npm run migrate`. Do not point development tests or preview setup at production.

Person links and food reservations are maintained by row-level database triggers on writes. Public data is projected through the allowlist in `lib/public-schedule.ts`. Shared GET responses cover a bounded date window; private contact details, family presence, routines, and email status are organizer-only.

## Email processing

`email_outbox` keeps a separate job per notification and recipient. An immediate attempt follows enqueueing; failures retry with backoff, stopping for organizer attention after six attempts. A leased worker prevents concurrent sends of the same job. Pending confirmations replaced by later changes/cancellations are superseded. Delivery polling reports HighLevel delivery or bounce statuses when the provider exposes them; SMTP acceptance alone does not prove delivery.

Vercel invokes `/api/notifications` every 15 minutes. Production requires a server-only `CRON_SECRET`; Vercel supplies it as a bearer authorization header. This secret is not stored in the repository. `DATABASE_URL`, existing notification recipients, and the existing GHL or SMTP credentials are also required. The family schedule shows failed and delayed emails and offers manual retry. Never manually retry a bounced address until it has been checked.

Mail is at-least-once: a provider accepting a message immediately before a worker crash can still produce a duplicate on retry. Delivery depends on provider permissions and reporting; “sent” and “delivered” are deliberately separate labels.

## Weekly routines

Family organizers select specific items from a source week and save a reusable routine. They preview a future Monday-starting week before applying it. Food reservations, assigned helpers, and group events are excluded. Existing copies and time conflicts are skipped; applying a routine twice does not duplicate its items. Nurse hours continue from People.
