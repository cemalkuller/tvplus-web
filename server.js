import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import { spawn } from 'child_process';
import QRCode from 'qrcode';
import { CONFIG, saveEnvFile } from './config.js';
import { initDatabase, getDb } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_FILE = path.join(__dirname, 'iptv_cache.json');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// Process crash protection (AbortError and client disconnects)
process.on('uncaughtException', (err) => {
  if (err.name === 'AbortError' || err.code === 'ECONNRESET' || err.code === 'EPIPE' || err.message?.includes('aborted')) {
    return;
  }
  console.error('[Beklenmeyen Hata]', err);
});

process.on('unhandledRejection', (reason) => {
  if (reason?.name === 'AbortError' || reason?.message?.includes('aborted')) {
    return;
  }
  console.error('[İşlenmeyen Rejection]', reason);
});

// Cache storage
const cache = {
  userInfo: null,
  categories: null,
  streams: null,
  categoryCounts: {},
  lastFetched: 0
};

// URL Obfuscation helpers (base64url)
function encodeTargetUrl(url) {
  return Buffer.from(url, 'utf-8').toString('base64url');
}

function decodeTargetUrl(encoded) {
  return Buffer.from(encoded, 'base64url').toString('utf-8');
}

// Helper: Fetch from IPTV Xtream API
async function fetchFromXtream(action = '') {
  const { host, username, password } = CONFIG.iptv;
  let url = `${host}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
  if (action) {
    if (action.includes('&')) {
      url += `&action=${action}`;
    } else {
      url += `&action=${encodeURIComponent(action)}`;
    }
  }

  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
  });

  if (!response.ok) {
    throw new Error(`Xtream API hatası: ${response.status} ${response.statusText}`);
  }
  return await response.json();
}

// Kanal, Kategori, Dizi, Film ve Bölüm isimlerini temizle ve profesyonel formata çevir
function cleanName(str, type = 'general', seriesContext = '') {
  if (!str) return '';
  let s = String(str).trim();

  // 1. Sansür düzeltmeleri (b**n -> beIN)
  s = s.replace(/b\*{1,4}n/gi, 'beIN')
       .replace(/b\*{1,4}in/gi, 'beIN')
       .replace(/s\*{1,4}r/gi, 'SPOR');

  if (type === 'episode') {
    // Dizi bölümü: Dizi adını baştan temizle
    if (seriesContext) {
      const cleanSeries = seriesContext.replace(/\(\d{4}\)/g, '').trim();
      const esc = cleanSeries.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      s = s.replace(new RegExp('^' + esc, 'i'), '');
    }
    // 'S01E01', 'S1E1', '01x01', '1x01' etiketleri sonrasını al
    s = s.replace(/^.*?\bS\d+\s*E\d+\b\s*[-–—:]*\s*/i, '');
    s = s.replace(/^.*?\b\d+x\d+\b\s*[-–—:]*\s*/i, '');
    s = s.replace(/^[\s\-–—:|•]+/, '').trim();

    // Dil ve format etiketlerini temizle
    s = s.replace(/\b(TR\s*YERL[İI]|TR\s*DUBLAJ|TR\s*ALTYAZI(LI)?|DUBLAJ|ALTYAZILI?|YERL[İI])\b/gi, '');
    s = s.replace(/\(\d{4}\)/g, '');
    s = s.replace(/^[\s\-–—:|•]+/, '').replace(/[\s\-–—:|•]+$/, '').trim();

    return s || '';
  }

  // Film ve Dizi başlıkları için
  if (type === 'movie' || type === 'series') {
    // Tarihleri temizle: '03.09.2026'
    s = s.replace(/\b\d{2}\.\d{2}\.\d{4}\b/g, '');
    // Yıldız ve dekoratif karakterler: '⭐⭐'
    s = s.replace(/[⭐★✦●⚡️🔥✨]+/g, '');
    // Sezon finali / Vizyon etiketleri
    s = s.replace(/\b(SEZON\s*F[İI]NAL[İI]|F[İI]NAL|YEN[İI]|V[İI]ZYON)\b/gi, '');
    // Dil etiketleri: 'TR-EN', 'TR YERLİ', 'TR DUBLAJ', 'TR ALTYAZILI', 'TR', 'EN'
    s = s.replace(/\b(TR-EN|EN-TR|TR\s*YERL[İI]|TR\s*DUBLAJ|TR\s*ALTYAZI(LI)?|DUBLAJ|ALTYAZILI?|YERL[İI])\b/gi, '');
    s = s.replace(/\s+TR\b/g, '');
    // Çözünürlük ve kodek etiketleri (sonda yer alan)
    s = s.replace(/\b(UHD\s*2160p|2160p|1080p|720p|4K|UHD|FHD|HD|SD|HEVC|H\.?265|H\.?264|BluRay|WEB-DL|WEBRip|DVDRip)\b/gi, '');
    // Köşeli parantez içindeki gereksizler: '[...]'
    s = s.replace(/\[[^\]]*\]/g, '');
    // Yayın yılını başlıktan kaldır; ayrı `year` alanında tutulur.
    s = s.replace(/[\[(]\s*(19\d{2}|20\d{2})\s*[\])]/g, '');
    s = s.replace(/(?:\s|[-–—|:])+(19\d{2}|20\d{2})\s*$/g, '');
    // Boş parantezleri temizle: '()'
    s = s.replace(/\(\s*\)/g, '');
    // Baş ve sondaki tire ve boşlukları temizle
    s = s.replace(/^[\s\-–—:|•]+/, '').replace(/[\s\-–—:|•]+$/, '').trim();
    s = s.replace(/\s{2,}/g, ' ');
    return s;
  }

  // Kanal ve Kategori isimleri için
  if (type === 'channel' || type === 'category') {
    // Dekoratif başlık kanalları: '✦●✦ ULUSAL ✦●✦'
    s = s.replace(/[✦●★⭐⚡️🔥✨]+/g, '').trim();
    // 'TR: ', 'TR | ', 'TR - ' gibi önekleri kaldır
    s = s.replace(/^(TR\s*[:|–—-]\s*|VIP\s*[:|–—-]\s*)/i, '');
    // 'COCUK 7/24 | ' gibi kategori öneklerini sadeleştir
    if (s.includes('|')) {
      const parts = s.split('|').map(p => p.trim()).filter(Boolean);
      s = parts[parts.length - 1]; // Son kısmı al (kanal adı)
    }
    // Kalite eklerini temizle (TRT 4K gibi kanal adı olan 4K'yı koru)
    s = s.replace(/\b(UHD\s*2160p|2160p|1080p|720p|UHD|FHD|HD|SD|HEVC|H\.?265|H\.?264|50FPS|60FPS|RAW|YEDEK)\b/gi, '');
    // Köşeli parantezleri temizle: '[SIYAH BEYAZ]' -> '(Siyah Beyaz)'
    s = s.replace(/\[(.*?)\]/g, '($1)');
    s = s.replace(/\(\s*\)/g, '');
    s = s.replace(/^[\s\-–—:|•]+/, '').replace(/[\s\-–—:|•]+$/, '').trim();
    s = s.replace(/\s{2,}/g, ' ');
    return s;
  }

  return s;
}

// Kategori sıralama önceliği (Canlı TV kanallarını öne al, VOD/Dizi dosyalarını ve yetişkin içerikleri sona at)
function sortCategories(cats) {
  const priorityKeywords = ['ULUSAL', 'HABER', 'SPOR', 'SINEMA', 'BELGESEL', 'COCUK', 'YEREL'];
  return [...cats].map(c => ({
    ...c,
    category_name: cleanName(c.category_name)
  })).sort((a, b) => {
    const nameA = (a.category_name || '').toUpperCase();
    const nameB = (b.category_name || '').toUpperCase();

    // XXX her zaman en sonda
    if (nameA.includes('XXX') && !nameB.includes('XXX')) return 1;
    if (!nameA.includes('XXX') && nameB.includes('XXX')) return -1;

    // Dizi son bölümler VOD olduğu için arkaya
    if (nameA.includes('DIZI SON') && !nameB.includes('DIZI SON')) return 1;
    if (!nameA.includes('DIZI SON') && nameB.includes('DIZI SON')) return -1;

    const idxA = priorityKeywords.findIndex(k => nameA.includes(k));
    const idxB = priorityKeywords.findIndex(k => nameB.includes(k));

    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;

    return nameA.localeCompare(nameB, 'tr');
  });
}

// Kanalları sırala (Ulusal ve Canlı TV kanalları ilk sırada gelsin)
function sortStreams(streams, sortedCats) {
  const catOrder = {};
  sortedCats.forEach((c, idx) => {
    catOrder[String(c.category_id)] = idx;
  });

  return streams
    .filter(s => {
      const n = (s.name || '').trim();
      return !n.includes('✦') && !n.includes('●') && !n.includes('===') && !n.includes('---') && !n.includes('***') && !n.includes('###');
    })
    .map(s => ({
      ...s,
      name: cleanName(s.name, 'channel')
    })).sort((a, b) => {
    const orderA = catOrder[String(a.category_id)] ?? 999;
    const orderB = catOrder[String(b.category_id)] ?? 999;

    if (orderA !== orderB) {
      return orderA - orderB;
    }

    return (parseInt(a.num) || 9999) - (parseInt(b.num) || 9999);
  });
}

// 1 Günlük Disk Önbelleği Yükleme
function loadCacheFromDisk() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      const age = Date.now() - (data.lastFetched || 0);

      if (age < CONFIG.cacheTTL && data.streams && data.streams.length > 0) {
        cache.userInfo = data.userInfo;
        cache.categories = sortCategories(data.categories || []);
        cache.streams = sortStreams(data.streams || [], cache.categories);
        cache.categoryCounts = data.categoryCounts;
        cache.lastFetched = data.lastFetched;
        
        const hoursLeft = Math.round((CONFIG.cacheTTL - age) / (1000 * 60 * 60));
        console.log(`[Önbellek] ✅ 1 Günlük disk önbelleği yüklendi! (${cache.streams.length} kanal, kalan süre: ~${hoursLeft} saat)`);
        return true;
      }
    }
  } catch (err) {
    console.warn('[Önbellek] Disk önbelleği okuma hatası:', err.message);
  }
  return false;
}

// 1 Günlük Disk Önbelleği Kaydetme
function saveCacheToDisk() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify({
      lastFetched: cache.lastFetched,
      userInfo: cache.userInfo,
      categories: cache.categories,
      streams: cache.streams,
      categoryCounts: cache.categoryCounts
    }), 'utf-8');
    console.log(`[Önbellek] 💾 ${cache.streams.length} kanal diske (iptv_cache.json) kaydedildi.`);
  } catch (err) {
    console.error('[Önbellek] Diske kaydetme hatası:', err.message);
  }
}

// Verileri Güncelle veya Önbellekten Al
async function getOrUpdateData(force = false) {
  const now = Date.now();
  if (!force && cache.lastFetched && (now - cache.lastFetched < CONFIG.cacheTTL) && cache.streams?.length) {
    return;
  }

  if (!force && loadCacheFromDisk()) {
    return;
  }

  try {
    console.log('[Sunucu] Uzak IPTV sunucusundan güncel kanal listesi çekiliyor...');
    const [infoData, categoriesData, streamsData] = await Promise.all([
      fetchFromXtream(''),
      fetchFromXtream('get_live_categories'),
      fetchFromXtream('get_live_streams')
    ]);

    const sortedCats = sortCategories(categoriesData || []);
    const sortedStrs = sortStreams(streamsData || [], sortedCats);

    cache.userInfo = infoData;
    cache.categories = sortedCats;
    cache.streams = sortedStrs;

    const counts = {};
    for (const stream of cache.streams) {
      const catId = stream.category_id || 'other';
      counts[catId] = (counts[catId] || 0) + 1;
    }
    cache.categoryCounts = counts;
    cache.lastFetched = Date.now();

    saveCacheToDisk();
    console.log(`[Sunucu] Başarıyla yüklendi: ${cache.categories.length} kategori, ${cache.streams.length} kanal.`);
  } catch (err) {
    console.error('[Sunucu] IPTV veri çekme hatası:', err.message);
    if (!cache.streams && fs.existsSync(CACHE_FILE)) {
      try {
        const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
        cache.userInfo = data.userInfo;
        cache.categories = sortCategories(data.categories || []);
        cache.streams = sortStreams(data.streams || [], cache.categories);
        cache.categoryCounts = data.categoryCounts;
        cache.lastFetched = data.lastFetched;
      } catch (e) {
        throw err;
      }
    } else if (!cache.streams) {
      throw err;
    }
  }
}

// -------------------------------------------------------------
// STREAM PROXY ENGINE (GİZLİ & HIZLI HLS AKIŞI)
// -------------------------------------------------------------

// 1. HLS Master / Chunklist Proxy (.m3u8)
app.get(['/stream/:id.m3u8', '/stream/variant'], async (req, res) => {
  try {
    let targetUrl;
    const { id } = req.params;

    if (req.path === '/stream/variant') {
      const { u } = req.query;
      if (!u) return res.status(400).send('Eksik parametre');
      targetUrl = decodeTargetUrl(u);
    } else {
      const { host, username, password } = CONFIG.iptv;
      targetUrl = `${host}/live/${username}/${password}/${id}.m3u8`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000); // 20 sn zaman aşımı

    const upstreamRes = await fetch(targetUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });

    clearTimeout(timeout);

    if (!upstreamRes.ok) {
      return res.status(upstreamRes.status).send('Yayın akışı sunucudan alınamadı.');
    }

    const finalUrl = upstreamRes.url.toLowerCase();
    const contentType = (upstreamRes.headers.get('content-type') || '').toLowerCase();
    const contentLength = parseInt(upstreamRes.headers.get('content-length') || '0', 10);

    // VOD dosya kontrolü: .mkv, .mp4 veya büyük video dosyasıysa kesinlikle .text() ile RAM'e çekme!
    if (
      finalUrl.endsWith('.mkv') ||
      finalUrl.endsWith('.mp4') ||
      finalUrl.endsWith('.avi') ||
      contentLength > 1024 * 1024 || // > 1MB bir M3U8 olamaz
      contentType.includes('video/x-matroska') ||
      contentType.includes('video/mp4') ||
      (contentType.includes('application/octet-stream') && !finalUrl.includes('.m3u8'))
    ) {
      console.warn(`[Proxy] Kanal ${id || ''} canlı HLS değil, video dosyası (${finalUrl}). İptal edildi.`);
      return res.status(415).send('Bu içerik canlı TV yayını değildir, video dosyasıdır.');
    }

    const manifestText = await upstreamRes.text();

    // Manifest içindeki parçacıkları (/hls/... veya segment.ts) yerel proxy'e yönlendir
    const lines = manifestText.split(/\r?\n/);
    const rewrittenLines = lines.map(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        return line;
      }

      const resolvedUrl = new URL(trimmed, upstreamRes.url).href;
      const encoded = encodeTargetUrl(resolvedUrl);

      if (trimmed.includes('.m3u8')) {
        return `/stream/variant?u=${encoded}`;
      } else {
        return `/stream/seg?u=${encoded}`;
      }
    });

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(rewrittenLines.join('\n'));
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn('[Stream Proxy] İstek zaman aşımına uğradı (20s).');
      return res.status(504).send('Yayın sunucusu yanıt vermedi (Zaman aşımı).');
    }
    console.error('[Stream Proxy Hatası]', err.message);
    res.status(500).send('Proxy hatası: ' + err.message);
  }
});

// 2. Video Segment Proxy (.ts Chunks)
app.get('/stream/seg', async (req, res) => {
  try {
    const { u } = req.query;
    if (!u) return res.status(400).send('Eksik segment parametresi');

    const targetUrl = decodeTargetUrl(u);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000); // 45 sn zaman aşımı (32MB parçalar için)
    req.on('close', () => controller.abort());

    const segRes = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });

    clearTimeout(timeout);

    if (!segRes.ok) {
      return res.status(segRes.status).send('Segment alınamadı');
    }

    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    if (segRes.body) {
      const nodeStream = Readable.fromWeb(segRes.body);
      nodeStream.on('error', () => {}); // Client veya Abort hatalarını yut
      res.on('error', () => {});
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('[Segment Hatası]', err.message);
      if (!res.headersSent) res.status(500).send('Segment aktarım hatası');
    }
  }
});

// 3. Raw MPEG-TS Stream Proxy
app.get('/live/:id.ts', async (req, res) => {
  try {
    const { id } = req.params;
    const { host, username, password } = CONFIG.iptv;
    const targetUrl = `${host}/${username}/${password}/${id}`;

    const controller = new AbortController();
    req.on('close', () => controller.abort());

    const upstreamRes = await fetch(targetUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'VLC/3.0.18' }
    });

    if (!upstreamRes.ok) {
      return res.status(upstreamRes.status).send('Canlı TS akışı alınamadı');
    }

    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (upstreamRes.body) {
      const nodeStream = Readable.fromWeb(upstreamRes.body);
      nodeStream.on('error', () => {});
      res.on('error', () => {});
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('[Live TS Hatası]', err.message);
      if (!res.headersSent) res.status(500).send('Canlı akış hatası');
    }
  }
});

// 4. VOD Film & Dizi Medya Akışı Proxy (HTTP 206 Range Destekli)
async function proxyMediaStream(req, res, targetUrl) {
  try {
    const controller = new AbortController();
    req.on('close', () => controller.abort());

    const headers = {
      'User-Agent': 'VLC/3.0.18'
    };
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const upstreamRes = await fetch(targetUrl, {
      signal: controller.signal,
      headers
    });

    if (!upstreamRes.ok && upstreamRes.status !== 206) {
      return res.status(upstreamRes.status).send('Medya akışı alınamadı.');
    }

    res.status(upstreamRes.status);

    const forwardHeaders = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'last-modified',
      'etag'
    ];

    for (const h of forwardHeaders) {
      const val = upstreamRes.headers.get(h);
      if (val) res.setHeader(h, val);
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    if (upstreamRes.body) {
      const nodeStream = Readable.fromWeb(upstreamRes.body);
      nodeStream.on('error', () => {});
      res.on('error', () => {});
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('[VOD Proxy Hatası]', err.message);
      if (!res.headersSent) res.status(500).send('Medya aktarım hatası');
    }
  }
}

app.get('/vod/movie/:idWithExt', async (req, res) => {
  const { idWithExt } = req.params;
  const { host, username, password } = CONFIG.iptv;
  const targetUrl = `${host}/movie/${username}/${password}/${idWithExt}`;
  await proxyMediaStream(req, res, targetUrl);
});

app.get('/vod/series/:idWithExt', async (req, res) => {
  const { idWithExt } = req.params;
  const { host, username, password } = CONFIG.iptv;
  const targetUrl = `${host}/series/${username}/${password}/${idWithExt}`;
  await proxyMediaStream(req, res, targetUrl);
});

// Tarayıcıların desteklemediği MKV / E-AC-3 VOD akışlarını fragmented MP4 + AAC olarak sunar.
// Video yeniden kodlanmaz; yalnızca ses dönüştürüldüğü için sunucu yükü sınırlı kalır.
// ffmpeg bu sistemde bir sarmalayıcı (chocolatey shim) üzerinden çalıştığı için
// proc.kill() yalnızca sarmalayıcıyı öldürür; asıl ffmpeg süreci yayını okumaya ve
// hesabın tek bağlantı yuvasını tutmaya devam eder. Bu yüzden tüm süreç ağacı öldürülür.
function killProcessTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        .on('error', () => { try { proc.kill(); } catch (_) {} });
      return;
    } catch (_) {}
  }
  try {
    proc.kill('SIGKILL');
  } catch (_) {}
}

// Bu IPTV hesabı yalnızca 1 eşzamanlı bağlantıya izin verdiği için (max_connections=1)
// her istemci için tek bir dönüştürme süreci tutulur. İleri alma ya da ses/kalite
// değişiminde önce eski süreç öldürülür ve bağlantı yuvasının boşalması beklenir.
const vodSessions = new Map(); // sid -> ffmpeg süreci

function killVodSession(sid) {
  const proc = vodSessions.get(sid);
  if (!proc) return Promise.resolve();
  vodSessions.delete(sid);
  if (proc.exitCode !== null || proc.signalCode) return Promise.resolve();
  return new Promise(resolve => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    proc.once('close', done);
    setTimeout(done, 2500);
    killProcessTree(proc);
  });
}

app.get('/vod/browser/:mediaType/:idWithExt', async (req, res) => {
  const { mediaType, idWithExt } = req.params;
  if (!['movie', 'series'].includes(mediaType) || !/^\d+\.[a-z0-9]+$/i.test(idWithExt)) {
    return res.status(400).send('Geçersiz medya yolu.');
  }

  const { host, username, password } = CONFIG.iptv;
  const targetUrl = `${host}/${mediaType}/${username}/${password}/${idWithExt}`;
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const audioIndex = /^\d+$/.test(String(req.query.audio || '')) ? String(req.query.audio) : null;
  const quality = ['1080', '720', '480'].includes(String(req.query.quality)) ? String(req.query.quality) : 'original';
  
  // Kaliteye göre video parametreleri:
  // 'original': Orijinal çözünürlüğü koruyarak hızlı libx264 ile encode eder.
  // Bu sayede video ve ses aynı filtergraph'tan geçerek her zaman %100 senkron çalışır.
  let videoArgs;
  if (quality === '720') {
    videoArgs = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-vf', 'scale=-2:720:force_original_aspect_ratio=decrease'];
  } else if (quality === '480') {
    videoArgs = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-vf', 'scale=-2:480:force_original_aspect_ratio=decrease'];
  } else if (quality === '1080') {
    videoArgs = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-vf', 'scale=-2:1080:force_original_aspect_ratio=decrease'];
  } else {
    // 'original' - orijinal çözünürlük, çok hızlı x264, senkron garantili
    videoArgs = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21'];
  }

  // Akış canlı dönüştürüldüğü için tarayıcı HTTP Range ile ileri/geri saramaz.
  // İstemci ileri alındığında ?start=<saniye> ile yeni bir akış ister; ffmpeg
  // girişi -ss ile o noktadan açar ve çıkış zaman damgaları tekrar 0'dan başlar.
  const startSec = Number.parseFloat(req.query.start);
  const seekArgs = Number.isFinite(startSec) && startSec > 0
    ? ['-ss', String(Math.floor(startSec))]
    : ['-ss', '0'];

  const ffmpegArgs = [
    '-hide_banner', '-loglevel', 'error',
    ...seekArgs,
    '-i', targetUrl,
    '-map', '0:v:0', '-map', audioIndex ? `0:${audioIndex}` : '0:a:0?',
    ...videoArgs,
    '-c:a', 'aac', '-ac', '2', '-b:a', '192k',
    '-af', 'aresample=async=1:min_hard_comp=0.100000:first_pts=0',
    '-avoid_negative_ts', 'make_zero',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4', 'pipe:1'
  ];

  const sid = String(req.query.sid || req.ip || 'default').slice(0, 64);
  await killVodSession(sid);
  // Sağlayıcının bağlantı yuvasını serbest bırakması için kısa bekleme
  await new Promise(resolve => setTimeout(resolve, 400));
  if (req.destroyed || res.writableEnded) return;

  const MAX_TRIES = 3;
  let current = null;

  const startTranscode = attempt => {
    const ffmpeg = spawn('ffmpeg', ffmpegArgs, { windowsHide: true });
    current = ffmpeg;
    vodSessions.set(sid, ffmpeg);

    let bytes = 0;
    ffmpeg.stdout.on('data', chunk => { bytes += chunk.length; });
    ffmpeg.stdout.pipe(res, { end: false });
    ffmpeg.stderr.on('data', data => console.warn('[VOD Dönüştürme]', String(data).trim()));

    ffmpeg.on('error', err => {
      console.error('[FFmpeg Hatası]', err.message);
      if (!res.headersSent) res.status(500);
      if (!res.writableEnded) res.end();
    });

    ffmpeg.on('close', () => {
      if (vodSessions.get(sid) === ffmpeg) vodSessions.delete(sid);
      if (current !== ffmpeg || res.writableEnded || req.destroyed) return;

      // Tek bağlantı limiti yüzünden hiç veri gelmediyse yuva boşalınca yeniden dene
      if (bytes === 0 && attempt < MAX_TRIES) {
        console.warn(`[VOD] Akış boş döndü, yeniden deneniyor (${attempt + 1}/${MAX_TRIES})`);
        setTimeout(() => {
          const taken = vodSessions.get(sid);
          if (taken && taken !== ffmpeg) return; // başka bir istek devraldı
          if (!res.writableEnded && !req.destroyed) startTranscode(attempt + 1);
        }, 800);
        return;
      }

      res.end();
    });
  };

  res.on('close', () => {
    if (!current) return;
    if (vodSessions.get(sid) === current) vodSessions.delete(sid);
    killProcessTree(current);
  });

  startTranscode(1);
});

app.get('/api/vod/tracks/:mediaType/:idWithExt', (req, res) => {
  const { mediaType, idWithExt } = req.params;
  if (!['movie', 'series'].includes(mediaType) || !/^\d+\.[a-z0-9]+$/i.test(idWithExt)) return res.status(400).json({ error: 'Geçersiz medya yolu.' });
  const { host, username, password } = CONFIG.iptv;
  const targetUrl = `${host}/${mediaType}/${username}/${password}/${idWithExt}`;
  const probe = spawn('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', targetUrl], { windowsHide: true });
  let output = '';
  probe.stdout.on('data', chunk => { output += chunk; });
  probe.on('close', code => {
    if (code !== 0) return res.status(502).json({ error: 'Medya bilgisi okunamadı.' });
    try {
      const streams = JSON.parse(output).streams || [];
      const normalize = stream => ({ index: stream.index, codec: stream.codec_name, language: stream.tags?.language || 'und', title: stream.tags?.title || '' });
      const video = streams.find(s => s.codec_type === 'video');
      res.json({
        audio: streams.filter(s => s.codec_type === 'audio').map(normalize),
        subtitles: streams.filter(s => s.codec_type === 'subtitle').map(normalize),
        source: video ? { width: video.width, height: video.height, codec: video.codec_name } : null
      });
    } catch (err) { res.status(502).json({ error: err.message }); }
  });
});

app.get('/vod/subtitle/:mediaType/:idWithExt/:trackIndex.vtt', (req, res) => {
  const { mediaType, idWithExt, trackIndex } = req.params;
  if (!['movie', 'series'].includes(mediaType) || !/^\d+\.[a-z0-9]+$/i.test(idWithExt) || !/^\d+$/.test(trackIndex)) return res.status(400).end();
  const { host, username, password } = CONFIG.iptv;
  const targetUrl = `${host}/${mediaType}/${username}/${password}/${idWithExt}`;
  res.type('text/vtt');
  const ffmpeg = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', targetUrl, '-map', `0:${trackIndex}`, '-f', 'webvtt', 'pipe:1'], { windowsHide: true });
  ffmpeg.stdout.pipe(res);
  res.on('close', () => killProcessTree(ffmpeg));
});

const vodDurationCache = new Map();

app.get('/api/vod/duration/:mediaType/:idWithExt', async (req, res) => {
  const { mediaType, idWithExt } = req.params;
  if (!['movie', 'series'].includes(mediaType) || !/^\d+\.[a-z0-9]+$/i.test(idWithExt)) {
    return res.status(400).json({ error: 'Geçersiz medya yolu.' });
  }

  const cacheKey = `${mediaType}/${idWithExt}`;
  if (vodDurationCache.has(cacheKey)) {
    return res.json({ duration: vodDurationCache.get(cacheKey) });
  }

  const { host, username, password } = CONFIG.iptv;
  const targetUrl = `${host}/${mediaType}/${username}/${password}/${idWithExt}`;
  try {
    const duration = await new Promise((resolve, reject) => {
      const ffprobe = spawn('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        targetUrl
      ], { windowsHide: true });
      let output = '';
      let error = '';
      ffprobe.stdout.on('data', chunk => { output += chunk; });
      ffprobe.stderr.on('data', chunk => { error += chunk; });
      ffprobe.on('error', reject);
      ffprobe.on('close', code => {
        const seconds = Number.parseFloat(output.trim());
        if (code === 0 && Number.isFinite(seconds) && seconds > 0) resolve(seconds);
        else reject(new Error(error.trim() || 'Süre okunamadı'));
      });
    });
    vodDurationCache.set(cacheKey, duration);
    res.json({ duration });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Xtream standart yol yönlendirmeleri
app.get('/movie/:username/:password/:idWithExt', async (req, res) => {
  req.url = `/vod/movie/${req.params.idWithExt}`;
  return app.handle(req, res);
});

app.get('/series/:username/:password/:idWithExt', async (req, res) => {
  req.url = `/vod/series/${req.params.idWithExt}`;
  return app.handle(req, res);
});

// -------------------------------------------------------------
// REST API ENDPOINTS
// -------------------------------------------------------------

// API: User Info
app.get('/api/user-info', async (req, res) => {
  try {
    await getOrUpdateData();
    const uInfo = cache.userInfo?.user_info || {};

    let expDateFormatted = 'Belirtilmedi';
    if (uInfo.exp_date && uInfo.exp_date !== 'null') {
      const expDate = new Date(parseInt(uInfo.exp_date) * 1000);
      expDateFormatted = expDate.toLocaleDateString('tr-TR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    }

    res.json({
      username: uInfo.username || 'Kullanıcı',
      status: uInfo.status || 'Active',
      expDate: expDateFormatted,
      maxConnections: uInfo.max_connections || '1',
      activeConnections: uInfo.active_cons || '0',
      allowedFormats: ['m3u8', 'ts'],
      proxyEnabled: true
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Categories (Canlı TV kategorileri en üstte)
app.get('/api/categories', async (req, res) => {
  try {
    await getOrUpdateData();
    const categoriesWithCount = (cache.categories || []).map(cat => ({
      id: cat.category_id,
      name: cat.category_name,
      count: cache.categoryCounts[cat.category_id] || 0
    }));

    res.json({
      totalCategories: categoriesWithCount.length,
      totalStreams: cache.streams ? cache.streams.length : 0,
      categories: categoriesWithCount
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: EPG Program Rehberi (Görsel 1 Yayın Akışı için)
app.get('/api/epg/:stream_id', async (req, res) => {
  try {
    const { stream_id } = req.params;
    const { host, username, password } = CONFIG.iptv;
    const url = `${host}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_simple_data_table&stream_id=${stream_id}`;

    let rawListings = [];
    try {
      const epgRes = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (epgRes.ok) {
        const data = await epgRes.json();
        rawListings = data.epg_listings || [];
      }
    } catch (e) {
      console.warn('[EPG] Sunucudan EPG çekilemedi:', e.message);
    }

    const decoded = rawListings.map(item => {
      let title = item.title;
      let desc = item.description;
      try {
        title = Buffer.from(item.title, 'base64').toString('utf-8');
      } catch (_) {}
      try {
        desc = Buffer.from(item.description, 'base64').toString('utf-8');
      } catch (_) {}

      return {
        id: item.id,
        title: title || 'Canlı Yayın',
        description: desc || 'Yüksek çözünürlüklü kesintisiz canlı TV yayını.',
        start: item.start,
        end: item.end
      };
    });

    res.json({
      streamId: stream_id,
      listings: decoded
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Streams
app.get('/api/streams', async (req, res) => {
  try {
    await getOrUpdateData();
    const { category_id, search, limit = 60, offset = 0, ids } = req.query;

    let filtered = cache.streams || [];

    // Filtrele: Sahte başlık/ayraç satırlarını çıkar
    filtered = filtered.filter(s => !s.name.includes('✦●✦') && !s.name.includes('===') && !s.name.includes('---'));

    if (ids) {
      const idList = ids.split(',').map(s => s.trim());
      filtered = filtered.filter(s => idList.includes(String(s.stream_id)));
    } else {
      if (category_id && category_id !== 'all') {
        filtered = filtered.filter(s => String(s.category_id) === String(category_id));
      }

      if (search) {
        let q = search.toLowerCase().trim();
        if (/^b\*+/i.test(q) || /b\*{1,4}n/i.test(q)) {
          q = q.replace(/^b\*+/i, 'bein').replace(/b\*{1,4}n/gi, 'bein');
        }
        filtered = filtered.filter(s => {
          const sName = (s.name || '').toLowerCase();
          return sName.includes(q) || (s.num && String(s.num).includes(q));
        });
      }
    }

    const total = filtered.length;
    const paginated = filtered.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

    const streamsResult = paginated.map(s => ({
      id: s.stream_id,
      num: s.num,
      name: cleanName(s.name, 'channel'),
      icon: s.stream_icon,
      categoryId: s.category_id,
      epgId: s.epg_channel_id,
      streamUrl: `/stream/${s.stream_id}.m3u8`,
      directTsUrl: `/live/${s.stream_id}.ts`
    }));

    res.json({
      total,
      offset: parseInt(offset),
      limit: parseInt(limit),
      streams: streamsResult
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper: M3U URL'sinden host, username, password ayrıştırma
function parseM3uUrl(urlStr) {
  try {
    const u = new URL(urlStr.trim());
    const host = `${u.protocol}//${u.host}`;
    const username = u.searchParams.get('username') || '';
    const password = u.searchParams.get('password') || '';
    return { host, username, password };
  } catch (_) {
    return null;
  }
}

// API: Mevcut Ayarları Getir
app.get('/api/settings', (req, res) => {
  const { host, username, password } = CONFIG.iptv;
  res.json({
    host,
    username,
    password,
    m3uUrl: `${host}/get.php?username=${username}&password=${password}&type=m3u&output=ts`
  });
});

// API: Ayarları Güncelle & Doğrula & .env Kaydet
app.post('/api/settings', async (req, res) => {
  try {
    let { host, username, password, m3uUrl } = req.body;

    // Eğer kullanıcı tam M3U linki yapıştırdıysa otomatik ayrıştır
    if (m3uUrl && (!host || !username || !password)) {
      const parsed = parseM3uUrl(m3uUrl);
      if (parsed && parsed.host && parsed.username && parsed.password) {
        host = parsed.host;
        username = parsed.username;
        password = parsed.password;
      }
    }

    if (!host || !username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Lütfen Sunucu Adresi (Host), Kullanıcı Adı ve Şifre alanlarını eksiksiz girin.'
      });
    }

    host = host.trim().replace(/\/+$/, '');
    username = username.trim();
    password = password.trim();

    console.log(`[Ayarlar] Yeni IPTV bağlantısı test ediliyor: ${host} (Kullanıcı: ${username})...`);
    const testUrl = `${host}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
    
    let testRes;
    try {
      testRes = await fetch(testUrl, {
        signal: AbortSignal.timeout(7000),
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: `IPTV sunucusuna bağlanılamadı (${err.message}). Lütfen adresi kontrol edin.`
      });
    }

    if (!testRes.ok) {
      return res.status(400).json({
        success: false,
        error: `IPTV sunucusu hata verdi: HTTP ${testRes.status}`
      });
    }

    const authData = await testRes.json();
    if (authData.user_info && authData.user_info.auth === 0) {
      return res.status(400).json({
        success: false,
        error: 'Giriş Başarısız! Kullanıcı adı veya şifre IPTV sağlayıcısı tarafından reddedildi.'
      });
    }

    // .env dosyasına kaydet ve çalışma zamanını güncelle
    saveEnvFile({
      IPTV_HOST: host,
      IPTV_USERNAME: username,
      IPTV_PASSWORD: password
    });

    CONFIG.iptv.host = host;
    CONFIG.iptv.username = username;
    CONFIG.iptv.password = password;

    console.log('[Ayarlar] ✅ .env dosyası güncellendi.');

    // Tüm önbellekleri sıfırla
    cache.streams = null;
    cache.categories = null;
    cache.userInfo = null;
    cache.lastFetched = 0;
    vodCache.categories = null;
    vodCache.streamsByCat.clear();
    vodCache.lastFetched = 0;
    seriesCache.categories = null;
    seriesCache.seriesByCat.clear();
    seriesCache.seriesInfo.clear();
    seriesCache.lastFetched = 0;

    if (fs.existsSync(CACHE_FILE)) {
      try { fs.unlinkSync(CACHE_FILE); } catch (_) {}
    }

    // Yeni IPTV sağlayıcısından kanalları çek
    await getOrUpdateData(true);

    res.json({
      success: true,
      message: 'IPTV ayarları başarıyla .env dosyasına kaydedildi ve kanal listesi yenilendi!',
      totalChannels: cache.streams?.length || 0,
      userInfo: authData.user_info || {}
    });
  } catch (err) {
    console.error('[Ayarlar Hatası]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Manuel Önbellek Yenileme
app.post('/api/refresh-cache', async (req, res) => {
  try {
    console.log('[Sunucu] Manuel önbellek yenileme istendi...');
    await getOrUpdateData(true);
    res.json({
      success: true,
      message: 'Kanal listesi başarıyla güncellendi ve 1 gün boyunca önbelleğe alındı.',
      totalChannels: cache.streams?.length || 0
    });
  } catch (err) {
    res.status(500).json({ error: 'Yenileme hatası: ' + err.message });
  }
});

// =============================================================
// YETİŞKİN İÇERİK KORUMA VE FİLTRE MOTORU
// =============================================================
function isAdultCategory(name = '') {
  const s = String(name || '').toUpperCase();
  return (
    s.includes('XXX') ||
    s.includes('ADULT') ||
    s.includes('PORN') ||
    s.includes('+18') ||
    s.includes('YETISKIN') ||
    s.includes('EROTIC')
  );
}

function isAdultContent(stream, catName = '') {
  const sName = (stream.name || '').toUpperCase();
  const cName = (catName || '').toUpperCase();
  return (
    stream.is_adult === 1 ||
    stream.is_adult === '1' ||
    sName.includes('XXX') ||
    sName.includes('ADULT') ||
    sName.includes('PORN') ||
    sName.includes('+18') ||
    cName.includes('XXX') ||
    cName.includes('ADULT') ||
    cName.includes('PORN') ||
    ['112', '547', '865', '866'].includes(String(stream.category_id))
  );
}

// =============================================================
// VOD (FILM & SINEMA) & DIZI API & ÖNBELLEK
// =============================================================
const vodCache = {
  categories: null,
  streamsByCat: new Map(),
  lastFetched: 0
};

const seriesCache = {
  categories: null,
  seriesByCat: new Map(),
  seriesInfo: new Map(),
  lastFetched: 0
};

async function getVodCategories() {
  if (vodCache.categories && (Date.now() - vodCache.lastFetched < 3600000)) {
    return vodCache.categories;
  }
  const raw = await fetchFromXtream('get_vod_categories');
  const clean = (raw || [])
    .filter(c => !isAdultCategory(c.category_name))
    .map(c => ({
      category_id: String(c.category_id),
      category_name: cleanName(c.category_name, 'category').replace(/TR\s*⭐\s*/g, '').trim(),
      parent_id: c.parent_id || 0
    }));
  vodCache.categories = clean;
  vodCache.lastFetched = Date.now();
  return clean;
}

async function getSeriesCategories() {
  if (seriesCache.categories && (Date.now() - seriesCache.lastFetched < 3600000)) {
    return seriesCache.categories;
  }
  const raw = await fetchFromXtream('get_series_categories');
  const clean = (raw || [])
    .filter(c => !isAdultCategory(c.category_name))
    .map(c => ({
      category_id: String(c.category_id),
      category_name: cleanName(c.category_name, 'category').replace(/TR\s*⭐\s*/g, '').trim(),
      parent_id: c.parent_id || 0
    }));
  seriesCache.categories = clean;
  seriesCache.lastFetched = Date.now();
  return clean;
}

async function getVodStreamsByCategory(catId) {
  const key = String(catId || 'all');
  const cached = vodCache.streamsByCat.get(key);
  if (cached && (Date.now() - cached.time < 1800000)) {
    return cached.data;
  }
  const extra = catId && catId !== 'all' ? `get_vod_streams&category_id=${catId}` : 'get_vod_streams';
  const raw = await fetchFromXtream(extra);
  const clean = (Array.isArray(raw) ? raw : [])
    .filter(m => !isAdultContent(m))
    .map(m => ({
      id: m.stream_id,
      stream_id: m.stream_id,
      name: cleanName(m.name, 'movie'),
      icon: m.stream_icon,
      rating: m.rating || '',
      rating_5based: m.rating_5based || 0,
      year: m.year || (m.name?.match(/\b(19\d\d|20\d\d)\b/) || [])[0] || '',
      added: m.added,
      container_extension: m.container_extension || 'mp4',
      categoryId: String(m.category_id),
      streamUrl: `/vod/browser/movie/${m.stream_id}.${m.container_extension || 'mp4'}`
    }));
  vodCache.streamsByCat.set(key, { time: Date.now(), data: clean });
  return clean;
}

async function getSeriesByCategory(catId) {
  const key = String(catId || 'all');
  const cached = seriesCache.seriesByCat.get(key);
  if (cached && (Date.now() - cached.time < 1800000)) {
    return cached.data;
  }
  const extra = catId && catId !== 'all' ? `get_series&category_id=${catId}` : 'get_series';
  const raw = await fetchFromXtream(extra);
  const clean = (Array.isArray(raw) ? raw : [])
    .filter(s => !isAdultCategory(s.name) && !isAdultCategory(s.genre))
    .map(s => ({
      id: s.series_id,
      series_id: s.series_id,
      name: cleanName(s.name, 'series'),
      cover: s.cover,
      plot: s.plot || '',
      cast: s.cast || '',
      director: s.director || '',
      genre: s.genre || '',
      releaseDate: s.releaseDate || s.release_date || '',
      year: (s.releaseDate || s.release_date || '').slice(0, 4) || (s.name?.match(/\b(19\d\d|20\d\d)\b/) || [])[0] || '',
      rating: s.rating || '',
      rating_5based: s.rating_5based || 0,
      backdrop: (s.backdrop_path && s.backdrop_path[0]) || '',
      categoryId: String(s.category_id)
    }));
  seriesCache.seriesByCat.set(key, { time: Date.now(), data: clean });
  return clean;
}

async function getSeriesDetails(seriesId) {
  const key = String(seriesId);
  const cached = seriesCache.seriesInfo.get(key);
  if (cached && (Date.now() - cached.time < 1800000)) {
    return cached.data;
  }
  const { host, username, password } = CONFIG.iptv;
  const url = `${host}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_series_info&series_id=${seriesId}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error('Dizi bilgisi alınamadı');
  const raw = await res.json();

  const seriesTitle = cleanName(raw.info?.name || 'Dizi', 'series');
  const seasons = raw.seasons || [];
  const rawEpisodes = raw.episodes || {};
  const episodesBySeason = {};

  for (const [seasonNum, epList] of Object.entries(rawEpisodes)) {
    episodesBySeason[seasonNum] = (epList || []).map(ep => {
      let epTitle = cleanName(ep.title || '', 'episode', seriesTitle);
      if (!epTitle || epTitle.toLowerCase() === 'bölüm' || epTitle.toLowerCase() === 'bolum') {
        epTitle = `${ep.episode_num}. Bölüm`;
      }
      return {
        id: ep.id,
        episode_num: ep.episode_num,
        title: epTitle,
        container_extension: ep.container_extension || 'mp4',
        season: ep.season,
        streamUrl: `/vod/browser/series/${ep.id}.${ep.container_extension || 'mp4'}`,
        info: ep.info || {}
      };
    });
  }

  const result = {
    info: { ...(raw.info || {}), name: seriesTitle },
    seasons,
    episodes: episodesBySeason
  };
  seriesCache.seriesInfo.set(key, { time: Date.now(), data: result });
  return result;
}

// REST: VOD Kategorileri
app.get('/api/vod/categories', async (req, res) => {
  try {
    const cats = await getVodCategories();
    res.json({ categories: cats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REST: VOD Filmler (Kategoriye göre veya genel, arama ve sayfalama destekli)
app.get('/api/vod/streams', async (req, res) => {
  try {
    const { category_id, search, limit = 40, offset = 0 } = req.query;
    let list = await getVodStreamsByCategory(category_id);

    if (search) {
      const q = search.toLowerCase().trim();
      list = list.filter(m => (m.name || '').toLowerCase().includes(q));
    }

    const total = list.length;
    const paginated = list.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

    res.json({
      total,
      offset: parseInt(offset),
      limit: parseInt(limit),
      movies: paginated
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REST: Tekil Film Bilgisi & Stream URL
app.get('/api/vod/movie/:id', async (req, res) => {
  try {
    const movieId = req.params.id;
    for (const [_, cached] of vodCache.streamsByCat.entries()) {
      const found = cached.data?.find(m => String(m.id) === String(movieId));
      if (found) return res.json(found);
    }
    const { host, username, password } = CONFIG.iptv;
    const url = `${host}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_vod_info&vod_id=${movieId}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (r.ok) {
      const raw = await r.json();
      const info = raw.info || {};
      const movieData = raw.movie_data || {};
      const ext = movieData.container_extension || info.container_extension || 'mp4';
      return res.json({
        id: movieId,
        stream_id: movieId,
        name: cleanName(info.name || movieData.name || 'Film'),
        icon: info.movie_image || info.cover_big || '',
        rating: info.rating || '',
        year: info.releasedate?.slice(0, 4) || '',
        container_extension: ext,
        streamUrl: `/vod/browser/movie/${movieId}.${ext}`
      });
    }
    res.status(404).json({ error: 'Film bulunamadı' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REST: Dizi Kategorileri
app.get('/api/series/categories', async (req, res) => {
  try {
    const cats = await getSeriesCategories();
    res.json({ categories: cats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REST: Diziler (Kategoriye göre veya genel, arama ve sayfalama destekli)
app.get('/api/series', async (req, res) => {
  try {
    const { category_id, search, limit = 40, offset = 0 } = req.query;
    let list = await getSeriesByCategory(category_id);

    if (search) {
      const q = search.toLowerCase().trim();
      list = list.filter(s => (s.name || '').toLowerCase().includes(q) || (s.genre || '').toLowerCase().includes(q));
    }

    const total = list.length;
    const paginated = list.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

    res.json({
      total,
      offset: parseInt(offset),
      limit: parseInt(limit),
      series: paginated
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REST: Dizi Detayı & Bölümleri
app.get('/api/series-info/:series_id', async (req, res) => {
  try {
    const details = await getSeriesDetails(req.params.series_id);
    res.json(details);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================
// PLATFORM VE ANASAYFA (GOOGLE TV TARZI) MOTORU
// =============================================================
const PLATFORMS = [
  {
    id: 'netflix',
    name: 'Netflix',
    tagline: 'Filmler, Diziler ve Özel Yapımlar',
    color: '#E50914',
    bgGradient: 'from-red-950/70 via-zinc-950 to-black',
    borderColor: 'border-red-600/40 hover:border-red-500',
    accentColor: 'text-red-500',
    badgeBg: 'bg-red-600/20 text-red-400 border border-red-500/30',
    vodKeywords: ['netflix'],
    seriesKeywords: ['netflix']
  },
  {
    id: 'prime',
    name: 'Prime Video',
    tagline: 'Amazon Orijinal ve Popüler İçerikler',
    color: '#00A8E1',
    bgGradient: 'from-sky-950/70 via-zinc-950 to-black',
    borderColor: 'border-sky-600/40 hover:border-sky-400',
    accentColor: 'text-sky-400',
    badgeBg: 'bg-sky-600/20 text-sky-400 border border-sky-500/30',
    vodKeywords: ['amazon'],
    seriesKeywords: ['amazon']
  },
  {
    id: 'disney',
    name: 'Disney+',
    tagline: 'Disney, Pixar, Marvel, Star Wars & Nat Geo',
    color: '#113CCF',
    bgGradient: 'from-blue-950/70 via-zinc-950 to-black',
    borderColor: 'border-blue-600/40 hover:border-blue-400',
    accentColor: 'text-blue-400',
    badgeBg: 'bg-blue-600/20 text-blue-400 border border-blue-500/30',
    vodKeywords: ['disney'],
    seriesKeywords: ['disney']
  },
  {
    id: 'blutv',
    name: 'BluTV / Max',
    tagline: 'HBO Max & Özel Yerli Yapımlar',
    color: '#00BAFF',
    bgGradient: 'from-cyan-950/70 via-zinc-950 to-black',
    borderColor: 'border-cyan-600/40 hover:border-cyan-400',
    accentColor: 'text-cyan-400',
    badgeBg: 'bg-cyan-600/20 text-cyan-400 border border-cyan-500/30',
    vodKeywords: ['blutv', 'blu tv'],
    seriesKeywords: ['blu tv', 'hbo max']
  },
  {
    id: 'exxen',
    name: 'Exxen',
    tagline: 'Diziler, Programlar ve Eğlence',
    color: '#FFDE00',
    bgGradient: 'from-amber-950/70 via-zinc-950 to-black',
    borderColor: 'border-yellow-500/40 hover:border-yellow-400',
    accentColor: 'text-yellow-400',
    badgeBg: 'bg-yellow-500/20 text-yellow-300 border border-yellow-400/30',
    vodKeywords: ['exxen'],
    seriesKeywords: ['exxen']
  },
  {
    id: 'tabii',
    name: 'Tabii',
    tagline: 'TRT Tabii Orijinal Yapımları',
    color: '#00E2AA',
    bgGradient: 'from-emerald-950/70 via-zinc-950 to-black',
    borderColor: 'border-emerald-500/40 hover:border-emerald-400',
    accentColor: 'text-emerald-400',
    badgeBg: 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30',
    vodKeywords: ['tabi', 'tabii'],
    seriesKeywords: ['tabi', 'tabii']
  },
  {
    id: 'bein',
    name: 'beIN / TOD',
    tagline: 'TOD Studios & beIN Originals',
    color: '#6F2C91',
    bgGradient: 'from-purple-950/70 via-zinc-950 to-black',
    borderColor: 'border-purple-600/40 hover:border-purple-400',
    accentColor: 'text-purple-400',
    badgeBg: 'bg-purple-600/20 text-purple-300 border border-purple-500/30',
    vodKeywords: ['bein'],
    seriesKeywords: ['bein', 'tod']
  },
  {
    id: 'appletv',
    name: 'Apple TV+',
    tagline: 'Apple Orijinal Film ve Dizileri',
    color: '#FFFFFF',
    bgGradient: 'from-zinc-800/70 via-zinc-950 to-black',
    borderColor: 'border-gray-500/40 hover:border-white',
    accentColor: 'text-white',
    badgeBg: 'bg-white/15 text-white border border-white/20',
    vodKeywords: ['apple'],
    seriesKeywords: ['apple']
  },
  {
    id: 'gain',
    name: 'GAİN',
    tagline: 'Farklı Sesler, Yepyeni Hikayeler',
    color: '#FFEA00',
    bgGradient: 'from-yellow-950/70 via-zinc-950 to-black',
    borderColor: 'border-amber-500/40 hover:border-amber-400',
    accentColor: 'text-amber-400',
    badgeBg: 'bg-amber-500/20 text-amber-300 border border-amber-400/30',
    vodKeywords: ['gain'],
    seriesKeywords: ['gain']
  },
  {
    id: 'tvplus',
    name: 'Turkcell TV+',
    tagline: 'TV+ Özel Seçkisi ve Sinema',
    color: '#FFBE00',
    bgGradient: 'from-yellow-950/70 via-zinc-950 to-black',
    borderColor: 'border-tv-yellow/50 hover:border-tv-yellow',
    accentColor: 'text-tv-yellow',
    badgeBg: 'bg-tv-yellow/20 text-tv-yellow border border-tv-yellow/40',
    vodKeywords: ['turkcell'],
    seriesKeywords: ['turkcell']
  }
];

// Helper: Platforma ait VOD & Dizi içeriklerini getir
async function getPlatformData(platformId) {
  const platform = PLATFORMS.find(p => p.id === platformId);
  if (!platform) return null;

  const [vodCats, serCats] = await Promise.all([
    getVodCategories(),
    getSeriesCategories()
  ]);

  const matchedVodCats = vodCats.filter(c => 
    platform.vodKeywords.some(k => c.category_name.toLowerCase().includes(k))
  );
  const matchedSerCats = serCats.filter(c => 
    platform.seriesKeywords.some(k => c.category_name.toLowerCase().includes(k))
  );

  const [movieLists, seriesLists] = await Promise.all([
    Promise.all(matchedVodCats.map(async c => (await getVodStreamsByCategory(c.category_id)).map(item => ({ ...item, categoryName: c.category_name })))),
    Promise.all(matchedSerCats.map(async c => (await getSeriesByCategory(c.category_id)).map(item => ({ ...item, categoryName: c.category_name }))))
  ]);

  // Tekilleştir ve etiketle
  const movieMap = new Map();
  movieLists.flat().forEach(m => {
    if (!movieMap.has(String(m.id))) {
      movieMap.set(String(m.id), {
        ...m,
        mediaType: 'movie',
        platformId: platform.id,
        platformName: platform.name
      });
    }
  });

  const seriesMap = new Map();
  seriesLists.flat().forEach(s => {
    if (!seriesMap.has(String(s.id))) {
      seriesMap.set(String(s.id), {
        ...s,
        mediaType: 'series',
        platformId: platform.id,
        platformName: platform.name
      });
    }
  });

  const result = {
    platform,
    movies: Array.from(movieMap.values()),
    series: Array.from(seriesMap.values())
  };
  await persistPlatformCatalog(result).catch(err => console.warn('[Katalog] DB senkronizasyonu atlandı:', err.message));
  return result;
}

async function persistPlatformCatalog(data) {
  persistPlatformCatalog.syncedAt ||= new Map();
  const lastSync = persistPlatformCatalog.syncedAt.get(data.platform.id) || 0;
  if (Date.now() - lastSync < 30 * 60 * 1000) return;

  const db = getDb();
  const items = [...data.movies, ...data.series];
  for (let start = 0; start < items.length; start += 500) {
    const chunk = items.slice(start, start + 500);
    const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?)').join(',');
    const values = chunk.flatMap(item => [
      data.platform.id,
      item.mediaType,
      Number(item.id),
      item.name || '',
      Number(item.year) || null,
      item.genre || item.categoryName || null,
      item.icon || item.cover || item.backdrop || null,
      Number(item.rating) || null
    ]);
    await db.query(`
      INSERT INTO media_catalog
        (platform_id, media_type, media_id, title, release_year, category_name, poster, rating)
      VALUES ${placeholders}
      ON DUPLICATE KEY UPDATE
        title=VALUES(title), release_year=VALUES(release_year), category_name=VALUES(category_name),
        poster=VALUES(poster), rating=VALUES(rating)
    `, values);
  }
  persistPlatformCatalog.syncedAt.set(data.platform.id, Date.now());
}

// REST: Tüm Platformları Listele
app.get('/api/platforms', async (req, res) => {
  try {
    const list = PLATFORMS.map(p => ({
      id: p.id,
      name: p.name,
      tagline: p.tagline,
      color: p.color,
      bgGradient: p.bgGradient,
      borderColor: p.borderColor,
      accentColor: p.accentColor,
      badgeBg: p.badgeBg
    }));
    res.json({ platforms: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REST: Belirli bir platformun detay ve içerikleri (Filmler & Diziler filtreli)
app.get('/api/platform/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const { type = 'all', search, limit = 50, offset = 0 } = req.query;

    const data = await getPlatformData(slug);
    if (!data) {
      return res.status(404).json({ error: 'Platform bulunamadı' });
    }

    let items = [];
    if (type === 'movies') {
      items = [...data.movies];
    } else if (type === 'series') {
      items = [...data.series];
    } else {
      // Tümü: Filmleri ve dizileri harmanla
      const maxLen = Math.max(data.movies.length, data.series.length);
      for (let i = 0; i < maxLen; i++) {
        if (i < data.movies.length) items.push(data.movies[i]);
        if (i < data.series.length) items.push(data.series[i]);
      }
    }

    if (search) {
      const q = search.toLowerCase().trim();
      items = items.filter(it => (it.name || '').toLowerCase().includes(q) || (it.genre || '').toLowerCase().includes(q));
    }

    const total = items.length;
    const paginated = items.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

    res.json({
      platform: data.platform,
      total,
      movieCount: data.movies.length,
      seriesCount: data.series.length,
      offset: parseInt(offset),
      limit: parseInt(limit),
      items: paginated
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REST: Netflix tarzı raf düzeni (hero + genre shelves)
app.get('/api/platform/:slug/shelves', async (req, res) => {
  try {
    const { slug } = req.params;
    const { search, type = 'all', year, category } = req.query;
    const data = await getPlatformData(slug);
    if (!data) return res.status(404).json({ error: 'Platform bulunamadı' });

    let movies = [...data.movies];
    let series = [...data.series];

    const allItems = [...movies, ...series];
    const years = [...new Set(allItems.map(item => Number(item.year)).filter(Boolean))].sort((a, b) => b - a);
    const categories = [...new Set(series.flatMap(item => (item.genre || '').split(/[\/,&]/).map(g => g.trim()).filter(Boolean)))].sort((a, b) => a.localeCompare(b, 'tr'));

    if (type === 'movies') series = [];
    if (type === 'series') movies = [];

    if (search) {
      const q = search.toLowerCase().trim();
      movies = movies.filter(m => (m.name || '').toLowerCase().includes(q));
      series = series.filter(s => (s.name || '').toLowerCase().includes(q) || (s.genre || '').toLowerCase().includes(q));
    }

    if (year) {
      movies = movies.filter(m => String(m.year) === String(year));
      series = series.filter(s => String(s.year) === String(year));
    }
    if (category) {
      const wanted = category.toLocaleLowerCase('tr-TR');
      series = series.filter(s => (s.genre || '').split(/[\/,&]/).some(g => g.trim().toLocaleLowerCase('tr-TR') === wanted));
      movies = movies.filter(m => (m.categoryName || '').toLocaleLowerCase('tr-TR').includes(wanted));
    }

    // Hero: rastgele yüksek puanlı içerik
    const heroPool = [
      ...movies.filter(m => parseFloat(m.rating || 0) >= 6).slice(0, 10),
      ...series.filter(s => parseFloat(s.rating || 0) >= 6).slice(0, 10)
    ];
    const hero = heroPool.length > 0
      ? heroPool[Math.floor(Math.random() * heroPool.length)]
      : (movies[0] || series[0] || null);

    if (category) {
      return res.json({
        platform: data.platform,
        hero,
        movieCount: data.movies.length,
        seriesCount: data.series.length,
        total: data.movies.length + data.series.length,
        years,
        categories,
        shelves: hero ? [{ title: category, type: 'category', category, items: [...movies, ...series] }] : []
      });
    }

    const shelves = [];

    // Top 10 shelf
    const top10Pool = [
      ...movies.map(m => ({ ...m, _sort: parseFloat(m.rating || 0) })),
      ...series.map(s => ({ ...s, _sort: parseFloat(s.rating || 0) }))
    ].sort((a, b) => b._sort - a._sort).slice(0, 10);
    if (top10Pool.length > 0) {
      shelves.push({
        title: `${data.platform.name} Top 10`,
        type: 'top10',
        items: top10Pool.map((it, i) => ({ ...it, rank: i + 1 }))
      });
    }

    // Popüler Filmler
    const popularMovies = movies.slice(0, 20);
    if (popularMovies.length > 0) {
      shelves.push({ title: 'Popüler Filmler', type: 'movies', items: popularMovies });
    }

    // Yeni Eklenen Filmler (added timestamp sıralı)
    const newMovies = [...movies].sort((a, b) => parseInt(b.added || 0) - parseInt(a.added || 0)).slice(0, 20);
    if (newMovies.length > 4) {
      shelves.push({ title: 'Yeni Eklenen Filmler', type: 'movies', items: newMovies });
    }

    // Yüksek Puanlı Filmler
    const highRated = [...movies].filter(m => parseFloat(m.rating || 0) >= 7).sort((a, b) => parseFloat(b.rating || 0) - parseFloat(a.rating || 0)).slice(0, 20);
    if (highRated.length > 4) {
      shelves.push({ title: 'Yüksek Puanlı Filmler', type: 'movies', items: highRated });
    }

    // Popüler Diziler
    const popularSeries = series.slice(0, 20);
    if (popularSeries.length > 0) {
      shelves.push({ title: 'Popüler Diziler', type: 'series', items: popularSeries });
    }

    // Dizi genre raf grupları
    const genreMap = new Map();
    for (const s of series) {
      const genres = (s.genre || '').split(/[\/,&]/).map(g => g.trim()).filter(Boolean);
      for (const g of genres) {
        if (!genreMap.has(g)) genreMap.set(g, []);
        if (genreMap.get(g).length < 20) genreMap.get(g).push(s);
      }
    }
    // En az 4 içeriği olan genre'leri raf olarak ekle
    for (const [genre, items] of genreMap) {
      if (items.length >= 4) {
        shelves.push({ title: `${genre} Dizileri`, type: 'series', category: genre, items });
      }
    }

    // Film yılına göre
    const thisYear = new Date().getFullYear();
    const yearMovies = movies.filter(m => parseInt(m.year) >= thisYear - 1);
    if (yearMovies.length > 4) {
      shelves.push({ title: `${thisYear} Yapımları`, type: 'movies', items: yearMovies.slice(0, 20) });
    }

    res.json({
      platform: data.platform,
      hero,
      movieCount: data.movies.length,
      seriesCount: data.series.length,
      total: data.movies.length + data.series.length,
      years,
      categories,
      shelves
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REST: Anasayfa (Google TV tarzı Hero & Vitrinler)
app.get('/api/featured', async (req, res) => {
  try {
    await getOrUpdateData();

    // Öne çıkan film ve dizi kategorilerinden çek
    const [vizyonMovies, netflixSeries, primeSeries] = await Promise.all([
      getVodStreamsByCategory('132').catch(() => []), // VIZYON FILMLER
      getSeriesByCategory('832').catch(() => []),    // NETFLIX DIZILER
      getSeriesByCategory('295').catch(() => [])     // AMAZON PRIME DIZILER
    ]);

    // Hero banner için en kaliteli afişe/puanlamaya sahip 5 içerik
    const heroPool = [
      ...vizyonMovies.slice(0, 4).map(m => ({
        id: m.id,
        name: m.name,
        type: 'movie',
        poster: m.icon,
        rating: m.rating || '8.4',
        year: m.year || '2024',
        tagline: 'Vizyonda Çok Sevilenler',
        plot: 'Sinemalarda gişe rekorları kıran ve seyircilerin beğenisini toplayan en popüler yapım.',
        playUrl: m.streamUrl
      })),
      ...netflixSeries.slice(0, 3).map(s => ({
        id: s.id,
        name: s.name,
        type: 'series',
        poster: s.backdrop || s.cover,
        cover: s.cover,
        rating: s.rating || '8.8',
        year: '2024',
        genre: s.genre || 'Dram, Gerilim',
        tagline: 'En Çok İzlenen Dizi',
        plot: s.plot || 'Dünya genelinde milyonlarca izleyicinin takip ettiği heyecan dolu serüven.',
        detailUrl: `/dizi/${s.id}`
      }))
    ];

    // Popüler ulusal ve spor kanalları
    const priorityChannelNames = ['TRT 1', 'ATV', 'KANAL D', 'SHOW TV', 'TV8', 'NOW', 'STAR', 'BEIN SPORTS 1', 'S SPORT', 'A SPOR'];
    const topChannels = (cache.streams || []).filter(s => {
      const u = s.name.toUpperCase();
      return priorityChannelNames.some(p => u.includes(p)) && !u.includes('XXX');
    }).slice(0, 12).map(s => ({
      id: s.stream_id,
      name: cleanName(s.name, 'channel'),
      icon: s.stream_icon,
      streamUrl: `/stream/${s.stream_id}.m3u8`
    }));

    res.json({
      heroes: heroPool,
      trendingMovies: vizyonMovies.slice(0, 20).map(m => ({ ...m, mediaType: 'movie' })),
      popularSeries: [...netflixSeries.slice(0, 10), ...primeSeries.slice(0, 10)].map(s => ({ ...s, mediaType: 'series' })),
      topChannels
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================
// MYSQL İZLEME GEÇMİŞİ & KALDIĞIN YERDEN DEVAM ETME API
// =============================================================

// Helper: Yerel LAN IP'sini tespit et (Telefonun erişebilmesi için fiziksel Wi-Fi/Modem IP'si)
function getLocalIpAddress() {
  try {
    const interfaces = os.networkInterfaces();
    let candidate = null;

    for (const name of Object.keys(interfaces)) {
      const lowerName = name.toLowerCase();
      // Sanal vEthernet, WSL ve Hyper-V adaptörlerini atla
      if (lowerName.includes('vethernet') || lowerName.includes('wsl') || lowerName.includes('virtual')) {
        continue;
      }
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          if (iface.address.startsWith('192.168.')) {
            return iface.address; // En ideal yerel ağ IP'si
          }
          if (iface.address.startsWith('10.')) {
            candidate = iface.address;
          }
        }
      }
    }
    if (candidate) return candidate;
  } catch (_) {}
  return '192.168.1.112';
}

// REST: İlerleme Kaydet (Saniye, Süre, Bölüm, vb.)
app.post('/api/progress', async (req, res) => {
  try {
    const db = getDb();
    const {
      profileName = 'Cemal Küller',
      mediaType,
      seriesId,
      seasonNum = 1,
      episodeId,
      movieId,
      title = 'İçerik',
      poster = '',
      currentTime = 0,
      duration = 0
    } = req.body;

    if (!mediaType) return res.status(400).json({ error: 'mediaType gerekli' });

    const cur = Math.max(0, parseFloat(currentTime) || 0);
    const dur = Math.max(0, parseFloat(duration) || 0);
    const pct = dur > 0 ? Math.min(100, Math.round((cur / dur) * 100)) : 0;

    if (mediaType === 'episode') {
      await db.query(`
        INSERT INTO watch_progress 
          (user_id, profile_name, media_type, series_id, season_num, episode_id, title, poster, progress_seconds, duration_seconds, percentage)
        VALUES (1, ?, 'episode', ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          progress_seconds = VALUES(progress_seconds),
          duration_seconds = VALUES(duration_seconds),
          percentage = VALUES(percentage),
          season_num = VALUES(season_num),
          title = VALUES(title),
          poster = VALUES(poster),
          updated_at = NOW();
      `, [profileName, seriesId || null, seasonNum, episodeId || null, title, poster, cur, dur, pct]);
    } else if (mediaType === 'movie') {
      await db.query(`
        INSERT INTO watch_progress 
          (user_id, profile_name, media_type, movie_id, title, poster, progress_seconds, duration_seconds, percentage)
        VALUES (1, ?, 'movie', ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          progress_seconds = VALUES(progress_seconds),
          duration_seconds = VALUES(duration_seconds),
          percentage = VALUES(percentage),
          title = VALUES(title),
          poster = VALUES(poster),
          updated_at = NOW();
      `, [profileName, movieId || null, title, poster, cur, dur, pct]);
    }

    res.json({ success: true, percentage: pct, currentTime: cur });
  } catch (err) {
    console.error('[Progress Save Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// REST: Profilin Devam Eden İçerikleri (Anasayfa "Kaldığın Yerden Devam Et" rafı için)
app.get('/api/progress', async (req, res) => {
  try {
    const db = getDb();
    const profile = req.query.profile || 'Cemal Küller';
    const [rows] = await db.query(`
      SELECT * FROM watch_progress 
      WHERE profile_name = ? AND percentage < 95 AND progress_seconds > 10 
      ORDER BY updated_at DESC LIMIT 20;
    `, [profile]);
    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REST: Dizinin en son izlenen bölüm ve saniyesi
app.get('/api/progress/series/:seriesId', async (req, res) => {
  try {
    const db = getDb();
    const profile = req.query.profile || 'Cemal Küller';
    const [rows] = await db.query(`
      SELECT * FROM watch_progress 
      WHERE profile_name = ? AND series_id = ? AND media_type = 'episode' 
      ORDER BY updated_at DESC LIMIT 1;
    `, [profile, req.params.seriesId]);
    res.json({ item: rows[0] || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REST: Tekil Bölümün kaldığı saniye
app.get('/api/progress/episode/:episodeId', async (req, res) => {
  try {
    const db = getDb();
    const profile = req.query.profile || 'Cemal Küller';
    const [rows] = await db.query(`
      SELECT * FROM watch_progress 
      WHERE profile_name = ? AND episode_id = ? AND media_type = 'episode' 
      LIMIT 1;
    `, [profile, req.params.episodeId]);
    res.json({ item: rows[0] || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REST: Tekil Filmin kaldığı saniye
app.get('/api/progress/movie/:movieId', async (req, res) => {
  try {
    const db = getDb();
    const profile = req.query.profile || 'Cemal Küller';
    const [rows] = await db.query(`
      SELECT * FROM watch_progress 
      WHERE profile_name = ? AND movie_id = ? AND media_type = 'movie' 
      LIMIT 1;
    `, [profile, req.params.movieId]);
    res.json({ item: rows[0] || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================
// SMART TV QR KOD & 6 HANELİ EŞLEŞME İLE GİRİŞ API
// =============================================================

// REST: TV için 6 Haneli Eşleşme Kodu & QR Kod Üret
app.get('/api/auth/tv-code', async (req, res) => {
  try {
    const db = getDb();
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const localIp = getLocalIpAddress();
    const port = CONFIG.port;
    const pairUrl = `http://${localIp}:${port}/tv-login?code=${code}`;

    const qrDataUrl = await QRCode.toDataURL(pairUrl, {
      width: 256,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });

    await db.query(`
      INSERT INTO tv_pairings (code, status, expires_at)
      VALUES (?, 'pending', DATE_ADD(NOW(), INTERVAL 10 MINUTE))
      ON DUPLICATE KEY UPDATE status = 'pending', expires_at = DATE_ADD(NOW(), INTERVAL 10 MINUTE);
    `, [code]);

    res.json({
      code,
      pairUrl,
      qrDataUrl,
      localIp
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REST: TV'nin Eşleşme Durumunu Sorgulaması (Polling)
app.get('/api/auth/tv-status', async (req, res) => {
  try {
    const db = getDb();
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: 'Kod eksik' });

    const [rows] = await db.query(`
      SELECT * FROM tv_pairings WHERE code = ? AND expires_at > NOW();
    `, [code]);

    if (rows.length === 0) {
      return res.json({ status: 'expired' });
    }

    const pairing = rows[0];
    if (pairing.status === 'authorized') {
      return res.json({
        status: 'authorized',
        user: {
          id: pairing.user_id,
          username: pairing.username || 'cemal',
          profileName: 'Cemal Küller'
        }
      });
    }

    res.json({ status: 'pending' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REST: Telefondan TV Kodunu Onayla (Giriş Yetkisi Ver)
app.post('/api/auth/tv-authorize', async (req, res) => {
  try {
    const db = getDb();
    const { code, profileName = 'Cemal Küller' } = req.body;
    if (!code) return res.status(400).json({ error: 'Kod gerekli' });

    const cleanCode = code.replace(/\D/g, '');

    const [rows] = await db.query(`
      SELECT * FROM tv_pairings WHERE code = ? AND expires_at > NOW();
    `, [cleanCode]);

    if (rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Geçersiz veya süresi dolmuş kod' });
    }

    await db.query(`
      UPDATE tv_pairings 
      SET status = 'authorized', user_id = 1, username = 'cemal'
      WHERE code = ?;
    `, [cleanCode]);

    res.json({ success: true, message: 'Televizyon girişi başarıyla onaylandı!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REST: Standart Kullanıcı Girişi (Kullanıcı Adı & Şifre)
app.post('/api/auth/login', async (req, res) => {
  try {
    const db = getDb();
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Kullanıcı adı ve şifre zorunludur' });
    }

    const [users] = await db.query('SELECT * FROM users WHERE username = ? AND password = ?', [username.trim(), password.trim()]);
    if (users.length === 0) {
      return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı' });
    }

    const user = users[0];
    const [profiles] = await db.query('SELECT * FROM profiles WHERE user_id = ?', [user.id]);

    res.json({
      success: true,
      user: { id: user.id, username: user.username, role: user.role },
      profiles
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================
// TELEVİZYON VE DIŞ OYNATICILAR İÇİN GÜVENLİ M3U & XTREAM API
// (Yetişkin içerikler 100% filtrelenmiş, orijinal kaynak gizli)
// =============================================================

// 1. M3U Playlist (Smart TV, TiviMate, SS IPTV, Smart IPTV, VLC, vb.)
app.get(['/tv.m3u', '/tv.m3u8', '/playlist.m3u', '/playlist.m3u8'], async (req, res) => {
  try {
    await getOrUpdateData();
    const protocol = req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;
    const streamType = req.query.type === 'ts' ? 'ts' : 'm3u8';

    let m3u = '#EXTM3U url-tvg="' + baseUrl + '/player_api.php?action=get_simple_data_table"\n';

    for (const s of (cache.streams || [])) {
      // Sahte başlık ve ayraçları atla
      if (s.name.includes('✦●✦') || s.name.includes('===') || s.name.includes('---')) {
        continue;
      }

      const catObj = (cache.categories || []).find(c => String(c.category_id) === String(s.category_id));
      const groupTitle = catObj ? catObj.category_name : 'Genel';

      // Yetişkin içerikleri filtrele
      if (isAdultContent(s, groupTitle)) {
        continue;
      }

      const channelName = cleanName(s.name, 'channel');
      const cleanGroup = cleanName(groupTitle, 'category').replace(/TR\s*⭐\s*/g, '').replace(/VIP\s*⭐\s*/g, '').trim();

      const streamUrl = (streamType === 'ts')
        ? `${baseUrl}/live/${s.stream_id}.ts`
        : `${baseUrl}/stream/${s.stream_id}.m3u8`;

      m3u += `#EXTINF:-1 tvg-id="${s.epg_channel_id || ''}" tvg-name="${channelName}" tvg-logo="${s.stream_icon || ''}" group-title="${cleanGroup}",${channelName}\n`;
      m3u += `${streamUrl}\n`;
    }

    res.setHeader('Content-Type', 'audio/x-mpegurl; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="tvplus.m3u"');
    res.send(m3u);
  } catch (err) {
    res.status(500).send('Playlist oluşturulamadı: ' + err.message);
  }
});

// 2. Xtream Codes API Uyumluluğu (IPTV Smarters Pro, TiviMate, XCIPTV vb. TV Uygulamaları)
app.get('/player_api.php', async (req, res) => {
  try {
    await getOrUpdateData();
    const { action } = req.query;
    const protocol = req.protocol;
    const host = req.get('host') || '192.168.1.112:3000';
    const [hostOnly, portOnly] = host.split(':');

    // Temiz kategoriler (Yetişkin kategoriler çıkarılmış)
    const cleanCategories = (cache.categories || [])
      .filter(c => !c.category_name.toUpperCase().includes('XXX') && !['112', '547', '865', '866'].includes(String(c.category_id)))
      .map(c => ({
        category_id: String(c.category_id),
        category_name: cleanName(c.category_name, 'category').replace(/TR\s*⭐\s*/g, '').replace(/VIP\s*⭐\s*/g, '').trim(),
        parent_id: 0
      }));

    // Temiz kanallar (Yetişkin kanallar ve ayraçlar çıkarılmış)
    const cleanStreams = (cache.streams || [])
      .filter(s => !isAdultContent(s) && !s.name.includes('✦●✦') && !s.name.includes('==='))
      .map(s => ({
        num: s.num,
        name: cleanName(s.name, 'channel'),
        stream_type: 'live',
        stream_id: s.stream_id,
        stream_icon: s.stream_icon,
        epg_channel_id: s.epg_channel_id,
        added: s.added || '1636398094',
        is_adult: '0',
        category_id: String(s.category_id),
        custom_sid: null,
        tv_archive: 0,
        direct_source: '',
        tv_archive_duration: 0
      }));

    if (action === 'get_live_categories') {
      return res.json(cleanCategories);
    }

    if (action === 'get_live_streams') {
      const catId = req.query.category_id;
      let result = cleanStreams;
      if (catId && catId !== 'all') {
        result = result.filter(s => s.category_id === String(catId));
      }
      return res.json(result);
    }

    if (action === 'get_simple_data_table') {
      const { stream_id } = req.query;
      const { host: upstreamHost, username, password } = CONFIG.iptv;
      const url = `${upstreamHost}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_simple_data_table&stream_id=${stream_id}`;
      try {
        const epgRes = await fetch(url, { signal: AbortSignal.timeout(4000) });
        if (epgRes.ok) {
          const data = await epgRes.json();
          return res.json(data);
        }
      } catch (_) {}
      return res.json({ epg_listings: [] });
    }

    if (action === 'get_vod_categories') {
      const cats = await getVodCategories();
      return res.json(cats);
    }

    if (action === 'get_vod_streams') {
      const catId = req.query.category_id;
      const list = await getVodStreamsByCategory(catId);
      return res.json(list);
    }

    if (action === 'get_series_categories') {
      const cats = await getSeriesCategories();
      return res.json(cats);
    }

    if (action === 'get_series') {
      const catId = req.query.category_id;
      const list = await getSeriesByCategory(catId);
      return res.json(list);
    }

    if (action === 'get_series_info') {
      const sId = req.query.series_id;
      const details = await getSeriesDetails(sId);
      return res.json(details);
    }

    // Default: Kullanıcı ve Sunucu Bilgisi (Smart TV Uygulaması Giriş Doğrulaması)
    res.json({
      user_info: {
        username: req.query.username || 'tvplus',
        password: req.query.password || '123',
        message: 'Turkcell TV+ Yerel Güvenli TV Proxy Aktif',
        auth: 1,
        status: 'Active',
        exp_date: '1893456000',
        is_trial: '0',
        active_cons: '1',
        created_at: '1600000000',
        max_connections: '5',
        allowed_output_formats: ['m3u8', 'ts']
      },
      server_info: {
        url: hostOnly,
        port: portOnly || '3000',
        https_port: '443',
        server_protocol: protocol,
        rtmp_port: '8880',
        timezone: 'Europe/Istanbul',
        time_now: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Xtream Codes Canlı Akış Yönlendirmesi (/live/:user/:pass/:id.:ext)
app.get('/live/:username/:password/:streamWithExt', async (req, res) => {
  const { streamWithExt } = req.params;
  const [streamId, ext] = streamWithExt.split('.');
  if (ext === 'm3u8') {
    req.url = `/stream/${streamId}.m3u8`;
    return app.handle(req, res);
  } else {
    req.url = `/live/${streamId}.ts`;
    return app.handle(req, res);
  }
});

// 4. TV Bilgisi API (Arayüzde Göstermek İçin)
app.get('/api/tv-info', (req, res) => {
  const localIp = '192.168.1.112';
  const port = CONFIG.port;
  res.json({
    localIp,
    port,
    m3uUrl: `http://${localIp}:${port}/tv.m3u`,
    m3uTsUrl: `http://${localIp}:${port}/tv.m3u?type=ts`,
    xtream: {
      serverUrl: `http://${localIp}:${port}`,
      username: 'tvplus',
      password: '123'
    }
  });
});

// Mobil TV Giriş Onay Sayfası
app.get(['/tv-login', '/esle'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tv-login.html'));
});

// SPA Fallback: Tüm menü rotaları ve doğrudan linkler için index.html döndür
app.get('*', (req, res, next) => {
  if (
    req.path.startsWith('/api/') ||
    req.path.startsWith('/stream/') ||
    req.path.startsWith('/live/') ||
    req.path.startsWith('/vod/') ||
    req.path.startsWith('/movie/') ||
    req.path.startsWith('/series/') ||
    req.path.includes('.')
  ) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
// Sunucu kapanırken açık kalan dönüştürme süreçlerini (ve bağlantı yuvasını) serbest bırak
function cleanupVodSessions() {
  for (const proc of vodSessions.values()) {
    killProcessTree(proc);
  }
  vodSessions.clear();
}

process.on('exit', cleanupVodSessions);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(signal, () => {
    cleanupVodSessions();
    process.exit(0);
  });
}

app.listen(CONFIG.port, async () => {
  console.log(`====================================================`);
  console.log(` Turkcell TV+ Web Player (1 Günlük Önbellek & Güvenli Stream)`);
  console.log(` Web Arayüzü: http://localhost:${CONFIG.port}`);
  console.log(`====================================================`);
  
  initDatabase().catch(e => console.error('MySQL başlatma hatası:', e.message));
  getOrUpdateData().catch(e => console.error('Önbellek başlatma hatası:', e.message));
});
