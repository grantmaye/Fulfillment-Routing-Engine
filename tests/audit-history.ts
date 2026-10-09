import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Database } from '../src/lib/database';
import { RoutingService } from '../src/lib/routing';

// Shared contract: exercise the actual dashboard SQL on both database adapters.
export async function assertRecentAuditHistory(db: Database) {
  const session = randomUUID();
  const otherSession = randomUUID();
  const service = new RoutingService(db);
  try {
    await service.initialize(session);
    const inserted = await db.query<{ id: string; detail: string }>(
      `INSERT INTO audit_events(session_id, action, detail, created_at)
       SELECT $1, 'HISTORY_TEST', 'Event ' || n, '2026-01-01T00:00:00Z'::timestamptz
       FROM generate_series(1, 125) AS n
       RETURNING id::text, detail`,
      [session],
    );
    // A later event from another workspace must not leak into this history.
    await service.initialize(otherSession);
    const expected = inserted.sort((a, b) => (BigInt(a.id) > BigInt(b.id) ? -1 : 1)).slice(0, 100);
    assert.ok(expected.every((event) => BigInt(event.id) > 9n));
    const actual = (await service.dashboard(session)).events;
    assert.equal(actual.length, 100);
    assert.deepEqual(
      actual.map(({ id, detail }) => ({ id, detail })),
      expected,
      'history must contain the newest 100 numeric IDs in descending order',
    );
    assert.ok(actual.every((event) => event.action === 'HISTORY_TEST'));
  } finally {
    await db.query('DELETE FROM demo_sessions WHERE id=$1 OR id=$2', [session, otherSession]);
  }
}
