# Running and troubleshooting

## Before the interview

Install Node 22.13+, clone the repository, and run `npm ci`. Run `npm run check`, `npm run build`, and `npm start`. Open localhost:3000 and complete the in-app walkthrough. Keep the terminal running during the demo.

The default local mode needs no environment variables and makes no carrier calls. Dependencies must be installed first. Avoid running development and production servers against the same embedded data directory simultaneously.

## Database modes

Default: embedded PostgreSQL persisted at `.data/routing`. Change `PGLITE_DATA_DIR` to use another directory. Stop all processes using a directory before moving or resetting it.

Server: set `DATABASE_URL` to PostgreSQL. For local development, `docker compose up -d` starts PostgreSQL 17. Put the URL in `.env.local` for Next.js; pass it explicitly for CLI test/reset scripts. Follow your hosted database provider's TLS requirements and do not disable certificate verification to fix a connection issue.

## Reset

The UI reset affects only the current browser session. To delete every session, stop the app and run:

```bash
CONFIRM_RESET=yes npm run db:reset
```

For PostgreSQL, also pass `DATABASE_URL`. This action deletes fictional demo data, including orders, reservations, and audit entries. It is not needed for normal startup.

## Symptoms

| Symptom                                    | Check                                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| Command not found or unsupported Node      | Run `node --version`; use Node 22.13+                                               |
| Port 3000 already in use                   | Stop the other app or use `npm run dev -- --port 3001`                              |
| Database files locked or corrupt           | Stop duplicate processes; use a fresh PGLITE_DATA_DIR for a fresh demo              |
| Workspace looks unchanged after a mutation | Read the notification, then refresh; errors do not mean an allocation succeeded     |
| One order remains in review                | This is expected for insufficient stock and the quote-outage fixture                |
| GraphQL requests see different orders      | Preserve the same session cookie                                                    |
| Missing module after pulling updates       | Run `npm ci` again                                                                  |
| Production server serves old UI            | Stop it, run `npm run build`, then restart                                          |
| Hosted app cannot write embedded data      | Use an external PostgreSQL URL; embedded disk mode needs a persistent writable disk |

## Hosting boundary

The repository is ready for local demonstration. It is not automatically published to a live host. For a persistent Node host, use `npm ci`, `npm run build`, and `npm start` with a persistent embedded directory or an external PostgreSQL database.

Serverless platforms need external PostgreSQL; an ephemeral or read-only function filesystem cannot serve as the durable embedded database. Do not set PGLITE_DATA_DIR as a substitute for a real persistent volume. Add resource limits before exposing anonymous demo-session creation to the public.

## Checks

`/api/health` verifies database access. It is a readiness check, not an authentication check. CI runs tests, formatting, TypeScript, a production build, a PostgreSQL test using separate pools, and desktop/mobile browser workflows. Test screenshots and failure traces are retained for seven days.
