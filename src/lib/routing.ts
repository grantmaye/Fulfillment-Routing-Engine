import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database, Sql } from './database';
import {
  DESTINATIONS,
  PRODUCTS,
  WAREHOUSES,
  type AuditEvent,
  type Candidate,
  type Dashboard,
  type Decision,
  type Inventory,
  type Order,
  type WarehouseId,
} from './model';
import { seed } from './seed';
import { SimulatedShippingProvider, type ShippingProvider } from './shipping';

export class RoutingError extends Error {
  constructor(
    message: string,
    public code = 'BAD_USER_INPUT',
  ) {
    super(message);
  }
}
const inputSchema = z.object({
  customer: z.string().trim().min(2).max(80),
  destinationId: z.enum(
    Object.keys(DESTINATIONS) as [keyof typeof DESTINATIONS, ...Array<keyof typeof DESTINATIONS>],
  ),
  items: z
    .array(
      z.object({
        sku: z.string().refine((s) => PRODUCTS.some((p) => p.sku === s), 'Unknown SKU'),
        quantity: z.number().int().min(1).max(1000),
      }),
    )
    .min(1)
    .max(10),
});

export async function inventoryFor(tx: Sql, sessionId: string): Promise<Inventory[]> {
  return tx.query<Inventory>(
    `SELECT warehouse_id AS "warehouseId", sku, on_hand AS "onHand", reserved,
    on_hand-reserved AS available FROM inventory WHERE session_id=$1 ORDER BY warehouse_id,sku`,
    [sessionId],
  );
}
async function orderFor(tx: Sql, sessionId: string, id: string): Promise<Order> {
  const rows = await tx.query<{ data: Order }>(
    'SELECT data FROM orders WHERE session_id=$1 AND id=$2',
    [sessionId, id],
  );
  if (!rows.length) throw new RoutingError('Order not found in this demo session.', 'NOT_FOUND');
  return rows[0].data;
}
async function save(tx: Sql, sessionId: string, order: Order) {
  await tx.query('UPDATE orders SET data=$3::jsonb WHERE session_id=$1 AND id=$2', [
    sessionId,
    order.id,
    JSON.stringify(order),
  ]);
}
async function event(
  tx: Sql,
  sessionId: string,
  orderId: string | null,
  action: string,
  detail: string,
) {
  await tx.query(
    'INSERT INTO audit_events(session_id,order_id,action,detail) VALUES($1,$2,$3,$4)',
    [sessionId, orderId, action, detail],
  );
}

export async function evaluate(
  order: Order,
  inventory: Inventory[],
  provider: ShippingProvider,
): Promise<Decision> {
  const candidates: Candidate[] = await Promise.all(
    WAREHOUSES.map(async (warehouse) => {
      const stock = order.items.map((item) => {
        const row = inventory.find((i) => i.warehouseId === warehouse.id && i.sku === item.sku);
        // An existing allocation owns its reservation and can be reevaluated safely.
        const owned =
          order.status === 'ALLOCATED' && order.warehouseId === warehouse.id ? item.quantity : 0;
        return {
          sku: item.sku,
          requested: item.quantity,
          available: (row?.available ?? 0) + owned,
        };
      });
      const base = {
        warehouseId: warehouse.id,
        stock,
        costCents: null,
        transitDays: null,
        distanceMiles: 0,
      };
      const shortage = stock.find((item) => item.available < item.requested);
      if (shortage)
        return {
          ...base,
          eligible: false,
          reason: `${shortage.sku}: needs ${shortage.requested}, only ${shortage.available} available.`,
        };
      try {
        const quote = await provider.quote(warehouse.id, order.destinationId, order.items);
        return {
          ...base,
          ...quote,
          eligible: true,
          reason: 'All items available. Simulated ground quote received.',
        };
      } catch {
        return {
          ...base,
          eligible: true,
          reason: 'Shipping quote unavailable. Comparison is incomplete.',
        };
      }
    }),
  );
  const eligible = candidates.filter((c) => c.eligible);
  const complete = eligible.every((c) => c.costCents !== null);
  const ranked = eligible
    .filter((c) => c.costCents !== null)
    .sort((a, b) => a.costCents! - b.costCents! || a.warehouseId.localeCompare(b.warehouseId));
  const selected = complete ? ranked[0] : undefined;
  return {
    evaluatedAt: new Date().toISOString(),
    candidates,
    complete,
    selectedWarehouseId: selected?.warehouseId ?? null,
    savingsCents: selected && ranked.length === 2 ? ranked[1].costCents! - selected.costCents! : 0,
    policyVersion: 'single-warehouse-v1',
    reason: !eligible.length
      ? 'No warehouse can fulfill the complete order.'
      : !complete
        ? 'Held for review: a shipping quote is unavailable.'
        : ranked.length === 1
          ? `${selected!.warehouseId} is the only warehouse with sufficient stock.`
          : `Lowest eligible shipping cost. Ties resolve by warehouse code.`,
  };
}

export class RoutingService {
  constructor(
    public readonly db: Database,
    private readonly providerFactory: (order: Order) => ShippingProvider = (order) =>
      new SimulatedShippingProvider(order.scenario === 'QUOTE_OUTAGE' ? ['RNO'] : []),
  ) {}

  async initialize(sessionId: string) {
    await this.db.transaction(async (tx) => {
      const inserted = await tx.query(
        'INSERT INTO demo_sessions(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id',
        [sessionId],
      );
      if (inserted.length) await seed(tx, sessionId);
    });
  }
  // A session lock intentionally serializes inventory mutations within one demo.
  // External carrier requests never run while this lock is held.
  private async locked<T>(sessionId: string, work: (tx: Sql) => Promise<T>) {
    return this.db.transaction(async (tx) => {
      const rows = await tx.query('SELECT id FROM demo_sessions WHERE id=$1 FOR UPDATE', [
        sessionId,
      ]);
      if (!rows.length)
        throw new RoutingError('Demo session expired. Reload the page.', 'NOT_FOUND');
      return work(tx);
    });
  }
  async dashboard(sessionId: string): Promise<Dashboard> {
    // Taking the same lock yields a coherent snapshot across all three reads.
    return this.locked(sessionId, async (tx) => ({
      orders: (
        await tx.query<{ data: Order }>(
          "SELECT data FROM orders WHERE session_id=$1 ORDER BY data->>'createdAt' DESC,id",
          [sessionId],
        )
      ).map((r) => r.data),
      inventory: await inventoryFor(tx, sessionId),
      events: await tx.query<AuditEvent>(
        'SELECT id::text,id::text AS "eventId",order_id AS "orderId",action,detail,created_at::text AS "createdAt" FROM audit_events WHERE session_id=$1 ORDER BY id DESC LIMIT 100',
        [sessionId],
      ),
      storageMode: this.db.mode,
    }));
  }
  async createOrder(sessionId: string, input: unknown) {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success)
      throw new RoutingError(parsed.error.issues.map((i) => i.message).join('; '));
    const quantities = new Map<string, number>();
    for (const item of parsed.data.items)
      quantities.set(item.sku, (quantities.get(item.sku) ?? 0) + item.quantity);
    if ([...quantities.values()].some((q) => q > 1000))
      throw new RoutingError('Maximum quantity per SKU is 1000.');
    const order: Order = {
      ...parsed.data,
      items: [...quantities].map(([sku, quantity]) => ({ sku, quantity })),
      id: `FR-${randomUUID().slice(0, 8).toUpperCase()}`,
      status: 'PENDING',
      warehouseId: null,
      decision: null,
      scenario: 'NORMAL',
      createdAt: new Date().toISOString(),
    };
    return this.locked(sessionId, async (tx) => {
      const [{ count }] = await tx.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM orders WHERE session_id=$1',
        [sessionId],
      );
      if (count >= 100)
        throw new RoutingError('Demo limit reached. Reset the workspace to create more orders.');
      await tx.query('INSERT INTO orders(session_id,id,data) VALUES($1,$2,$3::jsonb)', [
        sessionId,
        order.id,
        JSON.stringify(order),
      ]);
      await event(tx, sessionId, order.id, 'CREATED', 'Order received for routing.');
      return order;
    });
  }
  async preview(sessionId: string, id: string) {
    const order = await orderFor(this.db, sessionId, id);
    return evaluate(order, await inventoryFor(this.db, sessionId), this.providerFactory(order));
  }
  async route(
    sessionId: string,
    id: string,
    override?: { warehouseId: WarehouseId; reason: string },
  ) {
    if (
      override &&
      (!WAREHOUSES.some((w) => w.id === override.warehouseId) ||
        override.reason.trim().length < 8 ||
        override.reason.length > 300)
    )
      throw new RoutingError(
        'Choose a warehouse and provide an override reason of 8–300 characters.',
      );
    const original = await orderFor(this.db, sessionId, id);
    if (original.status === 'CANCELLED')
      throw new RoutingError('Cancelled orders cannot be routed.');
    if (original.status === 'ALLOCATED' && !override) return original;
    // Capture carrier results before locking, then reuse them during the stock recheck.
    const provider = this.providerFactory(original);
    const quotes = await Promise.all(
      WAREHOUSES.map(async (w) => {
        try {
          return [
            w.id,
            await provider.quote(w.id, original.destinationId, original.items),
          ] as const;
        } catch {
          return [w.id, null] as const;
        }
      }),
    );
    const captured: ShippingProvider = {
      quote: async (id) => {
        const quote = quotes.find(([warehouseId]) => warehouseId === id)?.[1];
        if (!quote) throw new Error('Quote unavailable');
        return quote;
      },
    };
    return this.locked(sessionId, async (tx) => {
      const order = await orderFor(tx, sessionId, id);
      if (order.status === 'CANCELLED')
        throw new RoutingError('Cancelled orders cannot be routed.');
      if (order.status === 'ALLOCATED' && !override) return order;
      const decision = await evaluate(order, await inventoryFor(tx, sessionId), captured);
      const selectedId = override?.warehouseId ?? decision.selectedWarehouseId;
      const selected = decision.candidates.find((c) => c.warehouseId === selectedId);
      if (override && (!selected?.eligible || selected.costCents === null))
        throw new RoutingError(
          'Override requires sufficient stock and an available shipping quote.',
        );
      if (!selectedId || !selected) {
        order.status = 'REVIEW';
        order.decision = decision;
        await save(tx, sessionId, order);
        await event(tx, sessionId, id, 'REVIEW', decision.reason);
        return order;
      }
      if (order.status === 'ALLOCATED') {
        for (const item of order.items)
          await tx.query(
            'UPDATE inventory SET reserved=reserved-$4 WHERE session_id=$1 AND warehouse_id=$2 AND sku=$3',
            [sessionId, order.warehouseId, item.sku, item.quantity],
          );
      }
      for (const item of [...order.items].sort((a, b) => a.sku.localeCompare(b.sku))) {
        const reserved = await tx.query(
          'UPDATE inventory SET reserved=reserved+$4 WHERE session_id=$1 AND warehouse_id=$2 AND sku=$3 AND on_hand-reserved >= $4 RETURNING sku',
          [sessionId, selectedId, item.sku, item.quantity],
        );
        if (!reserved.length)
          throw new RoutingError('Stock changed. Retry the routing decision.', 'CONFLICT');
      }
      order.status = 'ALLOCATED';
      order.warehouseId = selectedId;
      order.decision = {
        ...decision,
        selectedWarehouseId: selectedId,
        savingsCents: override ? 0 : decision.savingsCents,
        reason: override ? `Manual override: ${override.reason.trim()}` : decision.reason,
      };
      await save(tx, sessionId, order);
      await event(
        tx,
        sessionId,
        id,
        override ? 'OVERRIDDEN' : 'ALLOCATED',
        `${selectedId} · $${(selected.costCents! / 100).toFixed(2)} simulated shipping. ${order.decision.reason}`,
      );
      return order;
    });
  }
  async cancel(sessionId: string, id: string) {
    return this.locked(sessionId, async (tx) => {
      const order = await orderFor(tx, sessionId, id);
      if (order.status === 'CANCELLED') return order;
      if (order.status === 'ALLOCATED')
        for (const item of order.items)
          await tx.query(
            'UPDATE inventory SET reserved=reserved-$4 WHERE session_id=$1 AND warehouse_id=$2 AND sku=$3',
            [sessionId, order.warehouseId, item.sku, item.quantity],
          );
      order.status = 'CANCELLED';
      order.warehouseId = null;
      await save(tx, sessionId, order);
      await event(
        tx,
        sessionId,
        id,
        'CANCELLED',
        'Order cancelled; any reserved inventory was released. Previous decision retained for reference.',
      );
      return order;
    });
  }
  async reset(sessionId: string) {
    await this.locked(sessionId, async (tx) => {
      await tx.query('DELETE FROM orders WHERE session_id=$1', [sessionId]);
      await tx.query('DELETE FROM inventory WHERE session_id=$1', [sessionId]);
      await tx.query('DELETE FROM audit_events WHERE session_id=$1', [sessionId]);
      await seed(tx, sessionId);
    });
    return true;
  }
  async race(sessionId: string) {
    const orders = await this.locked(sessionId, async (tx) => {
      const [{ available }] = await tx.query<{ available: number }>(
        "SELECT on_hand-reserved AS available FROM inventory WHERE session_id=$1 AND warehouse_id='BUF' AND sku='LAB-001'",
        [sessionId],
      );
      if (available !== 1)
        throw new RoutingError(
          'The last-unit demo has already run. Reset the workspace to run it again.',
        );
      const result: Order[] = [];
      for (const label of ['A', 'B']) {
        const order: Order = {
          id: `RACE-${randomUUID().slice(0, 8)}`,
          customer: `Concurrency check ${label}`,
          destinationId: 'NYC',
          items: [{ sku: 'LAB-001', quantity: 1 }],
          scenario: 'NORMAL',
          status: 'PENDING',
          warehouseId: null,
          decision: null,
          createdAt: new Date().toISOString(),
        };
        await tx.query('INSERT INTO orders(session_id,id,data) VALUES($1,$2,$3::jsonb)', [
          sessionId,
          order.id,
          JSON.stringify(order),
        ]);
        result.push(order);
      }
      return result;
    });
    const results = await Promise.all(orders.map((order) => this.route(sessionId, order.id)));
    return `${results.filter((o) => o.status === 'ALLOCATED').length} allocated · ${results.filter((o) => o.status === 'REVIEW').length} held for review · stock never below zero.`;
  }
}
