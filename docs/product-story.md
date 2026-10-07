# Why Dispatch is useful

## The problem behind the demo

A second warehouse creates a decision that an inventory spreadsheet cannot safely resolve by itself: which location can supply the entire order, and which available shipping option costs less? Two operators can see the same last unit. A partial update can promise one product while failing another. A manual warehouse change can accidentally leave both reservations active. A cheap quote is not a complete comparison when another eligible provider is unavailable.

Fulfillment Routing Engine explores these problems as an independent portfolio project. Its interface is named Dispatch. The source establishes a fictional two-warehouse setting; it does not establish a real customer, employer origin, revenue result, or production deployment. All locations, catalog quantities, order customer labels, and shipping scenarios are illustrative. See [fixtures](../src/lib/seed.ts), [model](../src/lib/model.ts), and [shipping simulator](../src/lib/shipping.ts).

## A hypothetical day in the warehouse

Imagine a fictional office-equipment seller operating from Buffalo and Reno. Its operations coordinator receives an order for six desk phones going to San Francisco. Before a routing tool, the coordinator might compare spreadsheets, calculate shipping estimates separately, ask another employee whether stock is already promised, and leave a note explaining the choice. A colleague could allocate the same stock before those sheets are updated.

With this demo, the coordinator opens FR-1042. Both warehouses' stock checks and quotes appear beside the decision. Reno wins the simulated comparison. Routing saves its reservation and explanation together. If the customer asks for Buffalo, the coordinator supplies a reason and the service transfers ownership atomically. If the order is cancelled, stock returns exactly once. Activity preserves a readable account of the actions.

The scenario is hypothetical. The benefit demonstrated is a clearer, verifiable workflow; no measured labor savings or fulfillment performance improvement is claimed.

## Who would benefit, and in what way?

- **Operations staff evaluating a concept:** compare eligible choices and inspect the reason behind an allocation instead of trusting an unexplained recommendation.
- **Backend engineers learning transactional design:** study a small complete example of stock contention, rollback, idempotent state changes, and adapter boundaries.
- **Engineering reviewers and interviewers:** run recognizable failure cases and trace UI → GraphQL → service → SQL, including independent PostgreSQL connections.
- **Product teams discussing requirements:** use shortages, quote outages, overrides, and cancellation to discover policy questions before choosing a carrier or order-management integration.

The intended value is decision clarity and a concrete technical teaching artifact. A real seller would still need authentication, carrier/address integration, operational ownership, inventory ingestion, reservation expiry, shipment confirmation, monitoring, and security controls.

## Before and after workflow

| Step               | Hypothetical manual workflow                    | Demonstrated workflow                                      |
| ------------------ | ----------------------------------------------- | ---------------------------------------------------------- |
| Check availability | Read counts without knowing concurrent promises | Evaluate on-hand minus reservations for every line         |
| Compare options    | Assume closest is cheapest                      | Compare available simulated prices and expose alternatives |
| Commit             | Update separate records                         | Commit inventory, order, and audit together                |
| Handle uncertainty | Guess despite a missing quote                   | Hold for review or explicitly override with a reason       |
| Change warehouse   | Undo/recreate by hand                           | Validate and transfer in one transaction                   |
| Cancel             | Risk releasing twice on retries                 | Terminal idempotent cancellation                           |
| Explain            | Reconstruct the decision later                  | Retain the decision snapshot and recent audit events       |

The [routing policy](../src/lib/routing.ts) is deliberately conservative: one warehouse must fulfill the whole order, and all eligible quotes must be available before an automatic cheapest claim. These choices prioritize explainability and safe stock promises over global shipping optimization.

## A 60–90 second demo narration

“Dispatch is a fictional two-warehouse fulfillment workspace. The important question is not just which shipment is cheaper; it is whether we can reserve the whole order safely and explain our choice.

Here is FR-1042 going to San Francisco. Both warehouses have phones, and Reno has the lower simulated quote. I route it, then open Inventory to show the six reserved phones.

Now suppose the customer requests Buffalo. I choose Manual override, give a reason, and save. The old reservation is released and the new one is made in one transaction. Activity records why we changed the decision. Cancelling releases that stock exactly once.

Here is the quote-outage case. The system holds it for review because it cannot honestly claim the cheapest option with missing evidence.

Finally, the last-unit demo sends two competing orders against one adapter. Exactly one allocates and the other is held. Tests also run that race through two separate PostgreSQL connections.

The UI, rates, and data are a teaching demo. The real engineering story is the atomic boundary joining inventory, order state, and an explanation.”

## Honest boundaries and next steps

Displayed transit times and price advantage are synthetic, not delivery promises or audited savings. Browser cookies isolate demo datasets; they do not authenticate employees. An allocation does not mean an order shipped. The coarse workspace lock is designed for understandable correctness, not a benchmark claim. PGlite makes local exploration convenient, while PostgreSQL tests provide a separate contention check.

Start with the [technical manual](technical-manual.md), follow its failure labs, then inspect [architecture.md](architecture.md) to discuss which simplifications a real workflow would need to replace. Keep the existing operational visual identity: the product's purpose is legible warehouse decisions, not decoration.
