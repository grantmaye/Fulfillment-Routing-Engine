import { getDatabase } from '../src/lib/database';
if (process.env.CONFIRM_RESET !== 'yes') {
  console.error(
    'Stop the app, then run CONFIRM_RESET=yes npm run db:reset to delete all demo sessions.',
  );
  process.exit(1);
}
const db = await getDatabase();
await db.query('DELETE FROM demo_sessions');
await db.close();
console.log('All demo sessions removed. Reload the app to create a fresh workspace.');
