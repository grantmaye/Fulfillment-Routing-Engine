# Contributing

Run `npm ci`, then `npm run dev`. Keep business rules in the routing service and external shipping behavior behind `ShippingProvider`.

For changes to inventory or order state, include a test that demonstrates the failure case the change addresses. Run `npm run check`, `npm run format:check`, and `npm run build` before submitting a pull request. Use `npm run test:postgres` for lock/transaction changes and the browser suite for user-flow changes.

Do not commit real orders, carrier credentials, database files, or environment files. Sample scenarios should be reproducible without external accounts.
