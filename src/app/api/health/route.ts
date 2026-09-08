import { getDatabase } from '@/lib/database';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const db = await getDatabase();
    await db.query('SELECT 1');
    return Response.json({ status: 'ok', storage: db.mode, shipping: 'simulated' });
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503 });
  }
}
