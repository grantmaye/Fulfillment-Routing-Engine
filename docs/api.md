# GraphQL API

Send JSON POST requests to `/api/graphql`. The first request sets a `routing-session` cookie and seeds its workspace. Preserve that cookie between requests. IDs are scoped to the session.

## Inspect the workspace

```graphql
query Workspace {
  dashboard {
    storageMode
    orders {
      id
      status
      destination {
        city
        state
      }
      items {
        quantity
        product {
          sku
          name
        }
      }
      warehouse {
        id
        name
      }
      decision {
        reason
        complete
        candidates {
          warehouseId
          eligible
          costCents
          reason
        }
      }
    }
    inventory {
      warehouseId
      sku
      onHand
      reserved
      available
    }
  }
}
```

## Preview without reserving

```graphql
query Compare {
  evaluateOrder(id: "FR-1042") {
    selectedWarehouseId
    reason
    candidates {
      warehouseId
      costCents
      transitDays
      stock {
        sku
        requested
        available
      }
    }
  }
}
```

## Allocate

```graphql
mutation Allocate {
  routeOrder(id: "FR-1042") {
    id
    status
    warehouse {
      name
    }
    decision {
      reason
      savingsCents
    }
  }
}
```

## Create a multi-item order

```graphql
mutation Create {
  createOrder(
    input: {
      customer: "Sample Studio"
      destinationId: SFO
      items: [{ sku: "PH-100", quantity: 3 }, { sku: "HS-200", quantity: 2 }]
    }
  ) {
    id
    status
  }
}
```

## Override, cancel, and reset

Send each operation separately.

```graphql
mutation Override {
  overrideOrder(
    id: "FR-1042"
    warehouseId: BUF
    reason: "Customer requested east coast shipment."
  ) {
    id
    status
    warehouseId
  }
}
```

```graphql
mutation Cancel {
  cancelOrder(id: "FR-1042") {
    id
    status
  }
}
```

```graphql
mutation Reset {
  resetDemo
}
```

```graphql
mutation LastUnit {
  runConcurrencyDemo
}
```

## Use curl

```bash
curl -s http://localhost:3000/api/graphql \
  -H 'Content-Type: application/json' \
  -c /tmp/routing-cookies.txt -b /tmp/routing-cookies.txt \
  --data '{"query":"{ dashboard { orders { id status } } }"}'
```

Use the same cookie file for subsequent operations. Cookie files grant access to that fictional workspace; do not commit them.

## Error behavior

Expected business errors use `BAD_USER_INPUT`, `NOT_FOUND`, or `CONFLICT` in `errors[].extensions.code`. Check the GraphQL response's `errors` even when HTTP status is 200. Stock shortages and incomplete quote comparisons are valid review outcomes, not transport errors.

The API accepts one top-level mutation per request. Fragments, batched HTTP operations, and streaming responses are not supported. The schema is intentionally small, with a 200-field operation limit and up to 100 regular orders per workspace. Use introspection to explore its types.
