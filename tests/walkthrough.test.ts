import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, migrate } from '../src/lib/database';
import { RoutingService } from '../src/lib/routing';

test('FR-1041 walkthrough prices, multi-item reservation, retries and release match the guide', async () => {
  const db = await createDatabase();
  const service = new RoutingService(db);
  const session = 'walkthrough-only';
  try {
    await migrate(db);
    await service.initialize(session);
    const before = await service.dashboard(session);
    const preview = await service.preview(session, 'FR-1041');
    assert.deepEqual(
      preview.candidates.map(({ warehouseId, costCents, transitDays, distanceMiles }) => ({
        warehouseId,
        costCents,
        transitDays,
        distanceMiles,
      })),
      [
        { warehouseId: 'BUF', costCents: 1812, transitDays: 1, distanceMiles: 292 },
        { warehouseId: 'RNO', costCents: 3326, transitDays: 4, distanceMiles: 2394 },
      ],
    );
    assert.equal(preview.savingsCents, 1514);
    assert.deepEqual((await service.dashboard(session)).inventory, before.inventory);
    await service.route(session, 'FR-1041');
    await service.route(session, 'FR-1041');
    const allocated = await service.dashboard(session);
    for (const row of allocated.inventory) {
      const expected = row.warehouseId === 'BUF' ? ({ 'PH-100': 4, 'HS-200': 2 }[row.sku] ?? 0) : 0;
      assert.equal(row.reserved, expected);
      assert.equal(row.available, row.onHand - expected);
      assert.equal(
        row.onHand,
        before.inventory.find(
          (original) => original.warehouseId === row.warehouseId && original.sku === row.sku,
        )!.onHand,
      );
    }
    assert.equal(allocated.orders.find((o) => o.id === 'FR-1041')!.warehouseId, 'BUF');
    await service.cancel(session, 'FR-1041');
    await service.cancel(session, 'FR-1041');
    const after = await service.dashboard(session);
    assert.deepEqual(after.inventory, before.inventory);
    const order = after.orders.find((o) => o.id === 'FR-1041')!;
    assert.equal(order.status, 'CANCELLED');
    assert.equal(order.warehouseId, null);
    assert.equal(order.decision!.selectedWarehouseId, 'BUF');
    assert.deepEqual(
      after.events.filter((e) => e.orderId === 'FR-1041').map((e) => e.action),
      ['CANCELLED', 'ALLOCATED'],
    );
  } finally {
    await db.close();
  }
});
