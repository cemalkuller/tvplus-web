import './config.js';
import { ProxyAgent, fetch } from 'undici';

const proxyUrl = process.env.IPTV_PROXY_URL?.trim();
let dispatcher;
if (proxyUrl) {
  const url = new URL(proxyUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('IPTV_PROXY_URL must use HTTP or HTTPS');
  const credentials = url.username ? `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}` : '';
  url.username = '';
  url.password = '';
  dispatcher = new ProxyAgent({ uri: url.href, ...(credentials ? { token: `Basic ${Buffer.from(credentials).toString('base64')}` } : {}) });
}

console.info(`[IPTV Proxy] mode=${dispatcher ? 'proxy' : 'direct'}`);

export async function iptvFetch(url, options = {}) {
  const started = Date.now();
  const target = new URL(url);
  // Paths and query strings may contain IPTV credentials. Never log them.
  const context = { mode: dispatcher ? 'proxy' : 'direct', host: target.host };
  try {
    const response = await fetch(url, { ...options, ...(dispatcher ? { dispatcher } : {}) });
    if (!response.ok || process.env.IPTV_PROXY_DEBUG === 'true') {
      console.info('[IPTV Request]', JSON.stringify({ ...context, status: response.status, ms: Date.now() - started }));
    }
    return response;
  } catch (error) {
    console.error('[IPTV Request]', JSON.stringify({ ...context, error: error.name, code: error.cause?.code || error.code || 'UNKNOWN', ms: Date.now() - started }));
    throw error;
  }
}

export function proxyInputArgs() {
  return proxyUrl ? ['-http_proxy', proxyUrl] : [];
}

export async function closeProxy() {
  await dispatcher?.close();
}
