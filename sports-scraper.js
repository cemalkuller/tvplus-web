import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_FILE = path.join(__dirname, 'cache_sports_events.json');

// Bilinen spor kanalları ve TV+ Stream ID eşleme tablosu
const MANUAL_CHANNEL_MAP = [
  { match: /bein\s*sports?\s*1\b/i, id: 2199, name: 'beIN SPORTS 1' },
  { match: /bein\s*sports?\s*2\b/i, id: 2205, name: 'beIN SPORTS 2' },
  { match: /bein\s*sports?\s*3\b/i, id: 491883, name: 'beIN SPORTS 3' },
  { match: /bein\s*sports?\s*4\b/i, id: 491884, name: 'beIN SPORTS 4' },
  { match: /bein\s*sports?\s*5\b/i, id: 491885, name: 'beIN SPORTS 5' },
  { match: /bein\s*sports?\s*haber/i, id: 2194, name: 'beIN SPORTS HABER' },
  { match: /bein\s*sports?\s*max\s*1/i, id: 2215, name: 'beIN SPORTS MAX 1' },
  { match: /bein\s*sports?\s*max\s*2/i, id: 638237, name: 'beIN SPORTS MAX 2' },
  { match: /s\s*sport\s*2/i, id: 2028, name: 'S SPORT 2' },
  { match: /s\s*sport\s*plus\s*1/i, id: 393375, name: 'S SPORT PLUS 1' },
  { match: /s\s*sport\s*plus/i, id: 2025, name: 'S SPORT 1' },
  { match: /s\s*sport\s*1?/i, id: 2025, name: 'S SPORT 1' },
  { match: /tivibu\s*spor\s*1/i, id: 635439, name: 'TiViBU SPOR 1' },
  { match: /tivibu\s*spor\s*2/i, id: 635440, name: 'TiViBU SPOR 2' },
  { match: /tivibu\s*spor\s*3/i, id: 635441, name: 'TiViBU SPOR 3' },
  { match: /tivibu\s*spor\s*4/i, id: 635442, name: 'TiViBU SPOR 4' },
  { match: /tivibu\s*spor/i, id: 635438, name: 'TiViBU SPOR' },
  { match: /trt\s*spor\s*y[ıi]ld[ıi]z/i, id: 2018, name: 'TRT SPOR YILDIZ' },
  { match: /trt\s*spor/i, id: 2015, name: 'TRT SPOR' },
  { match: /a\s*spor/i, id: 2021, name: 'A SPOR' },
  { match: /tv\s*8\.5|tv8,5|tv8\.5/i, id: 1859, name: 'TV 8.5' },
  { match: /eurosport\s*2/i, id: 2037, name: 'EUROSPORT 2' },
  { match: /eurosport(\s*1)?/i, id: 2036, name: 'EUROSPORT 1' },
  { match: /exxen/i, id: 2199, name: 'EXXEN SPOR' }
];

let cachedSchedule = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 60 * 60 * 1000;

export function matchChannel(channelName, dynamicStreams = []) {
  if (!channelName) return null;
  const raw = String(channelName).trim();

  for (const item of MANUAL_CHANNEL_MAP) {
    if (item.match.test(raw)) {
      return { id: item.id, name: item.name };
    }
  }

  if (Array.isArray(dynamicStreams) && dynamicStreams.length > 0) {
    const cleanRaw = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
    const found = dynamicStreams.find(s => {
      const sName = (s.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return sName.includes(cleanRaw) || cleanRaw.includes(sName);
    });
    if (found) {
      return { id: found.id || found.stream_id, name: found.name };
    }
  }

  return null;
}

/**
 * Hassas ve doğru lig & kategori sınıflandırması
 */
function classifyEvent(boe, rawEvent) {
  const orgUrl = boe?.organizer?.url || rawEvent?.organizer?.url || '';
  const matchName = boe?.name || rawEvent?.name || '';
  const slug = orgUrl.includes('/league/') ? orgUrl.split('/league/')[1]?.replace(/\/$/, '').toLowerCase() : '';

  const homeRaw = boe?.homeTeam?.name || '';
  const awayRaw = boe?.awayTeam?.name || '';
  const isMatch = Boolean((homeRaw && awayRaw && homeRaw !== awayRaw) || matchName.includes(' - ') || matchName.includes(' vs '));

  // Lig Adı ve Kategori Belirleme
  let leagueName = 'Spor Karşılaşması';
  let category = 'other_sports';
  let isSuperLig = false;
  let isTff1Lig = false;

  // 1. TRENDYOL SÜPER LİG (SADECE GERÇEK SÜPER LİG FUTBOL MAÇLARI)
  // Dikkat: Hentbol Süper Ligi veya 1. Lig BURAYA GİREMEZ!
  if (slug === 'trendyol-super-lig') {
    leagueName = 'Trendyol Süper Lig';
    category = 'super_lig';
    isSuperLig = true;
    return { leagueName, category, isSuperLig, isTff1Lig, isMatch };
  }

  // 2. TRENDYOL 1. LİG & TÜRKİYE KUPASI
  if (slug === 'trendyol-1.-lig' || slug === 'tff-1.-lig' || slug.includes('tff-1') || slug.includes('trendyol-1')) {
    leagueName = 'Trendyol 1. Lig';
    category = 'tff_1lig';
    isTff1Lig = true;
    return { leagueName, category, isSuperLig: false, isTff1Lig: true, isMatch };
  }

  if (slug.includes('turkiye-kupasi') || slug.includes('ziraat')) {
    leagueName = 'Ziraat Türkiye Kupası';
    category = 'tff_1lig';
    return { leagueName, category, isSuperLig: false, isTff1Lig: true, isMatch };
  }

  if (slug === 'tff-2.-lig' || slug === 'tff-3.-lig') {
    leagueName = slug.toUpperCase().replace('-', ' ');
    category = 'tff_1lig';
    return { leagueName, category, isSuperLig: false, isTff1Lig: true, isMatch };
  }

  // 3. AVRUPA & DÜNYA LİGLERİ (Futbol)
  const europeMap = {
    'ingiltere-premier-lig': 'İngiltere Premier Lig',
    'ispanya-la-liga': 'İspanya La Liga',
    'italya-serie-a': 'İtalya Serie A',
    'almanya-bundesliga': 'Almanya Bundesliga',
    'almanya-bundesliga-2': 'Almanya 2. Bundesliga',
    'almanya-bundesliga-3': 'Almanya 3. Liga',
    'fransa-ligue-1': 'Fransa Ligue 1',
    'fransa-ligue-2': 'Fransa Ligue 2',
    'hollanda-eredivisie': 'Hollanda Eredivisie',
    'portekiz-liga-nos': 'Portekiz Liga Portugal',
    'suudi-arabistan-pro-lig': 'Suudi Arabistan Pro Lig',
    'uefa-sampiyonlar-ligi': 'UEFA Şampiyonlar Ligi',
    'uefa-avrupa-ligi': 'UEFA Avrupa Ligi',
    'uefa-konferans-ligi': 'UEFA Konferans Ligi',
    'ukrayna-premier-ligi': 'Ukrayna Premier Ligi',
    'azerbaycan-premier-ligi': 'Azerbaycan Premier Ligi',
    'iskocya-premier-lig': 'İskoçya Premier Lig',
    'brezilya-serie-a': 'Brezilya Serie A'
  };

  if (europeMap[slug]) {
    return { leagueName: europeMap[slug], category: 'europe', isSuperLig: false, isTff1Lig: false, isMatch };
  }

  if (
    slug.includes('premier-lig') ||
    slug.includes('la-liga') ||
    slug.includes('serie-a') ||
    slug.includes('bundesliga') ||
    slug.includes('ligue-1') ||
    slug.includes('sampiyonlar') ||
    slug.includes('avrupa-ligi') ||
    slug.includes('konferans')
  ) {
    leagueName = slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return { leagueName, category: 'europe', isSuperLig: false, isTff1Lig: false, isMatch };
  }

  // 4. BASKETBOL
  if (
    slug.includes('basket') ||
    slug.includes('euroleague') ||
    slug.includes('nba') ||
    slug.includes('bsl') ||
    slug.includes('fiba') ||
    slug.includes('tubad') ||
    slug.includes('gloria-cup') ||
    slug.includes('orman-cup') ||
    slug.includes('yuruyen-kosk')
  ) {
    if (slug.includes('euroleague')) leagueName = 'Turkish Airlines EuroLeague';
    else if (slug.includes('nba')) leagueName = 'NBA';
    else if (slug.includes('fiba-kadinlar-dunya-kupasi')) leagueName = 'FIBA Kadınlar Dünya Kupası';
    else if (slug.includes('gloria-cup')) leagueName = 'Gloria Cup Basketbol';
    else if (slug.includes('tubad')) leagueName = 'TÜBAD Basketbol Turnuvası';
    else if (slug.includes('orman-cup')) leagueName = 'Orman Cup Basketbol';
    else leagueName = 'Basketbol';

    return { leagueName, category: 'basketball', isSuperLig: false, isTff1Lig: false, isMatch };
  }

  // 5. DİĞER SPORLAR (Hentbol, Voleybol, Tenis, Dövüş, vb.)
  if (slug.includes('hentbol')) {
    leagueName = slug === 'hentbol-erkekler-super-ligi' ? 'Hentbol Erkekler Süper Ligi' : 'Hentbol Karşılaşması';
    return { leagueName, category: 'other_sports', isSuperLig: false, isTff1Lig: false, isMatch };
  }

  if (slug.includes('cev') || slug.includes('voleybol')) {
    leagueName = slug.includes('cev-kadinlar-avrupa-sampiyonasi') ? 'CEV Kadınlar Avrupa Şampiyonası' : 'Voleybol';
    return { leagueName, category: 'other_sports', isSuperLig: false, isTff1Lig: false, isMatch };
  }

  if (slug.includes('tenis') || slug.includes('wimbledon') || slug.includes('roland-garros') || slug.includes('us-open')) {
    leagueName = slug.includes('amerika-acik') ? 'Amerika Açık Tenis (US Open)' : 'Tenis';
    return { leagueName, category: 'other_sports', isSuperLig: false, isTff1Lig: false, isMatch };
  }

  if (slug.includes('ufc') || slug.includes('dovus') || slug.includes('one-championship') || slug.includes('glory')) {
    if (slug.includes('ufc')) leagueName = 'UFC Dövüş Serisi';
    else if (slug.includes('one-championship')) leagueName = 'ONE Championship Dövüş';
    else if (slug.includes('glory')) leagueName = 'Glory Kickboks Serisi';
    else leagueName = 'Dövüş Sporları';

    return { leagueName, category: 'other_sports', isSuperLig: false, isTff1Lig: false, isMatch };
  }

  if (slug.includes('formula') || slug.includes('f1') || slug.includes('motogp')) {
    leagueName = 'Motorsporları';
    return { leagueName, category: 'other_sports', isSuperLig: false, isTff1Lig: false, isMatch };
  }

  // Tanımlanamayan genel spor
  if (slug) {
    leagueName = slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  return { leagueName, category: isMatch ? 'other_sports' : 'program', isSuperLig: false, isTff1Lig: false, isMatch };
}

/**
 * sporekrani.com üzerinden günün maç listesini çeker ve ayrıştırır
 */
export async function fetchSportsFromSporekrani(dynamicStreams = []) {
  try {
    console.log('[SportsScraper] sporekrani.com üzerinden maç listesi çekiliyor...');
    const res = await fetch('https://www.sporekrani.com/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      signal: AbortSignal.timeout(12000)
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const html = await res.text();
    const pattern = /<script type="application\/ld\+json" data-qmeta="eventListRichResult">([\s\S]*?)<\/script>/;
    const match = html.match(pattern);

    if (!match || !match[1]) {
      console.warn('[SportsScraper] JSON-LD verisi bulunamadı.');
      return loadDiskCache();
    }

    const rawEvents = JSON.parse(match[1]);
    const now = new Date();

    const parsedMatches = [];

    for (const item of rawEvents) {
      const boe = item.broadcastOfEvent || {};
      const matchName = boe.name || item.name || '';
      if (!matchName) continue;

      const { leagueName, category, isSuperLig, isTff1Lig, isMatch } = classifyEvent(boe, item);

      // Stüdyo programlarını maç listesinde gösterme
      if (!isMatch) continue;

      const startDateStr = boe.startDate || item.startDate || '';
      const endDateStr = boe.endDate || item.endDate || '';

      const startDate = startDateStr ? new Date(startDateStr) : null;
      const endDate = endDateStr ? new Date(endDateStr) : null;

      let status = 'UPCOMING';
      if (startDate && endDate) {
        if (now >= startDate && now <= endDate) {
          status = 'LIVE';
        } else if (now > endDate) {
          status = 'FINISHED';
        }
      }

      let timeFormatted = '--:--';
      let dateFormatted = '';
      if (startDate && !isNaN(startDate)) {
        timeFormatted = startDate.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', hour12: false });
        dateFormatted = startDate.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
      }

      // Takım isimlerini ayrıştır
      let homeName = boe.homeTeam?.name;
      let awayName = boe.awayTeam?.name;

      if (!homeName || !awayName) {
        if (matchName.includes(' - ')) {
          const parts = matchName.split(' - ');
          homeName = homeName || parts[0]?.trim();
          awayName = awayName || parts[1]?.trim();
        } else if (matchName.toLowerCase().includes(' vs ')) {
          const parts = matchName.split(/ vs /i);
          homeName = homeName || parts[0]?.trim();
          awayName = awayName || parts[1]?.trim();
        }
      }

      const homeTeam = {
        name: homeName || 'Ev Sahibi',
        logo: boe.homeTeam?.logo || null
      };

      const awayTeam = {
        name: awayName || 'Deplasman',
        logo: boe.awayTeam?.logo || null
      };

      // Yayıncı kanallar
      const published = item.publishedOn || boe.recordedAt || [];
      const pubList = Array.isArray(published) ? published : [published];
      const channelNames = pubList.map(p => p?.name).filter(Boolean);

      // TV+ Kanal Listemizle Eşleştirme
      let matchedChannel = null;
      for (const chName of channelNames) {
        const found = matchChannel(chName, dynamicStreams);
        if (found) {
          matchedChannel = {
            id: found.id,
            name: found.name,
            originalName: chName
          };
          break;
        }
      }

      const primaryChannel = matchedChannel ? matchedChannel.name : (channelNames[0] || 'Spor Kanalı');

      parsedMatches.push({
        id: item['@id'] || `event-${parsedMatches.length + 1}`,
        title: matchName,
        homeTeam,
        awayTeam,
        startDate: startDateStr,
        endDate: endDateStr,
        time: timeFormatted,
        date: dateFormatted,
        status,
        leagueName,
        category,
        isSuperLig,
        isTff1Lig,
        channels: channelNames,
        primaryChannel,
        tvplusChannel: matchedChannel,
        hasStream: Boolean(matchedChannel?.id),
        streamId: matchedChannel?.id || null,
        banner: boe.image || item.image || null,
        stadium: boe.location?.name || ''
      });
    }

    // Sıralama Önceliği:
    // 1. Trendyol Süper Lig
    // 2. Trendyol 1. Lig
    // 3. Avrupa Ligleri
    // 4. Canlı maçlar
    // 5. Başlama saatine göre
    parsedMatches.sort((a, b) => {
      if (a.isSuperLig && !b.isSuperLig) return -1;
      if (!a.isSuperLig && b.isSuperLig) return 1;
      if (a.isTff1Lig && !b.isTff1Lig) return -1;
      if (!a.isTff1Lig && b.isTff1Lig) return 1;
      if (a.status === 'LIVE' && b.status !== 'LIVE') return -1;
      if (a.status !== 'LIVE' && b.status === 'LIVE') return 1;
      return new Date(a.startDate || 0) - new Date(b.startDate || 0);
    });

    const superLigMatches = parsedMatches.filter(m => m.isSuperLig);
    const tff1LigMatches = parsedMatches.filter(m => m.isTff1Lig);
    const europeMatches = parsedMatches.filter(m => m.category === 'europe');
    const basketMatches = parsedMatches.filter(m => m.category === 'basketball');
    const otherMatches = parsedMatches.filter(m => m.category === 'other_sports');

    const result = {
      updatedAt: new Date().toISOString(),
      total: parsedMatches.length,
      superLigCount: superLigMatches.length,
      tff1LigCount: tff1LigMatches.length,
      europeCount: europeMatches.length,
      basketballCount: basketMatches.length,
      otherSportsCount: otherMatches.length,
      matches: parsedMatches
    };

    saveDiskCache(result);
    cachedSchedule = result;
    lastFetchTime = Date.now();

    console.log(`[SportsScraper] ${parsedMatches.length} gerçek maç ayrıştırıldı: Süper Lig: ${result.superLigCount}, 1. Lig: ${result.tff1LigCount}, Avrupa: ${result.europeCount}, Basketbol: ${result.basketballCount}, Diğer: ${result.otherSportsCount}.`);
    return result;
  } catch (err) {
    console.error('[SportsScraper] Veri çekme hatası:', err.message);
    return loadDiskCache();
  }
}

function saveDiskCache(data) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[SportsScraper] Disk önbellek kaydetme hatası:', e.message);
  }
}

function loadDiskCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    }
  } catch (e) {
    console.warn('[SportsScraper] Disk önbellek okuma hatası:', e.message);
  }
  return { updatedAt: null, total: 0, superLigCount: 0, tff1LigCount: 0, europeCount: 0, basketballCount: 0, otherSportsCount: 0, matches: [] };
}

export async function getSportsSchedule(dynamicStreams = [], forceRefresh = false) {
  if (!forceRefresh && cachedSchedule && (Date.now() - lastFetchTime < CACHE_TTL_MS)) {
    return cachedSchedule;
  }

  if (!forceRefresh && !cachedSchedule) {
    const disk = loadDiskCache();
    if (disk && disk.matches && disk.matches.length > 0) {
      cachedSchedule = disk;
      fetchSportsFromSporekrani(dynamicStreams).catch(() => {});
      return disk;
    }
  }

  return await fetchSportsFromSporekrani(dynamicStreams);
}

export function initMidnightScheduler(getStreamsCallback) {
  function scheduleNextMidnight() {
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 5, 0);

    const msUntilMidnight = nextMidnight.getTime() - now.getTime();
    console.log(`[SportsScraper] Gece 00:00 zamanlayıcısı kuruldu. Kalan süre: ${Math.round(msUntilMidnight / 1000 / 60)} dakika.`);

    setTimeout(async () => {
      console.log('[SportsScraper] ⏰ Gece 00:00 tetiklendi! Yeni günün maçları sporekrani.com üzerinden çekiliyor...');
      try {
        const streams = typeof getStreamsCallback === 'function' ? getStreamsCallback() : [];
        await fetchSportsFromSporekrani(streams);
      } catch (err) {
        console.error('[SportsScraper] Gece güncelleme hatası:', err);
      }
      scheduleNextMidnight();
    }, msUntilMidnight);
  }

  scheduleNextMidnight();
}
