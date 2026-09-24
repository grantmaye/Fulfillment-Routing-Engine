# Five-minute interview walkthrough: warehouse routing

## What this project demonstrates

This repository already includes a React frontend through Next.js and a Node.js backend through Next.js route handlers. Its API is GraphQL, and its database is PostgreSQL (embedded PGlite by default). It does not use SQL Server.

It is a current recreation of a warehouse-routing business problem, not a copy of an employer's code. All customers, inventory and shipping quotes are fictional. Use your real 888VoIP experience to explain why a second warehouse created this problem; describe this repository's implementation as the demonstration you are showing.

## Start it

```bash
npm ci
npm run build
npm start
```

Open http://localhost:3000. Choose **Reset demo** if you need the original six orders.

## Minute 1: the problem

“With an east coast and a west coast warehouse, the closest warehouse isn't always the correct choice. We have to know whether it can fulfill the entire order, compare shipping options, and reserve stock safely.”

Open FR-1042, the San Francisco example. Compare Buffalo and Reno inventory, simulated prices, and transit estimates.

**Be precise about this version:** it checks inventory, calculates quotes using destination and weight, then automatically chooses the lowest eligible cost. Transit estimates are displayed, but delivery deadlines and fastest-service optimization are not selection criteria. Those would require an explicit business policy and additional tests.

## Minute 2: React calls Node

Open `src/lib/client.ts`, then `src/app/api/graphql/route.ts`.

“The React screen sends a GraphQL operation to the Node.js route handler. The resolver delegates to the routing service, which contains the business rules. Keeping those rules outside the component lets me test them independently.”

Open `src/lib/routing.ts` and find `evaluate`.

“First I check all requested items at each warehouse. An out-of-stock warehouse is excluded. I request quotes for the eligible locations, then rank the complete quotes by cost. If a required quote fails, the order goes to review rather than pretending the comparison is complete.”

## Minute 3: make the decision real

Click **Route this order**, then inspect **Inventory**.

“A recommendation doesn't reserve stock. Allocation rechecks inventory inside a database transaction and updates the reservation, order decision, and audit event together.”

Show `RoutingService.locked` and the allocation code in `src/lib/routing.ts`, then the transaction adapter in `src/lib/database.ts`.

“The demo uses a coarse lock per workspace for clarity. This prevents two competing allocations from overselling. At larger scale I'd design finer locking and contention handling around the actual workload.”

## Minute 4: show failure handling

Inspect FR-1043: Reno lacks enough switches, so Buffalo is the eligible choice even for a west coast destination.

Inspect FR-1045: Reno's simulated quote is unavailable, so automatic routing requires review.

Return to the routed order, choose **Manual override**, select Buffalo, and enter a reason. Open **Activity log** to see the decision trail. Cancel the order to release its reservation.

## Minute 5: demonstrate a race

Open **Demo walkthrough**, then **Run concurrency demo**.

“Two orders compete for the last unit. One gets allocated, the other is held for review, and available stock never goes below zero. This is why the final stock check and reservation belong in the same transaction.”

The embedded test demonstrates application contention. The separate PostgreSQL integration test exercises two independent connection pools; check its CI result before claiming that test passed for a particular commit.

## Questions to expect

- **Where is Node?** The Next.js API route, Apollo/GraphQL execution, routing service, shipping provider and database access run on Node.js. React is the browser interface.
- **Why a transaction?** To avoid saving an order decision without its stock reservation or audit event, and to support safe competing allocations.
- **What if shipping fails?** Hold for review when a complete comparison is unavailable. A documented manual override is a separate explicit operator decision.
- **How is speed handled?** This version shows simulated transit times but ranks by cost. A delivery promise would first filter out services that miss the deadline, then rank the remaining eligible services.
- **What is not production-ready?** Real authentication, carrier integration, shipment execution, reservation expiry, split shipments, and production scaling.
