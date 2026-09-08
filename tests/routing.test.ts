import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, migrate, type Database } from '../src/lib/database';
import { evaluate, RoutingService } from '../src/lib/routing';
import { SimulatedShippingProvider } from '../src/lib/shipping';
import { createApi } from '../src/lib/graphql';
import { dashboardQuery } from '../src/lib/client';

let db: Database;
let service: RoutingService;
const session = 'test-session';
before(async () => {
  db = await createDatabase();
  await migrate(db);
  service = new RoutingService(db);
  await service.initialize(session);
});
beforeEach(async () => {
  await service.reset(session);
});
after(async () => {
  await db.close();
});

test('east and west destinations choose the lower eligible quote', async () => {
  assert.equal((await service.route(session, 'FR-1041')).warehouseId, 'BUF');
  assert.equal((await service.route(session, 'FR-1042')).warehouseId, 'RNO');
});
test('stock eligibility wins over geographic proximity', async () => {
  const order = await service.route(session, 'FR-1043');
  assert.equal(order.warehouseId, 'BUF');
  assert.equal(order.decision!.candidates.find((c) => c.warehouseId === 'RNO')!.eligible, false);
});
test('insufficient stock holds the whole order without partial reservations', async () => {
  const order = await service.route(session, 'FR-1044');
  assert.equal(order.status, 'REVIEW');
  assert.equal(
    (await service.dashboard(session)).inventory.reduce((sum, i) => sum + i.reserved, 0),
    0,
  );
});
test('missing eligible quote prevents an automatic cheapest claim', async () => {
  const order = await service.route(session, 'FR-1045');
  assert.equal(order.status, 'REVIEW');
  assert.equal(order.decision!.complete, false);
  assert.equal(order.decision!.selectedWarehouseId, null);
});
test('route retries reserve once and cancellation releases once', async () => {
  await Promise.all([service.route(session, 'FR-1042'), service.route(session, 'FR-1042')]);
  let row = (await service.dashboard(session)).inventory.find(
    (i) => i.sku === 'PH-100' && i.warehouseId === 'RNO',
  )!;
  assert.equal(row.reserved, 6);
  await Promise.all([service.cancel(session, 'FR-1042'), service.cancel(session, 'FR-1042')]);
  row = (await service.dashboard(session)).inventory.find(
    (i) => i.sku === 'PH-100' && i.warehouseId === 'RNO',
  )!;
  assert.equal(row.reserved, 0);
  assert.equal(
    (await service.dashboard(session)).events.filter((e) => e.action === 'CANCELLED').length,
    1,
  );
  await assert.rejects(() => service.route(session, 'FR-1042'), /Cancelled/);
});
test('override atomically transfers the reservation and records the reason', async () => {
  await service.route(session, 'FR-1042');
  await service.route(session, 'FR-1042', {
    warehouseId: 'BUF',
    reason: 'Customer requested east coast fulfillment.',
  });
  const dashboard = await service.dashboard(session);
  assert.equal(
    dashboard.inventory.find((i) => i.sku === 'PH-100' && i.warehouseId === 'RNO')!.reserved,
    0,
  );
  assert.equal(
    dashboard.inventory.find((i) => i.sku === 'PH-100' && i.warehouseId === 'BUF')!.reserved,
    6,
  );
  assert.match(dashboard.events[0].detail, /Customer requested/);
});
test('failed override preserves the old allocation', async () => {
  await service.route(session, 'FR-1043');
  await assert.rejects(
    () =>
      service.route(session, 'FR-1043', {
        warehouseId: 'RNO',
        reason: 'Try the closer warehouse.',
      }),
    /sufficient stock/,
  );
  const dashboard = await service.dashboard(session);
  assert.equal(dashboard.orders.find((o) => o.id === 'FR-1043')!.warehouseId, 'BUF');
  assert.equal(
    dashboard.inventory.find((i) => i.sku === 'SW-800' && i.warehouseId === 'BUF')!.reserved,
    2,
  );
});
test('an explicit override may accept a valid quote from an incomplete comparison', async () => {
  const order = await service.route(session, 'FR-1045', {
    warehouseId: 'BUF',
    reason: 'Proceed with the available quote for this urgent order.',
  });
  assert.equal(order.status, 'ALLOCATED');
  assert.equal(order.decision!.complete, false);
  assert.equal(order.decision!.savingsCents, 0);
});
test('two competing orders cannot reserve the same last unit', async () => {
  assert.match(await service.race(session), /1 allocated · 1 held/);
  const row = (await service.dashboard(session)).inventory.find(
    (i) => i.sku === 'LAB-001' && i.warehouseId === 'BUF',
  )!;
  assert.equal(row.available, 0);
  assert.equal(row.reserved, 1);
});
test('session boundaries prevent reading or routing another session order', async () => {
  await service.initialize('other');
  const order = await service.createOrder('other', {
    customer: 'Private sample',
    destinationId: 'SFO',
    items: [{ sku: 'PH-100', quantity: 2 }],
  });
  await assert.rejects(() => service.route(session, order.id), /not found/);
  assert.equal(
    (await service.dashboard(session)).orders.some((o) => o.id === order.id),
    false,
  );
});
test('input validation and duplicate SKU aggregation happen before reservation', async () => {
  await assert.rejects(() =>
    service.createOrder(session, {
      customer: 'Bad',
      destinationId: 'SFO',
      items: [{ sku: 'PH-100', quantity: -1 }],
    }),
  );
  await assert.rejects(() =>
    service.createOrder(session, {
      customer: 'Bad',
      destinationId: 'SFO',
      items: [{ sku: 'UNKNOWN', quantity: 1 }],
    }),
  );
  const order = await service.createOrder(session, {
    customer: 'Repeated line',
    destinationId: 'SFO',
    items: [
      { sku: 'PH-100', quantity: 2 },
      { sku: 'PH-100', quantity: 3 },
    ],
  });
  assert.deepEqual(order.items, [{ sku: 'PH-100', quantity: 5 }]);
});
test('tie-breaking is stable and preview does not reserve stock', async () => {
  const data = await service.dashboard(session);
  const result = await evaluate(
    data.orders.find((o) => o.id === 'FR-1042')!,
    data.inventory,
    { quote: async () => ({ costCents: 1000, transitDays: 2, distanceMiles: 500 }) },
  );
  assert.equal(result.selectedWarehouseId, 'BUF');
  await service.preview(session, 'FR-1042');
  assert.equal(
    (await service.dashboard(session)).inventory.reduce((sum, i) => sum + i.reserved, 0),
    0,
  );
});
test('SQL failure rolls back stock and order together', async () => {
  await assert.rejects(() =>
    db.transaction(async (tx) => {
      await tx.query(
        "UPDATE inventory SET reserved=3 WHERE session_id=$1 AND warehouse_id='BUF' AND sku='PH-100'",
        [session],
      );
      await tx.query(
        "UPDATE inventory SET reserved=9999 WHERE session_id=$1 AND warehouse_id='BUF' AND sku='HS-200'",
        [session],
      );
    }),
  );
  assert.equal(
    (await service.dashboard(session)).inventory.find(
      (i) => i.sku === 'PH-100' && i.warehouseId === 'BUF',
    )!.reserved,
    0,
  );
});
test('shipping simulator is deterministic and reacts to weight', async () => {
  const provider = new SimulatedShippingProvider();
  const light = await provider.quote('RNO', 'SFO', [{ sku: 'PH-100', quantity: 1 }]);
  assert.deepEqual(light, await provider.quote('RNO', 'SFO', [{ sku: 'PH-100', quantity: 1 }]));
  assert.ok(
    (await provider.quote('RNO', 'SFO', [{ sku: 'PH-100', quantity: 2 }])).costCents >
      light.costCents,
  );
});
test('GraphQL dashboard, nested relationships, mutation errors and budget', async () => {
  const api = createApi();
  await api.start();
  try {
    const result = await api.executeOperation(
      { query: dashboardQuery },
      { contextValue: { service, sessionId: session } },
    );
    assert.equal(result.body.kind, 'single');
    if (result.body.kind === 'single') {
      assert.equal(result.body.singleResult.errors, undefined);
      assert.ok(result.body.singleResult.data?.dashboard);
    }
    const nested = await api.executeOperation(
      { query: '{ dashboard { orders { destination { city } items { product { name } } } } }' },
      { contextValue: { service, sessionId: session } },
    );
    if (nested.body.kind === 'single') assert.equal(nested.body.singleResult.errors, undefined);
    const bad = await api.executeOperation(
      { query: 'mutation { routeOrder(id:"missing") { id } }' },
      { contextValue: { service, sessionId: session } },
    );
    if (bad.body.kind === 'single')
      assert.equal(bad.body.singleResult.errors?.[0].extensions?.code, 'NOT_FOUND');
    const oversized = await api.executeOperation(
      {
        query: `{ ${Array.from({ length: 201 }, (_, i) => `p${i}: products { sku }`).join(' ')} }`,
      },
      { contextValue: { service, sessionId: session } },
    );
    if (oversized.body.kind === 'single')
      assert.match(oversized.body.singleResult.errors?.[0].message ?? '', /limit/);
  } finally {
    await api.stop();
  }
});
