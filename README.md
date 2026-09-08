# Fulfillment Routing Engine

[![Verify](https://github.com/grantmaye/Fulfillment-Routing-Engine/actions/workflows/ci.yml/badge.svg)](https://github.com/grantmaye/Fulfillment-Routing-Engine/actions/workflows/ci.yml)

An operations dashboard that chooses between Buffalo and Reno by checking stock and comparing shipping costs. Every allocation includes the alternatives considered and the reason for the decision.

Built with **Next.js, TypeScript, Node.js, Apollo Server, GraphQL, and PostgreSQL**. The interface is called **Dispatch**.

![Dispatch order queue and warehouse comparison](docs/images/dashboard.png)

## Why this exists

A second warehouse turns a simple fulfillment process into a recurring decision: which location has the complete order, and what will it cost to ship from each one? This project reconstructs a workflow I previously automated with WordPress, PHP, REST APIs, and a carrier shipping calculator.

This is a new implementation of that business problem. It contains no former employer code, branding, customer records, credentials, or carrier integration. All customer names, stock quantities, and shipping rates are fictional.

## Run the demo

Use Node.js 22.13 or newer. Node 22 is the CI target.

```bash
git clone https://github.com/grantmaye/Fulfillment-Routing-Engine.git
cd Fulfillment-Routing-Engine
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000). The first request creates six orders and inventory at both warehouses. No account, API key, Docker installation, or environment file is required.

By default, the app uses **PGlite**, an embedded PostgreSQL engine, and persists data in `.data/routing`. Run one app process per data directory. Browser sessions have separate demo datasets; refreshing retains your work. This is demo isolation, not a user authentication system.

For the interview, build once and use the production server:

```bash
npm run build
npm start
```

Install and build before the interview. The running default demo does not call external services.

## What you can do

- Inspect stock and simulated shipping options before committing an order.
- Route individual orders or evaluate the pending queue.
- Create orders for six sample destinations; the API also accepts multiple line items.
- Reserve all items in one transaction, or hold the entire order for review.
- Override a warehouse with a reason; an invalid override keeps the old reservation intact.
- Cancel an order and release its stock exactly once.
- Inspect the latest 100 activity events and saved decision snapshots.
- Run two competing allocations against one remaining unit.
- Reset your browser's demo workspace without changing anyone else's.

## A five-minute walkthrough

| Order   | Scenario                                           | Expected behavior                           |
| ------- | -------------------------------------------------- | ------------------------------------------- |
| FR-1041 | New York, both warehouses stocked                  | Buffalo has the lower simulated cost        |
| FR-1042 | San Francisco, both warehouses stocked             | Reno has the lower simulated cost           |
| FR-1043 | Seattle, switches unavailable in Reno              | Buffalo wins on stock eligibility           |
| FR-1044 | More gateways requested than either location holds | Needs review; no partial reservation        |
| FR-1045 | Reno quote unavailable                             | Needs review; no unsupported cheapest claim |
| FR-1046 | Charlotte, multiple products                       | All items reserved together in Buffalo      |

Start with FR-1042. Compare the two quotes, route it, and inspect Reno's reserved stock. Override it to Buffalo with a reason, inspect Activity, then cancel it. The reservation is released. Open **Demo walkthrough** and run the last-unit test. Reset when finished.

## Routing policy

1. Fulfill the entire order from one warehouse.
2. Calculate available stock as `on_hand - reserved`.
3. Exclude a warehouse if any item is short.
4. Require a successful quote from every stock-eligible warehouse before automatic selection.
5. Choose the lowest cost; break equal-cost ties by warehouse code.
6. Recheck stock and reserve it in a transaction, together with the order and audit event.

An operator can explicitly choose a stocked warehouse with a valid quote even when another quote is missing. That decision records an override reason and claims no routing advantage.

Money is stored as integer cents. The simulator uses great-circle distance and total product weight:

```text
quote cents = round(650 + distance miles × 0.72 + weight pounds × 85)
```

This is a reproducible illustration, not a carrier tariff. Transit days are synthetic estimates. The dashboard's routing advantage compares the two eligible quotes at decision time; it is not historical business savings.

## Architecture

```mermaid
flowchart TD
  UI["Next.js dashboard"] --> API["GraphQL / Apollo Server"]
  API --> S["Routing service"]
  S --> Q["Shipping provider"]
  Q --> M["Deterministic simulator"]
  S --> T["Database transaction"]
  T --> I["Inventory reservations"]
  T --> O["Order decision"]
  T --> A["Audit event"]
```

The Node.js backend runs in Next.js route handlers. It is not a separate deployed service. Resolvers delegate to a framework-independent routing service. The database adapter supports embedded PGlite or a normal PostgreSQL connection pool using the same SQL.

| File                           | Responsibility                                                   |
| ------------------------------ | ---------------------------------------------------------------- |
| `src/lib/routing.ts`           | Eligibility, ranking, allocation, overrides, cancellation        |
| `src/lib/shipping.ts`          | Shipping-provider contract and deterministic quotes              |
| `src/lib/database.ts`          | Database adapters, schema initialization, transaction boundaries |
| `src/lib/graphql.ts`           | Schema, resolvers, error mapping, operation limits               |
| `src/app/api/graphql/route.ts` | HTTP endpoint and demo-session cookie                            |
| `src/lib/model.ts`             | Domain types and fictional catalog/location fixtures             |
| `src/lib/seed.ts`              | Repeatable starting scenarios                                    |
| `src/lib/client.ts`            | Frontend GraphQL operations                                      |
| `src/components/dashboard.tsx` | Interactive operations workspace                                 |

See [architecture and tradeoffs](docs/architecture.md), [GraphQL examples](docs/api.md), and [running and troubleshooting](docs/operations.md).

## Verification

```bash
npm run check          # TypeScript and service/API tests
npm run format:check   # Formatting
npm run build          # Production compilation
npx playwright install chromium
npm run test:e2e       # Desktop and mobile browser flows against production server
```

The service suite covers east/west selection, shortages, missing quotes, retries, overrides, cancellation, stock contention, isolation, validation, tie-breaking, SQL rollback, and GraphQL behavior.

GitHub Actions additionally starts PostgreSQL and tests **two separate connection pools** competing for the last unit. The embedded test alone cannot demonstrate independent database connections. Browser checks exercise routing, inventory navigation, overrides, cancellation, order creation, reset, review states, and the concurrency demo. CI retains screenshots and traces as artifacts.

## Use a PostgreSQL server

```bash
docker compose up -d
```

Create `.env.local` with the local connection string from `.env.example`, then restart the app. The schema initializes automatically. For the separate-connection test:

```bash
DATABASE_URL=postgres://routing:routing@localhost:5432/routing npm run test:postgres
```

CLI scripts do not automatically read Next.js environment files; pass the variable explicitly. Docker credentials here are for a local, disposable development database.

## Deliberate boundaries

This is a runnable portfolio demo, not a production order-management system. There is no real authentication, carrier account, label purchase, payment handling, split shipment, delivery guarantee, inventory import, or reservation expiration worker. Reservations remain until cancellation or reset; allocation does not mean an order has shipped.

The small demo uses a coarse database lock per workspace. It favors clear correctness over maximum throughput. Orders and decision snapshots use JSONB; inventory is relational and constrained. The API returns a bounded workspace instead of implementing production pagination. See the architecture document for what would change at larger scale.

## License

[MIT](LICENSE).
