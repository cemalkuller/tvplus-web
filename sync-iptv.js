import './config.js';
import { initDatabase } from './db.js';
import { catalogActions, fetchCatalogAction } from './iptv-catalog.js';

let pool;
let connection;
try {
  // Finish fetching before replacing any stored catalog data.
  const snapshots = [];
  for (const action of catalogActions) {
    const data = await fetchCatalogAction(action);
    snapshots.push([action, JSON.stringify(data)]);
    console.log(`${action || 'user-info'}: ${Array.isArray(data) ? data.length : 1} records`);
  }
  pool = await initDatabase();
  connection = await pool.getConnection();
  await connection.beginTransaction();
  for (const [action, payload] of snapshots) {
    await connection.query('INSERT INTO iptv_catalog_snapshot (action_key, payload) VALUES (?, ?) ON DUPLICATE KEY UPDATE payload = VALUES(payload), fetched_at = CURRENT_TIMESTAMP', [action, payload]);
  }
  await connection.commit();
  console.log('Catalog saved to MySQL.');
} catch (error) {
  if (connection) await connection.rollback();
  console.error('Catalog sync failed:', error.cause?.code || error.name);
  process.exitCode = 1;
} finally {
  connection?.release();
  if (pool) await pool.end();
}
