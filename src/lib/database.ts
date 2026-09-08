import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface Sql {
  query<T>(text: string, params?: unknown[]): Promise<T[]>;
}
export interface Database extends Sql {
  transaction<T>(work: (tx: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  mode: string;
}

// Both adapters execute the same PostgreSQL statements and migrations.
export async function createDatabase(url?: string, directory?: string): Promise<Database> {
  if (url) {
    const pool = new Pool({ connectionString: url, max: 8 });
    return {
      mode: 'PostgreSQL',
      query: async <T>(text: string, params?: unknown[]) =>
        (await pool.query(text, params)).rows as T[],
      transaction: async <T>(work: (tx: Sql) => Promise<T>) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await work({
            query: async <R>(text: string, params?: unknown[]) =>
              (await client.query(text, params)).rows as R[],
          });
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  }
  if (directory) await mkdir(resolve(directory), { recursive: true });
  const pg = new PGlite(directory);
  await pg.waitReady;
  return {
    mode: 'Embedded PostgreSQL',
    query: async <T>(text: string, params?: unknown[]) => (await pg.query<T>(text, params)).rows,
    transaction: <T>(work: (tx: Sql) => Promise<T>) =>
      pg.transaction(async (tx) =>
        work({
          query: async <R>(text: string, params?: unknown[]) =>
            (await tx.query<R>(text, params)).rows,
        }),
      ),
    close: () => pg.close(),
  };
}

export async function migrate(db: Database) {
  await db.query(`CREATE TABLE IF NOT EXISTS demo_sessions (
    id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now()
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS inventory (
    session_id text NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
    warehouse_id text NOT NULL CHECK (warehouse_id IN ('BUF', 'RNO')),
    sku text NOT NULL, on_hand integer NOT NULL CHECK (on_hand >= 0),
    reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0 AND reserved <= on_hand),
    PRIMARY KEY (session_id, warehouse_id, sku)
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS orders (
    session_id text NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
    id text NOT NULL, data jsonb NOT NULL, PRIMARY KEY (session_id, id)
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS audit_events (
    id bigserial PRIMARY KEY, session_id text NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
    order_id text, action text NOT NULL, detail text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`);
  await db.query(
    'CREATE INDEX IF NOT EXISTS audit_session_idx ON audit_events(session_id, id DESC)',
  );
}

const globalDb = globalThis as unknown as { routingDb?: Promise<Database> };
export function getDatabase() {
  globalDb.routingDb ??= (async () => {
    const db = await createDatabase(
      process.env.DATABASE_URL,
      process.env.PGLITE_DATA_DIR || './.data/routing',
    );
    await migrate(db);
    return db;
  })();
  return globalDb.routingDb;
}
