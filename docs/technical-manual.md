# Fulfillment Routing Engine: technical manual

This manual teaches the **Dispatch** demo from first run to maintenance. Read the [product story](product-story.md) for the problem it illustrates and the [interview walkthrough](INTERVIEW-WALKTHROUGH.md) for a shorter presentation. Source links below are the implementation, not claims about a production deployment.

## 1. Vocabulary and first principles

An **order** is a customer label, a sample destination, and one or more SKU/quantity lines. A **SKU** identifies a product. **On-hand** means physically counted stock in this model; **reserved** means promised to an allocated order. **Available** is `on_hand - reserved`. Allocation reserves stock; it does not purchase a label or ship goods.

A **candidate** describes one warehouse's stock eligibility and quote. A **decision** stores both candidates, selection, reason, timestamp, policy version, and simulated cost advantage. A **transaction** groups writes so all commit or all roll back. **Idempotent** means repeating an operation produces the same durable effect: routing an already allocated order and cancelling an already cancelled order do not change stock again.

The central problem is not calculating the smaller number. It is ensuring two callers cannot both promise the last unit and ensuring a saved explanation describes the allocation actually committed. See [routing.ts](../src/lib/routing.ts) and [database.ts](../src/lib/database.ts).

## 2. Run it, then learn the controls

Use Node 22.13+ (CI uses Node 22), npm, and a writable local directory:

```bash
npm ci
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Open `http://127.0.0.1:3000`. No account or environment file is required. For an interview use `npm run build`, then `npm start -- --hostname 127.0.0.1 --port 3000` to avoid development compilation delays.

The first GraphQL request creates a browser workspace and six orders. Select FR-1042, compare Buffalo and Reno, and route it. Reno receives a six-phone reservation. Open Inventory, return to routing, override to Buffalo with an explanation of at least eight characters, then open Activity. Cancel the order: the active warehouse clears and six phones become available again. The historical decision remains visible in the stored order. Create a new order to see validation and fresh IDs. Reset returns only this cookie's workspace to the starting fixtures.

[seed.ts](../src/lib/seed.ts) deliberately provides six teaching cases:

| Order   | Lesson                      | Result on a fresh workspace                   |
| ------- | --------------------------- | --------------------------------------------- |
| FR-1041 | East-coast price comparison | Buffalo                                       |
| FR-1042 | West-coast price comparison | Reno                                          |
| FR-1043 | Stock outranks closeness    | Buffalo; Reno has zero switches               |
| FR-1044 | Whole-order shortage        | REVIEW; no reservation                        |
| FR-1045 | Incomplete quote evidence   | REVIEW; Reno quote fails                      |
| FR-1046 | Multiple lines              | Two gateways and two phones reserved together |

The UI creates a single line; GraphQL accepts up to ten input lines and combines duplicate SKUs. Queue routing evaluates orders individually, not as a global cost optimization or one transaction for the whole queue.

## 3. Follow one request through the code

| File                                             | What to understand                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| [dashboard.tsx](../src/components/dashboard.tsx) | Client state, selection, views, forms, mutation notifications                 |
| [client.ts](../src/lib/client.ts)                | Fetch wrapper and shared GraphQL selections; checks `errors` even on HTTP 200 |
| [GraphQL route](../src/app/api/graphql/route.ts) | JSON POST, origin and size checks, cookie, Apollo context                     |
| [graphql.ts](../src/lib/graphql.ts)              | Schema, resolver mapping, operation budget, public error codes                |
| [routing.ts](../src/lib/routing.ts)              | Input validation, decisions, transaction orchestration                        |
| [shipping.ts](../src/lib/shipping.ts)            | Quote interface and deterministic distance/weight simulator                   |
| [model.ts](../src/lib/model.ts)                  | Domain types, five products, six destinations, two warehouses                 |
| [database.ts](../src/lib/database.ts)            | PGlite/pg adapters, schema, global connection promise                         |
| [seed.ts](../src/lib/seed.ts)                    | Fictional inventory and orders                                                |
| [health route](../src/app/api/health/route.ts)   | Database readiness with SELECT 1                                              |

`routeOrder` reaches `RoutingService.route`. It reads the order, captures both warehouse quotes concurrently outside the lock, and enters a database transaction. `locked` locks the corresponding `demo_sessions` row with `FOR UPDATE`. The service reloads the order, reads current stock, evaluates with captured quotes, conditionally reserves every line, saves the order, and appends an audit event. Commit makes these writes visible together. The dashboard then reloads the workspace.

The second read matters: an operator may have cancelled the order while a carrier quote was pending. The cancellation wins; stale quote work must not resurrect the order. The cancellation regression test holds quotes behind a promise to reproduce exactly that ordering without sleeps.

## 4. Policy and invariants

Automatic allocation requires one warehouse capable of fulfilling **every** line. It requests valid quotes from every stock-eligible warehouse before claiming the cheapest choice. It ranks by integer cents, then warehouse code for ties. Missing stock produces REVIEW; a quote failure at an eligible warehouse also produces REVIEW. `complete` describes quote coverage of eligible warehouses, so no eligible warehouse can yield `complete: true` while still having no selection. Inspect both selection and reason.

Quotes use great-circle miles and product weight: `round(650 + miles * 0.72 + pounds * 85)` cents. Transit days are bounded synthetic estimates, not an optimization input or delivery promise. `savingsCents` compares eligible quotes at decision time and is zero for overrides; it is not verified business savings.

Maintain these invariants:

1. `0 <= reserved <= on_hand`, also enforced by SQL CHECK constraints.
2. An allocated order owns its complete quantity in one warehouse.
3. Stock, order state, and audit event commit together.
4. Routing/cancellation retries do not reserve/release twice.
5. Failed overrides retain the previous allocation.
6. Every query and mutation uses its workspace ID.
7. The 100-order cap includes cancelled, review, regular, and race orders. A race requires two free slots.

An override counts the order's existing reservation as available to itself. It validates the target and quote before releasing the old reservation, then transfers and records the explanation atomically. A cancelled order is terminal. No reservation expiry or shipped state exists. See the [state diagram and tradeoffs](architecture.md).

## 5. Database and API contracts

[database.ts](../src/lib/database.ts) creates four tables:

| Table         | Key and payload                                            | Integrity                                                |
| ------------- | ---------------------------------------------------------- | -------------------------------------------------------- |
| demo_sessions | text ID, creation timestamp                                | Parent workspace and lock target                         |
| inventory     | `(session_id, warehouse_id, sku)`; on_hand, reserved       | Warehouse enum/checks and nonnegative stock              |
| orders        | `(session_id, id)`; JSONB data                             | Workspace foreign key; domain shape validated in service |
| audit_events  | bigserial ID; session, order ID, action, detail, timestamp | Workspace foreign key; session/ID index                  |

Deleting a session cascades to its data. `order_id` in audit events is descriptive, not an order foreign key. JSONB stores the full snapshot conveniently but SQL does not enforce all order fields or reservation ownership. `migrate` uses `CREATE ... IF NOT EXISTS`: it initializes this schema and does not upgrade arbitrary future schema changes.

The pg adapter uses an eight-connection pool and pins each transaction to one checked-out connection. It rolls back on error and releases the connection in `finally`. PGlite provides embedded PostgreSQL for a single Node process. Sharing a PGlite directory across processes is unsupported. Dashboard reads take the workspace lock for a coherent multi-table snapshot; previews are advisory and may become stale immediately.

GraphQL exposes dashboard, evaluateOrder, products, warehouses, createOrder, routeOrder, overrideOrder, cancelOrder, resetDemo, and runConcurrencyDemo. See [API examples](api.md) for complete operations. Mutation inputs require a 2–80 character trimmed customer, a known destination and SKU, positive integer quantities up to 1,000 per SKU after aggregation, and 1–10 input lines. Overrides require 8–300 characters. Only one top-level mutation field is allowed per request; fragments and batches are unsupported, with a 200-field budget and 16,000-character request limit.

Expected errors have `BAD_USER_INPUT`, `NOT_FOUND`, or `CONFLICT`. GraphQL can return HTTP 200 with an `errors` array; do not infer success from status alone. A shortage is a successful business result with REVIEW. Unexpected resolver failures are logged server-side and masked in the response.

A cookie-preserving request:

```bash
curl -s http://127.0.0.1:3000/api/graphql \
  -H 'Content-Type: application/json' \
  -c /tmp/dispatch-demo.cookies -b /tmp/dispatch-demo.cookies \
  --data '{"query":"mutation { routeOrder(id: \"FR-1042\") { id status warehouseId } }"}'
```

Use a separate cookie file per lab; a new file starts a new fictional workspace. Send reset as a separate operation when a lab needs initial stock.

## 6. Configuration and trust boundary

| Variable        | Example/meaning                                                       |
| --------------- | --------------------------------------------------------------------- |
| DATABASE_URL    | `postgres://USER:PASSWORD@HOST:5432/DATABASE`; omit for embedded mode |
| PGLITE_DATA_DIR | `./.data/routing`; use a distinct writable directory per process      |
| E2E_PORT        | Browser-test HTTP port, default 3000                                  |
| CONFIRM_RESET   | `yes` only for the explicit all-session reset script                  |

Next.js reads `.env.local`; Node CLI tests and reset scripts require variables passed in the shell. [.env.example](../.env.example) and [compose.yaml](../compose.yaml) contain local disposable credentials only. Do not replace them with live secrets. The browser's UUID cookie is HTTP-only, strict same-site, and secure on HTTPS. It is a workspace capability, **not verified identity or authorization roles**. A cookie holder can control that demo workspace. The origin check and parameterized SQL do not turn this into a production access-control system.

There is no deployment workflow in this repository; CI validates on pushes/PRs. Serverless hosting needs external PostgreSQL; an ephemeral filesystem is not a durable PGlite volume. Before any real-data use, design identity, authorization, retention, rate limits, session cleanup, carrier contracts, and operational monitoring. See [SECURITY.md](../SECURITY.md).

## 7. Verification and failure laboratories

```bash
npm run format:check
npm run typecheck
npm test
npm run build
npx playwright install chromium
E2E_PORT=43127 PGLITE_DATA_DIR=./.data/browser-lab npm run test:e2e
```

Choose an unused port. Playwright starts its own production server and refuses to reuse an unrelated one. Its desktop and mobile cases cover navigation, routing, override, cancellation, creation, reset, review, and contention, plus browser errors and overflow. No separate lint command exists; formatting and TypeScript are the configured static checks.

For server-database verification, use a disposable PostgreSQL 17 database. `docker compose up -d` starts the supplied local service on 5432; if that port is occupied, use a separately configured instance. Then run:

```bash
DATABASE_URL=postgres://routing:routing@127.0.0.1:5432/routing npm run test:postgres
```

[test:postgres](../tests/postgres.integration.ts) opens two independent pools and verifies one allocation/one review/one reserved unit. It deletes only its generated session afterward. Docker is optional for the local app, but this test requires a running PostgreSQL server; embedded tests are not a substitute. CI provisions PostgreSQL and runs it in [.github/workflows/ci.yml](../.github/workflows/ci.yml).

### Lab A: all-or-nothing shortage and outage

Reset. Route FR-1044; expect REVIEW and zero reservations. Route FR-1045; expect REVIEW with `complete: false`. Override FR-1045 to BUF with a valid reason; expect ALLOCATED but still `complete: false` and zero claimed advantage. This distinguishes missing evidence from insufficient inventory. Inspect its saved candidates and Activity.

### Lab B: failed override preserves ownership

Reset. Route FR-1043 to BUF; two switches become reserved. Override to RNO; expect the sufficient-stock/available-quote error. The order remains at BUF and its two switches remain reserved. This is covered by `failed override preserves the old allocation` in [routing.test.ts](../tests/routing.test.ts).

### Lab C: contention and repeatability

Reset, open Demo walkthrough, run the concurrency demo. Expect exactly `1 allocated · 1 held for review · stock never below zero.` BUF's LAB-001 has reserved 1, available 0. Running again fails with an instruction to reset. The browser/embedded demo demonstrates the result; the separate-pool test demonstrates server locking.

### Lab D: failure after writes have begun

Run `npm test -- --test-name-pattern` only if you adapt Node's argument ordering; the simplest exact targeted invocation is:

```bash
node --import tsx --test --test-name-pattern='audit failure|cancellation during|workspace limit' tests/routing.test.ts
```

The audit failure test wraps the transaction adapter and throws at INSERT INTO audit_events, after a multi-item reservation and order save. Expected: the entire dashboard equals its pre-attempt snapshot. The cancellation test pauses quotes, cancels, releases quotes, and expects rejection plus no reservations. The workspace-cap test fills 99 orders and expects a race rejection without either race order inserted. These tests exercise failure ordering, not just successful return values.

### Diagnose symptoms

A 503 health response means database readiness failed; inspect the server log and connection/directory configuration first. A cross-origin 403 often means the browser/proxy origin does not match the effective server origin. Preserve the host consistently and check proxy configuration. A stale preview is expected under concurrent changes; route rechecks stock. A duplicate embedded server can lock or corrupt its files: stop duplicate processes and use a fresh data directory. Never delete a live shared database to fix a demo.

## 8. Design choices and extension exercises

**Why coarse locking?** A single workspace row makes interleaving easy to reason about. It also serializes dashboard reads and independent orders in that workspace. Narrower locks improve throughput only with consistent ordering, deadlock handling, and measured contention tests.

**Why direct SQL?** The interesting behavior is visible in conditional UPDATEs and transaction boundaries. An ORM would not remove the need to understand them. **Why no Apollo Client/DataLoader?** The UI reloads a small bounded workspace and nested catalog lookups use in-memory fixtures, so no per-row SQL query problem exists.

1. **Exercise: a new destination.** Add a fictional destination and prove the UI/API can route to it. **Solution outline:** update DESTINATIONS in model.ts, the GraphQL DestinationId enum, and any UI choices; add a service/API test and inspect the rendered selection. The Zod enum derives from the model, while GraphQL is separately maintained. Do not assume TypeScript generates the schema.
2. **Exercise: a real quote adapter.** Preserve stock safety during timeouts. **Solution outline:** implement ShippingProvider with server-side credentials, runtime response validation, bounded timeout/retry, quote currency/expiry, and parcel dimensions. Keep requests outside `locked`; revalidate quote applicability when order inputs become editable. Add failure and late-cancellation tests before connecting an account.
3. **Exercise: reservation expiry.** **Solution outline:** introduce explicit reservation records/statuses and expiry timestamps with versioned migrations. A worker and cancellation must lock the same ownership boundary, release once, and append an event in one transaction. Add worker-versus-cancel and worker-versus-shipment races. A timer in React is not durable fulfillment logic.
4. **Exercise: idempotent ingestion.** **Solution outline:** add a scoped unique request key and payload hash; same key/same normalized input returns the stored result, changed input conflicts. Insert key and order in the same transaction. Existing route idempotency does not make createOrder retry-safe.

## 9. Interview questions with grounded answers

**What prevents overselling?** Workspace row locking serializes writers, conditional stock UPDATEs recheck availability, SQL constraints reject invalid counts, and one transaction commits all lines plus order plus audit.

**Why quote before locking?** Network latency should not monopolize the inventory lock. Fresh order/state and stock reads under lock prevent stale decisions from blindly committing afterward.

**Why not simply choose the nearest warehouse?** Inventory eligibility and simulated price are distinct. FR-1043 is the counterexample; actual carrier rates would add further factors.

**Is this exactly-once processing?** No. Existing order routing/cancellation are idempotent, but new order creation lacks an idempotency key and real external side effects are absent.

**What does the test suite prove?** Reproducible domain behavior, rollback, separate-connection contention in PostgreSQL, and browser flows. It does not prove arbitrary production load, real carrier correctness, or authenticated multitenancy.

**What would you change first for production?** Establish real identity/data boundaries and external contracts, then normalized durable reservation ownership and migrations. Preserve the tested atomicity while adding operational limits; do not begin with cosmetic rewrites.
