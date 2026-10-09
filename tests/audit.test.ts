import { test } from 'node:test';
import { createDatabase, migrate } from '../src/lib/database';
import { assertRecentAuditHistory } from './audit-history';

test('audit history returns the newest 100 events across numeric ID boundaries', async () => {
  const db = await createDatabase();
  try {
    await migrate(db);
    await assertRecentAuditHistory(db);
  } finally {
    await db.close();
  }
});
