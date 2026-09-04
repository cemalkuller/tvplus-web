import { iptvFetch } from './iptv-proxy.js';
import { CONFIG } from './config.js';
import { getDb } from './db.js';

export const catalogActions = ['', 'get_live_categories', 'get_live_streams', 'get_vod_categories', 'get_vod_streams', 'get_series_categories', 'get_series'];

export async function fetchCatalogAction(action = '') {
  const url = new URL(`${CONFIG.iptv.host.replace(/\/$/, '')}/player_api.php`);
  url.searchParams.set('username', CONFIG.iptv.username);
  url.searchParams.set('password', CONFIG.iptv.password);
  if (action) url.searchParams.set('action', action);
  const response = await iptvFetch(url, { signal: AbortSignal.timeout(120000), headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!response.ok) throw new Error(`IPTV HTTP ${response.status}`);
  const data = await response.json();
  if (action ? !Array.isArray(data) : Number(data?.user_info?.auth) !== 1) {
    throw new Error(`Invalid IPTV response: ${action || 'user-info'}`);
  }
  return data;
}

export async function readCatalogAction(action = '') {
  const params = new URLSearchParams(`action=${action}`);
  const key = params.get('action');
  if (!catalogActions.includes(key)) throw new Error('Catalog action unavailable');
  const [rows] = await getDb().query('SELECT payload FROM iptv_catalog_snapshot WHERE action_key = ?', [key]);
  if (!rows.length) throw new Error('IPTV catalog missing; import the local SQL snapshot first');
  const data = JSON.parse(rows[0].payload);
  const category = params.get('category_id');
  return category && Array.isArray(data) ? data.filter(item => String(item.category_id) === category) : data;
}
