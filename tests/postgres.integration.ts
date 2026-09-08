import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDatabase, migrate } from '../src/lib/database';
import { RoutingService } from '../src/lib/routing';

test('separate PostgreSQL pools compete for one unit', async () => {
  assert.ok(process.env.DATABASE_URL, 'Set DATABASE_URL to a disposable PostgreSQL database.');
  const dbA = await createDatabase(process.env.DATABASE_URL);
  const dbB = await createDatabase(process.env.DATABASE_URL);
  const session = randomUUID();
  try {
    await migrate(dbA);
    const a = new RoutingService(dbA);
    const b = new RoutingService(dbB);
    await a.initialize(session);
    const input = {
      customer: 'Concurrent buyer',
      destinationId: 'NYC',
      items: [{ sku: 'LAB-001', quantity: 1 }],
    };
    const first = await a.createOrder(session, input);
    const second = await b.createOrder(session, input);
    const results = await Promise.all([a.route(session, first.id), b.route(session, second.id)]);
    assert.equal(results.filter((o) => o.status === 'ALLOCATED').length, 1);
    assert.equal(results.filter((o) => o.status === 'REVIEW').length, 1);
    const inventory = (await a.dashboard(session)).inventory.find(
      (i) => i.sku === 'LAB-001' && i.warehouseId === 'BUF',
    )!;
    assert.equal(inventory.reserved, 1);
    assert.equal(inventory.available, 0);
  } finally {
    await dbA.query('DELETE FROM demo_sessions WHERE id=$1', [session]);
    await Promise.all([dbA.close(), dbB.close()]);
  }
});
