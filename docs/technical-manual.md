# Fulfillment Routing Engine: technical manual

This manual teaches the **Dispatch** demo from first run to maintenance. Read the [product story](product-story.md) for the problem it illustrates and the [interview walkthrough](INTERVIEW-WALKTHROUGH.md) for a shorter presentation. Source links below are the implementation, not claims about a production deployment.

**Start learning here:** [first lesson and build sequence](#10-build-it-from-zero-a-teaching-sequence), then [build the UI](#11-build-the-interface-from-layout-to-interaction), then [trace FR-1041 end to end](#12-follow-fr-1041-from-a-click-to-sql-and-back), and [practice with solutions](#13-hands-on-exercises-with-solutions). Sections 1–9 remain the reference manual for running, operating, and extending the project.

This is a reconstruction of how to build the **current code**, not a claim about the historical order in which it was written. You can learn the design without assuming it was deployed in production. Use a separate checkout, unused port, and separate data directory for experiments. Do not reset a workspace someone is using for a live walkthrough.

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

A 503 health response means database readiness failed; inspect the server log and connection/directory configuration first. A cross-origin 403 means the browser origin must be compared with the request protocol and actual Host, including port; see [request-origin.ts](../src/lib/request-origin.ts). Both `localhost` and `127.0.0.1` work when the browser uses the same spelling for the page and its request. They are not interchangeable origins. A stale preview is expected under concurrent changes; route rechecks stock. A duplicate embedded server can lock or corrupt its files: stop duplicate processes and use a fresh data directory. Never delete a live shared database to fix a demo.

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

## 10. Build it from zero: a teaching sequence

### First lesson: separate a screen from a decision

Start with a piece of paper. Draw two warehouse boxes and write “45 phones, 28 headsets” in Buffalo and “32 phones, 40 headsets” in Reno. Write FR-1041 beside them: four phones and two headsets to New York. Both boxes can cover the full order. Given quotes of $18.12 and $33.26, choose Buffalo. Cross out **available** 45/28 and replace it with 41/26. Do not change on-hand 45/28: the goods have been promised, not shipped.

Now open three files side by side:

1. [dashboard.tsx](../src/components/dashboard.tsx), the button with `act(() => routeOrder(selected.id), ...)`: what the person does.
2. [client.ts](../src/lib/client.ts), `routeOrder`: what the browser asks the server to do.
3. [routing.ts](../src/lib/routing.ts), `RoutingService.route`: what the server must verify before making a promise.

The browser may display an old preview. The server must decide using current inventory. That distinction is the foundation of this project. You do not need to understand every React hook or SQL statement before understanding it.

### Toolchain in plain language

**JavaScript** runs the program. **TypeScript** adds types checked during development; those types disappear at runtime. **Node.js** runs JavaScript on the server. **React** turns state into interface elements. **Next.js** supplies the web server, file-based routes, React build pipeline, and production packaging. **npm** installs packages and runs the commands in package.json.

**GraphQL** is the typed request language between browser and server. **Apollo Server** validates and executes that schema. It is not a separate deployed service here. **Zod** validates actual runtime input in the service, including callers that do not use GraphQL. **PostgreSQL** stores records and provides transactions; **pg** connects to a PostgreSQL server, while **PGlite** runs an embedded PostgreSQL engine. **Lucide React** supplies the icons. **Prettier** formats source. **tsx** lets Node execute the TypeScript tests. **Playwright** drives desktop and mobile browser tests.

Use the checked-in [package.json](../package.json) and [package-lock.json](../package-lock.json), not a list of unpinned “latest” installs. The lockfile specifies resolved versions; `npm ci` reproduces them. Node must satisfy `>=22.13`; CI uses Node 22. A successful Node 24 local run does not replace that CI coverage.

| Command                 | What it does                                                                 | When to use it                                           |
| ----------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------- |
| `npm ci`                | Installs the lockfile's dependency tree                                      | After cloning or dependency changes                      |
| `npm run dev`           | Starts Next development mode                                                 | Editing and learning                                     |
| `npm run build`         | Compiles the production app and checks types                                 | Before production-mode testing                           |
| `npm start`             | Serves the existing production build                                         | Stable local walkthrough                                 |
| `npm run typecheck`     | Runs TypeScript without emitting JS                                          | Catch mismatched types                                   |
| `npm test`              | Executes `tests/*.test.ts` with Node + tsx                                   | Domain, API, origin and embedded audit checks            |
| `npm run check`         | Typecheck followed by unit/service tests                                     | Normal pre-commit check                                  |
| `npm run test:postgres` | Runs server-database integration tests                                       | Numeric audit history and separate-pool contention       |
| `npm run test:e2e`      | Starts an isolated production server and runs browser tests                  | UI/HTTP regression checks                                |
| `npm run format:check`  | Checks formatting without edits                                              | Before committing                                        |
| `npm run format`        | Applies Prettier to the project                                              | Intentional formatting pass; inspect the diff            |
| `npm run db:reset`      | Deletes all sessions in the configured database after its confirmation guard | Disposable databases only; not a troubleshooting default |

There is no separate lint script, CSS framework, ORM, or client-side state library in this project.

### Repository map

```text
src/app/layout.tsx          HTML shell, page metadata, global CSS import
src/app/page.tsx            / route: renders Dashboard
src/app/globals.css         design tokens, layout, components, responsive rules
src/app/api/graphql/route.ts POST transport, cookie, Apollo execution
src/app/api/health/route.ts database readiness
src/components/dashboard.tsx all four views, dialogs, state, Metric helper
src/lib/model.ts            types and catalog/destination/warehouse fixtures
src/lib/shipping.ts         ShippingProvider interface and rate simulator
src/lib/database.ts         SQL adapters and schema initialization
src/lib/seed.ts             six initial orders and inventory
src/lib/routing.ts          policy and transactional application service
src/lib/graphql.ts          GraphQL schema, resolvers, limits and errors
src/lib/client.ts           browser fetch and GraphQL operations
src/lib/request-origin.ts   exact request-origin policy
tests/                     service, audit, origin, PostgreSQL and browser tests
scripts/reset.ts           explicit all-session reset utility
docs/                      this manual, API, architecture, operations and walkthrough
```

[tsconfig.json](../tsconfig.json) enables strict TypeScript and maps `@/*` to `src/*`; this is why `@/lib/model` works. [next.config.ts](../next.config.ts) keeps pg/PGlite as server external packages and removes the X-Powered-By header. [playwright.config.ts](../playwright.config.ts) selects Chromium desktop and mobile profiles and uses `E2E_PORT`. [.github/workflows/ci.yml](../.github/workflows/ci.yml) provisions PostgreSQL 17 and runs formatting, types, tests, build, and browser checks. Build output, data, dependencies and environment files are ignored by [.gitignore](../.gitignore).

### A sequence for rebuilding, with a checkpoint at each step

Use a new learning folder; keep the working reference repository beside it. These are implementation milestones, not commands that automatically generate the complete product.

1. **Create the skeleton.** Copy package.json, package-lock.json, tsconfig.json, next-env.d.ts and next.config.ts from the reference. Run `npm ci`. Add `src/app/layout.tsx`, `page.tsx` and a small globals.css. The layout returns `<html lang="en"><body>{children}</body></html>`; the page can initially render `<h1>Dispatch</h1>`. Checkpoint: `npm run dev -- --hostname 127.0.0.1 --port 3002` renders your heading. Stop only your learning process before using the same port for another server.
2. **Name the domain.** Reconstruct model.ts: warehouse and destination IDs, products with weight, `LineItem`, `Inventory`, `Order`, `Candidate` and `Decision`. A TypeScript union such as `'PENDING' | 'ALLOCATED' | 'REVIEW' | 'CANCELLED'` restricts valid strings at compile time. Checkpoint: explain why an order needs both current `warehouseId` and a historical `decision`.
3. **Make the price calculator pure.** Add shipping.ts. Its deterministic inputs are warehouse, destination and items. There is no fetch, account, or payment. Checkpoint: four phones plus two headsets produce BUF 1812 cents and RNO 3326 cents. Use the solution in section 13.
4. **Make selection independent of persistence.** Add the `evaluate` function from routing.ts. Give it an order, inventory array and provider. Check stock before comparing quotes. Checkpoint: shortage gives no selection; a missing eligible quote gives an incomplete comparison; equal prices resolve to BUF. You can test this before creating any HTTP server.
5. **Add durable data.** Implement the `Sql` and `Database` interfaces and both adapters in database.ts. Create the four tables, then seed.ts. SQL parameters such as `$1` hold values separately from SQL syntax. Checkpoint: a fresh in-memory database contains six orders and ten inventory rows; reserved is zero. Use test setup from routing.test.ts rather than the live demo database.
6. **Add the transaction boundary.** Implement `locked`, `createOrder`, `route`, `cancel` and override handling. Never implement allocation as three independent API writes. Checkpoint: the rollback and last-unit tests pass; failed overrides leave the original allocation intact. Add the workspace cap and race helper only after ordinary order operations are correct.
7. **Expose the service.** Add graphql.ts and the GraphQL route. A resolver is the function that implements a GraphQL field. Put policy in the service rather than in resolvers. Add the cookie and origin helper. Checkpoint: a query returns six orders and a mutation updates one; a foreign origin is rejected before any workspace initialization.
8. **Build the browser adapter.** Add client.ts. Send JSON containing a query and variables using `fetch('/api/graphql')`; check HTTP failure and GraphQL `errors`. Checkpoint: a missing order produces a useful error, even when HTTP status is 200.
9. **Build the UI in layers.** Follow section 11: static shell, read-only queue, selection and preview, mutation state, dialogs, then inventory/activity/guide views. Checkpoint: a route action reloads real server state and displays the saved decision. Do not pretend to allocate by incrementing local counters.
10. **Make it usable at smaller widths.** Add responsive rules, keyboard focus, form labels and status messages. Checkpoint: the desktop and mobile browser suites pass without page overflow. A test pass is not a complete accessibility audit.
11. **Add failure cases before polish.** Exercise missing stock, missing quotes, cancellation during a delayed quote, audit-write failure, and repeated commands. Checkpoint: tests verify unchanged state after rejected operations, not merely an exception message.
12. **Package the result for review.** Build once, run tests against that build, inspect only intended diffs, and submit a draft PR. Keep demo data and environment files out of Git. CI passing is evidence for the tested commit, not a production certification.

## 11. Build the interface from layout to interaction

### The document and the client boundary

[layout.tsx](../src/app/layout.tsx) is the document frame: English language, metadata, global CSS, and children. [page.tsx](../src/app/page.tsx) renders `<Dashboard />`. [dashboard.tsx](../src/components/dashboard.tsx) begins with `'use client'` because it uses state, effects, event handlers and native dialogs. That marks a client component; it does not mean every part of Next.js runs only in the browser.

**JSX** is the HTML-like syntax inside TypeScript. `<Metric title="Allocated orders" ... />` calls a React component with **props** (inputs). JSX uses `className` instead of `class`, braces for JavaScript values, and `onClick` for event handlers. A `.tsx` file can contain both TypeScript and JSX. The small `Metric` component is reused four times; most other UI is intentionally in one Dashboard component. This makes the demo easy to inspect but is a maintenance tradeoff, not a recommendation to put every large application in one file.

### Design from big boxes to small details

Draw a fixed left navigation, a top bar, a heading/actions row, four metrics, then a two-column work area. Put the order table on the left and the selected order inspector on the right. Inventory needs warehouse tables; Activity needs a timeline; Guide needs scenario cards. All four views share one shell and dataset. They are state-selected views, not separate URL routes.

The design uses ordinary CSS in [globals.css](../src/app/globals.css):

```css
:root {
  --bg: #f7f8fa;
  --ink: #202a34;
  --muted: #7b8490;
  --line: #e7eaee;
  --orange: #de5a36;
  --nav: #17212b;
  --green: #268367;
  --font: Arial, Helvetica, sans-serif;
}
```

These **custom properties** are reusable design values. The light surface separates working content from dark navigation; orange marks the main action, and status badges use text as well as color. This is an explanation of the current visual choices, not a claim of a particular designer's historical process. Arial/Helvetica/system fallbacks require no external font fetch. Lucide components such as `Truck`, `Plus` and `GitBranch` render SVG icons.

`box-sizing: border-box` includes borders/padding in declared widths. `.shell` uses flex layout; `.sidebar` is fixed at 228px on wide screens, and `main` makes room for it. `.content` bounds the workspace. `.metrics` uses `repeat(4, 1fr)` to create equal columns. `.orders-layout` uses `minmax(480px, 1.55fr) minmax(310px, 1fr)` so the queue gets more room than the inspector. `fr` means a fraction of the remaining grid space. Panels provide borders, white surfaces and spacing. Tables retain actual table markup rather than imitating rows with arbitrary divs.

The draft's caption cleanup removes decorative labels such as “FULFILLMENT CONTROL” and “ROUTING INSPECTOR.” It preserves factual warehouse region text as `.warehouse-region`. This reduces repeated headings without removing the order ID, status, warehouse comparison or demo disclosure.

### Responsive behavior is a set of layout decisions

| CSS boundary    | What changes                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| At least 1500px | Wider queue/inspector proportions and 32px heading                                                                     |
| At most 1200px  | Sidebar shrinks to 195px; heading stacks; warehouse panels become one column; queue destination column hides           |
| At most 850px   | Sidebar becomes an ordinary top block; navigation becomes horizontal; main loses its left margin; guide stacks         |
| At most 650px   | Queue and inspector stack; metrics become two columns; queue destination column returns; typography and spacing shrink |

The destination column returns on phones because the queue has its own full-width row above the inspector. That is an explicit choice in the stylesheet, not a framework default. On phones the inspector follows the queue, so you may need to scroll down to see the selected order. Test intermediate widths as well as one phone preset before making broad claims about responsiveness.

### Understand the state before adding a button

**State** is a value React remembers across renders. Updating it schedules another render; directly modifying a local variable does not update the screen. In Dashboard:

| State/ref                             | Purpose                                                                |
| ------------------------------------- | ---------------------------------------------------------------------- |
| `data`                                | Latest server dashboard or null during initial load                    |
| `tab`                                 | orders, inventory, activity or guide view                              |
| `selectedId`                          | Which order to inspect; initially FR-1042                              |
| `decision`, `previewing`              | Current advisory comparison or stored decision, plus loading state     |
| `busy`                                | Disable conflicting controls while a mutation and refresh run          |
| `notice`                              | Success/error text and alert style                                     |
| `search`, `filter`                    | Local queue filtering                                                  |
| `overrideWarehouse`, `overrideReason` | Controlled override form inputs                                        |
| Three `useRef` dialog handles         | Access native `<dialog>` elements without storing DOM objects in state |

`selected`, `allocated`, `pending`, `review`, shipping totals and visible rows are **derived** from data/state during rendering. Keeping them derived avoids synchronizing duplicate state manually. `refresh`, wrapped in `useCallback`, loads the dashboard and calls `setData`. A mount `useEffect` calls refresh. An **effect** runs work after React renders; it is used here to load data rather than during the render function itself.

The selection effect uses a saved decision when one exists. Otherwise it requests a preview. Its cleanup sets `active = false`, so a slow response for a previously selected order cannot overwrite the current selection's display. This prevents a stale UI result, not the network request itself: there is no AbortController here. Previews do not reserve stock and are rechecked when routing.

`act` is the common mutation wrapper. It sets busy, clears the old notice, awaits work, reloads the dashboard, shows success, handles errors and clears busy in `finally`. It is **not an optimistic update**: the UI does not assume a reservation before the server confirms it. A remaining limitation is that a mutation can commit successfully and its follow-up refresh can fail; the UI then reports an error even though the mutation committed. Re-reading the dashboard is the first debugging step. Repeating route/cancel is safe for an existing order; repeating create can create a second order because ingestion has no idempotency key.

### Build forms deliberately

The create dialog uses ordinary labeled inputs and `new FormData(form)`. On submit it prevents native navigation, reads values by `name`, converts quantity with `Number`, and sends GraphQL variables. It closes and resets only after `act` returns a result. This is largely an **uncontrolled form**: the browser owns the entered field values until submission.

Override uses **controlled inputs**: `value` comes from React state and `onChange` updates that state. Its selected warehouse and explanation are kept together and sent as variables. `required`, `minLength`, `maxLength`, `min` and `max` provide browser feedback; the server repeats the important checks because browser validation is bypassable.

The reset dialog describes its destructive effect and requires a separate click. Reset is a teaching tool, not something to run in a shared walkthrough to clear an error. No reset is necessary to inspect already saved decisions.

### Loading, errors and accessibility

Before data arrives, the UI shows a preparation message and disables actions. Failed initial load exposes Retry connection. Preview has its own progress state. Mutation controls use the shared busy flag. Notices use `role="alert"` for errors and `role="status"` for successful feedback; dialogs also show error text so a failed request does not hide behind the modal.

There are named navigation and details regions, table headers, labeled form inputs, accessible names on icon buttons, visible `:focus-visible` outlines, and native `dialog.showModal()`/`close()` behavior. Reduced-motion CSS stops the spinner animation. Status words remain readable without color.

Limits worth recognizing: there is no recorded screen-reader or contrast audit; the dialogs have visible headings but no explicit `aria-labelledby` associations; active navigation is styled but does not set `aria-current`; mobile text is quite small in some places. These are sensible future UI exercises. Do not claim WCAG compliance from the browser suite alone.

## 12. Follow FR-1041 from a click to SQL and back

This is a trace of a **fresh or equivalently restored fictional workspace**. Do not click someone else's pending order merely to follow the text. [walkthrough.test.ts](../tests/walkthrough.test.ts) checks the exact fixture math independently of a live browser.

```mermaid
sequenceDiagram
  actor Person
  participant UI as Dashboard / React
  participant HTTP as POST /api/graphql
  participant API as Apollo resolver
  participant Service as RoutingService
  participant DB as PostgreSQL
  Person->>UI: Inspect FR-1041, Route this order
  UI->>HTTP: routeOrder(id: FR-1041), session cookie
  HTTP->>HTTP: Content type, origin, size, JSON checks
  HTTP->>API: Execute with service + sessionId context
  API->>Service: route(sessionId, id)
  Service->>Service: Capture simulated BUF/RNO quotes
  Service->>DB: BEGIN; lock workspace row
  Service->>DB: Reload order + inventory
  Service->>DB: Reserve every line; save order + audit
  Service->>DB: COMMIT
  API-->>UI: id + status
  UI->>HTTP: Reload dashboard query
  HTTP-->>UI: Orders, inventory, events, storage mode
  UI-->>Person: BUF allocated; saved decision
```

### 1. The exact input and preview

[seed.ts](../src/lib/seed.ts) defines Hudson Studio, destination NYC, four PH-100 desk phones and two HS-200 headsets. [model.ts](../src/lib/model.ts) supplies the names, weights and New York ZIP 10001. Total weight is `4 × 2.4 + 2 × 0.8 = 11.2 lb`.

The inspector calls `previewOrder` for an order without a saved decision. Buffalo has 45 phones/28 headsets available; Reno has 32/40. Both are eligible. The quote simulator computes rounded great-circle distances of 292 and 2,394 miles:

```text
BUF: round(650 + 292  × 0.72 + 11.2 × 85) = 1812 cents
RNO: round(650 + 2394 × 0.72 + 11.2 × 85) = 3326 cents
Difference: 3326 - 1812 = 1514 cents
```

Synthetic transit is 1 day vs 4 days, but cost decides. A preview is an explanation of a possible decision, not a promise of stock.

### 2. The click and browser request

Dashboard's route button invokes:

```tsx
act(() => routeOrder(selected.id), 'Routing decision saved.');
```

[client.ts](../src/lib/client.ts) uses a GraphQL variable rather than assembling the ID into query syntax:

```graphql
mutation Route($id: ID!) {
  routeOrder(id: $id) {
    id
    status
  }
}
```

Variables for this action are `{ "id": "FR-1041" }`. Fetch uses the relative `/api/graphql` URL, so it goes to the same host as the page and sends that host's workspace cookie. A GraphQL **mutation** asks to change data; a **query** asks to read data. The mutation returns only ID/status because `act` subsequently reloads the full dashboard.

### 3. Transport and resolver boundaries

The [route handler](../src/app/api/graphql/route.ts) accepts JSON POST, verifies origin, limits the body, parses JSON, validates or creates the UUID session cookie, and initializes its seed once. Apollo receives `{ service, sessionId }` as **context**, data shared with resolvers for this request. The `routeOrder` resolver delegates to `c.service.route(c.sessionId, id)`. No browser-supplied session ID is accepted as a GraphQL argument.

[request-origin.ts](../src/lib/request-origin.ts) compares the supplied Origin to `request.nextUrl.protocol + '//' + Host`. NextURL normalizes loopback hostnames to localhost, so using its `.origin` directly would reject a legitimate numeric-loopback page. The actual Host preserves the spelling and port. `http://localhost:3000` and `http://127.0.0.1:3000` are each valid against themselves; one is rejected against the other. Foreign origins, wrong ports/schemes, `Origin: null`, and an empty Origin are rejected. A missing Origin remains allowed for CLI clients. X-Forwarded-Host does not create an allowlist. Reverse-proxy trust and forwarded protocol handling still need an explicit deployment design before production use.

### 4. The transaction protects the promise

`route` reads the order and gets both quotes before locking. Inside `locked`, the pg adapter runs `BEGIN`, then:

```sql
SELECT id FROM demo_sessions WHERE id=$1 FOR UPDATE;
```

`$1` is this workspace. A competing writer to the same workspace waits for that row lock. The service reloads the order, checks cancellation or an existing allocation, rereads inventory, then reevaluates with captured quotes. Inventory is `on_hand - reserved`; it is not taken from the browser's earlier preview.

Buffalo is chosen. The service sorts the two item updates by SKU and runs the following for each item:

```sql
UPDATE inventory
SET reserved=reserved+$4
WHERE session_id=$1 AND warehouse_id=$2 AND sku=$3
  AND on_hand-reserved >= $4
RETURNING sku;
```

For HS-200, the values are workspace, BUF, HS-200, 2. For PH-100, the quantity is 4. If any update returns no row, it throws `CONFLICT`; the transaction rolls back previous item updates. SQL constraints provide a second defense against invalid inventory counts.

The order becomes `ALLOCATED`, `warehouseId` becomes `BUF`, and its JSONB decision records candidates, costs, stock snapshots, reason, evaluation time and policy version. An `ALLOCATED` audit row says:

```text
BUF · $18.12 simulated shipping. Lowest eligible shipping cost. Ties resolve by warehouse code.
```

Saving the order and writing the event use that same transaction connection. If the audit write fails, reservations and the order save roll back too. Only after `COMMIT` does the successful mutation return.

### 5. The visible result and inventory arithmetic

| Warehouse / SKU | On-hand stays | Reserved before → after | Available before → after |
| --------------- | ------------- | ----------------------- | ------------------------ |
| BUF / PH-100    | 45            | 0 → 4                   | 45 → 41                  |
| BUF / HS-200    | 28            | 0 → 2                   | 28 → 26                  |
| RNO / PH-100    | 32            | 0 → 0                   | 32 → 32                  |
| RNO / HS-200    | 40            | 0 → 0                   | 40 → 40                  |

The dashboard query reads orders, inventory and events under the same workspace lock, so those three reads describe one coherent state. React receives new data, recomputes metrics, and displays “BUF allocated.” The inspector uses the saved decision instead of requesting a fresh preview. Its candidate available counts describe the decision-time snapshot, not a continuously updating inventory view; open Inventory for current counts.

On an otherwise fresh workspace, allocated shipping becomes $18.12 and routing advantage becomes $15.14. Other allocated orders change those totals. They are sums of saved simulated decisions, not actual spend or historical savings.

### 6. Retries, overrides and cancellation

Routing FR-1041 again returns its allocation without reserving again or adding another allocation event. A valid Reno override first accounts for the order's owned reservation, checks Reno stock/quote, then atomically releases Buffalo and reserves Reno. It records `OVERRIDDEN` with the supplied reason and sets claimed advantage to zero. A failed override leaves Buffalo's reservation intact.

Cancellation releases the active reservation once, makes the order `CANCELLED`, sets its active warehouse to null and retains the decision for history. A second cancellation returns without another release/event. Cancelled orders cannot be routed again. There is no shipment, payment, label, or reservation-expiration operation hidden behind these buttons.

## 13. Hands-on exercises with solutions

Work in a disposable learning workspace. Predict the outcome before running anything, then compare with the result. Do not use a shared live session's cookies or database connection.

### Exercise 1: calculate the quote without a browser

**Task:** reproduce both FR-1041 prices using the real simulator, not numbers typed into a mock response.

**Solution:** run from the repository root; it reads only code and writes no database data:

```bash
node --import tsx --input-type=module <<'JS'
import { SimulatedShippingProvider } from './src/lib/shipping.ts';
const provider = new SimulatedShippingProvider();
const items = [{ sku: 'PH-100', quantity: 4 }, { sku: 'HS-200', quantity: 2 }];
for (const warehouse of ['BUF', 'RNO']) {
  console.log(warehouse, await provider.quote(warehouse, 'NYC', items));
}
JS
```

Expected: BUF costCents 1812/transitDays 1/distanceMiles 292; RNO 3326/4/2394. Doubling weight increases both quotes equally for the same destination; it does not necessarily switch the winner.

### Exercise 2: prove reservation is not shipment

**Task:** allocate FR-1041, route it again, then cancel it twice in a fresh in-memory database. Predict on-hand, reserved and event counts.

**Solution:** run the executable version in [walkthrough.test.ts](../tests/walkthrough.test.ts):

```bash
node --import tsx --test tests/walkthrough.test.ts
```

Expected: on-hand never changes; BUF reserves 4 phones/2 headsets, then both return to zero. Reno stays unchanged. Exactly one ALLOCATED and one CANCELLED event exist for the order. This test uses a new in-memory database and never connects to your running demo.

### Exercise 3: change the UI without changing the business rule

**Task:** in your learning copy, change `--orange` to a different accent and add a read-only “Available = on-hand − reserved” explanation to Inventory. Do not modify the service.

**Solution:** edit the custom property in globals.css; add a paragraph inside the `tab === 'inventory'` branch in Dashboard. Refresh and inspect both desktop and mobile widths. Run format/typecheck and the browser suite. The quoted prices and reservations should be identical: styling does not belong in the routing policy. Check contrast before keeping a new accent; changing a color token can affect buttons, icons and focus indicators differently.

### Exercise 4: explain stale preview handling

**Task:** select order A, then B while A's preview is still pending. Why does A not replace B's decision when it finishes?

**Solution:** trace the selection effect's `active` variable and cleanup. Cleanup for A sets its flag false; A's promise handler checks it before calling setDecision. This is display-race protection. The allocation transaction independently rereads inventory, so removing UI stale-result handling would not make overselling acceptable or remove the need for the server lock.

### Exercise 5: find the audit ordering bug

**Task:** predict PostgreSQL's output for this read-only SQL:

```sql
SELECT id::text AS id
FROM (VALUES (9::bigint), (10::bigint), (100::bigint)) AS events(id)
ORDER BY id DESC;
```

**Solution:** `9, 100, 10`. The unqualified ORDER BY names the text output alias. Change it to `ORDER BY events.id DESC`; now it is `100, 10, 9`. The application uses `ORDER BY audit_events.id DESC LIMIT 100`. It sorts by numeric insertion sequence, also breaking ties when timestamps are equal. It does not reorder events by arbitrary backdated timestamps.

Run `node --import tsx --test tests/audit.test.ts`, then the PostgreSQL suite against a disposable database. The shared fixture inserts 125 events, compares all 100 returned IDs/details, and adds an event in another workspace to check isolation. The test catches both bad order and an incorrect latest-100 subset.

### Exercise 6: protect the origin boundary

**Task:** predict whether each request is accepted when Host is `127.0.0.1:3000` and protocol is HTTP.

| Origin                      | Expected | Why                                                    |
| --------------------------- | -------- | ------------------------------------------------------ |
| `http://127.0.0.1:3000`     | Accept   | Exact match                                            |
| `http://localhost:3000`     | Reject   | Different hostname, even though both can point locally |
| `http://127.0.0.1:3001`     | Reject   | Different port                                         |
| `https://127.0.0.1:3000`    | Reject   | Different scheme                                       |
| `https://unrelated.example` | Reject   | Foreign origin                                         |
| `null` or empty string      | Reject   | Supplied origin is not the expected origin             |
| Header omitted              | Accept   | Existing CLI behavior; not proof of identity           |

**Solution:** run `node --import tsx --test tests/request-origin.test.ts`. Then the HTTP checks in the browser suite verify the rule through a running Next server, including localhost and numeric loopback. Never “fix” a failing test by accepting every origin, using a string-prefix match, or trusting a caller's X-Forwarded-Host.

### Exercise 7: add a feature with its failure case

**Task:** design a “route cheapest” change where a missing Reno quote no longer blocks Buffalo. Is that a harmless simplification?

**Solution:** no: without Reno's eligible quote, the service cannot claim Buffalo is cheapest. Preserve automatic REVIEW. If an operator chooses Buffalo anyway, use the existing override path with a reason and zero claimed advantage. Add a test like `an explicit override may accept a valid quote from an incomplete comparison`; never relabel an incomplete comparison as complete.

## 14. Debug and review like the maintainer

Follow one boundary at a time. If a button appears broken, inspect its disabled condition and notice first. Then inspect the HTTP response, including GraphQL `errors`; then the resolver/service; then database state. A 403 is a transport-origin problem, while REVIEW is a valid routing result. An exception during transaction work should leave the pre-operation state intact.

To diagnose the historical loopback failure, inspect NextURL's hostname and the incoming Host: Next normalizes loopback aliases, while the browser sends the actual page origin. The earlier main checkout compared the normalized origin; current code preserves Host. Tests cover valid localhost/IPv4/IPv6 policy inputs, exact scheme/port boundaries and rejection of unrelated origins. IPv6 is unit-tested; the browser server is bound to IPv4 loopback. Do not infer a tested IPv6 listener or reverse-proxy deployment from that unit test.

To diagnose activity order, compare the numeric database ID with the displayed text ID. Use read-only queries with explicit column qualification. Timestamps alone are not a safe tie-breaker because multiple writes in one transaction can share a timestamp. Audit IDs are sent as strings so JavaScript does not lose big integer precision; tests compare IDs with `BigInt` rather than converting them to Number.

Before publishing a change, examine `git status`, the branch's upstream, `git diff`, and the current PR head. A dirty file can be another person's work, or an older uncommitted copy of work already pushed elsewhere. Preserve it until you know which. Run required checks after final edits, not only before them. A draft PR should say what changed, what was tested on its exact head, and which boundaries remain.

What you can honestly say after completing this course: “I can trace a React action through GraphQL into a transactional routing service, explain stock eligibility and simulated quote ranking, show how reservations and audit events commit together, and reproduce contention and rollback tests.” What you cannot infer: real carrier performance, authenticated tenant isolation, measured cost savings, accessibility certification, or production readiness.
