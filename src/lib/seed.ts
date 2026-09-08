import type { Sql } from './database';
import { PRODUCTS, type Order } from './model';

export async function seed(tx: Sql, sessionId: string) {
  const stock: Record<string, number[]> = {
    BUF: [45, 28, 14, 8, 1],
    RNO: [32, 40, 0, 6, 0],
  };
  for (const [warehouse, quantities] of Object.entries(stock)) {
    for (const [index, product] of PRODUCTS.entries()) {
      await tx.query(
        'INSERT INTO inventory(session_id,warehouse_id,sku,on_hand) VALUES($1,$2,$3,$4)',
        [sessionId, warehouse, product.sku, quantities[index]],
      );
    }
  }
  const orders: Pick<Order, 'id' | 'customer' | 'destinationId' | 'items' | 'scenario'>[] = [
    {
      id: 'FR-1041',
      customer: 'Hudson Studio',
      destinationId: 'NYC',
      items: [
        { sku: 'PH-100', quantity: 4 },
        { sku: 'HS-200', quantity: 2 },
      ],
      scenario: 'NORMAL',
    },
    {
      id: 'FR-1042',
      customer: 'Pacific Workshop',
      destinationId: 'SFO',
      items: [{ sku: 'PH-100', quantity: 6 }],
      scenario: 'NORMAL',
    },
    {
      id: 'FR-1043',
      customer: 'Cedar Office',
      destinationId: 'SEA',
      items: [{ sku: 'SW-800', quantity: 2 }],
      scenario: 'NORMAL',
    },
    {
      id: 'FR-1044',
      customer: 'Lakefront Supply',
      destinationId: 'CHI',
      items: [{ sku: 'GW-400', quantity: 20 }],
      scenario: 'NORMAL',
    },
    {
      id: 'FR-1045',
      customer: 'Summit Design',
      destinationId: 'DEN',
      items: [{ sku: 'HS-200', quantity: 3 }],
      scenario: 'QUOTE_OUTAGE',
    },
    {
      id: 'FR-1046',
      customer: 'Piedmont Works',
      destinationId: 'CLT',
      items: [
        { sku: 'GW-400', quantity: 2 },
        { sku: 'PH-100', quantity: 2 },
      ],
      scenario: 'NORMAL',
    },
  ];
  for (const [index, input] of orders.entries()) {
    const order: Order = {
      ...input,
      status: 'PENDING',
      warehouseId: null,
      decision: null,
      createdAt: new Date(Date.now() - (orders.length - index) * 180000).toISOString(),
    };
    await tx.query('INSERT INTO orders(session_id,id,data) VALUES($1,$2,$3::jsonb)', [
      sessionId,
      order.id,
      JSON.stringify(order),
    ]);
  }
  await tx.query(
    "INSERT INTO audit_events(session_id,action,detail) VALUES($1,'DEMO_READY','Six sample orders and two warehouses loaded. All customer data and rates are fictional.')",
    [sessionId],
  );
}
