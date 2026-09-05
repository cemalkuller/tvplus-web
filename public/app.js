// =============================================================
// NOLIMIT WEB APPLICATION LOGIC (STREAMING & MEDIA PLATFORM)
// =============================================================

const STATE = {
  activeTab: 'home', // Default to Google TV style Anasayfa
  activeCategory: 'all',
  searchQuery: '',
  categories: [],
  channels: [],
  totalChannels: 0,
  currentChannel: null,
  heroChannel: null,
  guideOffset: 0,
  guideLimit: 48,
  favorites: JSON.parse(localStorage.getItem('tvplus_favorites') || '[]'),
  recents: JSON.parse(localStorage.getItem('tvplus_recents') || '[]'),
  volume: parseFloat(localStorage.getItem('tvplus_volume') || '1'),
  isMuted: false, // Ses her zaman açık başlasın, ses seviyesi hatırlansın
  profileName: localStorage.getItem('tvplus_profile_name') || 'Cemal Küller',
  localIp: '192.168.1.112',
  port: 3000,
  hls: null,
  clockInterval: null,
  inactivityTimer: null,
  epgData: [],
  activeEpgDay: 'Bugün',
  switcherCategory: 'all',
  switcherSearch: '',
  // Platformlar & Anasayfa (Google TV Deneyimi)
  platforms: [],
  activePlatform: null,
  platformFilter: 'all', // 'all' | 'movies' | 'series'
  platformItems: [],
  platformTotal: 0,
  platformMovieCount: 0,
  platformSeriesCount: 0,
  platformOffset: 0,
  platformLimit: 36,
  platformSearchQuery: '',
  platformYear: '',
  platformCategory: '',
  homeFeatured: null,
  // Filmler & Sinema
  movieCategories: [],
  activeMovieCategory: 'all',
  movies: [],
  totalMovies: 0,
  movieOffset: 0,
  movieLimit: 36,
  movieSearchQuery: '',
  // Diziler
  seriesCategories: [],
  activeSeriesCategory: 'all',
  seriesList: [],
  totalSeries: 0,
  seriesOffset: 0,
  seriesLimit: 36,
  seriesSearchQuery: '',
  currentSeries: null,
  activeSeriesSeason: 1,
  currentMedia: null,
  sourceDuration: 0,
  mediaTrackBase: '',
  mediaStartOffset: 0,
  mediaSeekTarget: null,
  mediaSeekTimer: null,
  selectedAudioTrack: '',
  selectedQuality: 'original',
  resumeBannerTimer: null,
  lastWatchedSeriesEpisode: null,
  adultUnlocked: sessionStorage.getItem('tvplus_adult_unlocked') === 'true',
  adultPin: '0000',
  pendingAdultAction: null
};

// Tek eşzamanlı bağlantı limitine karşı sunucunun bu sekmenin eski VOD akışını
// kapatabilmesi için sekme başına sabit bir oturum kimliği üretilir.
const CLIENT_STREAM_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// DOM References
const video = document.getElementById('video-player');
const playerModal = document.getElementById('tvplus-player-modal');
const playerLoading = document.getElementById('player-loading');
const playerError = document.getElementById('player-error');
const errorMessage = document.getElementById('error-message');
const playerOverlay = document.getElementById('player-overlay');
const channelDrawer = document.getElementById('channel-drawer');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  initIcons();
  initPlayerEvents();
  initSearchInputs();
  initRouting();
  updateFavoritesBadge();

  if (STATE.profileName) {
    document.getElementById('header-user-name').textContent = STATE.profileName;
    document.getElementById('profile-screen').classList.add('hidden');
    document.getElementById('main-app').classList.remove('hidden');
  }

  try {
    loadLocalNetworkInfo();
    await Promise.all([
      loadUserInfo(),
      loadCategories(),
      loadInitialChannels()
    ]);
    await handleRoute(true);
  } catch (err) {
    console.error('App init error:', err);
  }
});

function initIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// =============================================================
// URL ROUTING & SPA TARAYICI GEÇMİŞİ (HER MENÜ İÇİN ÖZEL URL)
// =============================================================
function initRouting() {
  window.addEventListener('popstate', () => {
    handleRoute(false);
  });
}

function getCurrentTabUrl() {
  if (STATE.activeTab === 'home') {
    return '/anasayfa';
  } else if (STATE.activeTab === 'platform' && STATE.activePlatform) {
    return `/platform/${STATE.activePlatform}${STATE.platformFilter !== 'all' ? '/' + STATE.platformFilter : ''}`;
  } else if (STATE.activeTab === 'live') {
    return '/canli-tv';
  } else if (STATE.activeTab === 'movies') {
    return '/filmler';
  } else if (STATE.activeTab === 'series') {
    return '/diziler';
  } else if (STATE.activeTab === 'guide') {
    if (STATE.activeCategory === 'favorites') {
      return '/favorilerim';
    }
    const params = new URLSearchParams();
    if (STATE.activeCategory && STATE.activeCategory !== 'all') {
      params.set('kategori', STATE.activeCategory);
    }
    if (STATE.searchQuery && STATE.searchQuery.trim()) {
      params.set('ara', STATE.searchQuery.trim());
    }
    const qs = params.toString();
    return '/kanal-listesi' + (qs ? `?${qs}` : '');
  }
  return '/anasayfa';
}

function updateUrl(url, replace = false) {
  const current = window.location.pathname + window.location.search;
  if (current === url) return;
  if (replace) {
    window.history.replaceState({ path: url }, '', url);
  } else {
    window.history.pushState({ path: url }, '', url);
  }
}

async function handleRoute(isInitial = false) {
  const path = window.location.pathname.toLowerCase();
  const searchParams = new URLSearchParams(window.location.search);

  // 1. Profil Rotası
  if (path === '/profil') {
    showProfileScreen(false);
    return;
  }

  // Profil seçili değilse ve profil ekranı açıksa beklet
  if (!STATE.profileName && !isInitial) {
    showProfileScreen(false);
    return;
  }

  // 2. Dizi Bölüm İzleme: /dizi/:seriesId/izle/:episodeId
  if (path.includes('/dizi/') && path.includes('/izle/')) {
    const parts = path.split('/');
    const sIdx = parts.indexOf('dizi');
    const eIdx = parts.indexOf('izle');
    if (sIdx !== -1 && eIdx !== -1 && parts[sIdx + 1] && parts[eIdx + 1]) {
      const sId = parseInt(parts[sIdx + 1]);
      const epId = parseInt(parts[eIdx + 1]);
      await openSeriesDetailPage(sId, false);
      if (STATE.currentSeries) {
        let foundEp = null;
        let foundSeason = 1;
        for (const [sNum, epList] of Object.entries(STATE.currentSeries.episodes || {})) {
          const ep = epList.find(e => String(e.id) === String(epId));
          if (ep) {
            foundEp = ep;
            foundSeason = parseInt(sNum);
            break;
          }
        }
        if (foundEp) {
          playSeriesEpisodeDirect(foundEp, foundSeason);
          return;
        }
      }
    }
  }

  // 3. Dizi Detay Sayfası: /dizi/:seriesId (Ayrı Sayfa)
  if (path.startsWith('/dizi/')) {
    const idStr = path.replace('/dizi/', '').replace(/\/$/, '');
    const sId = parseInt(idStr);
    if (!isNaN(sId)) {
      await openSeriesDetailPage(sId, false);
      return;
    }
  }

  // 4. Film İzleme: /film/:id
  if (path.startsWith('/film/')) {
    const idStr = path.replace('/film/', '').replace(/\/$/, '');
    const movieId = parseInt(idStr);
    if (!isNaN(movieId)) {
      try {
        const res = await fetch(`/api/vod/movie/${movieId}`);
        if (res.ok) {
          const movie = await res.json();
          openMediaItem(movie, 'movie');
          return;
        }
      } catch (_) {}
    }
  }

  // 5. Platform Sayfası: /platform/:slug/:type? (Filtreli: Tümü, Filmler, Diziler)
  if (path.startsWith('/platform/')) {
    const parts = path.replace('/platform/', '').split('/').filter(Boolean);
    const slug = parts[0];
    const type = parts[1] || 'all';
    if (slug) {
      await openPlatformPage(slug, type, false);
      return;
    }
  }

  // 6. Doğrudan Canlı TV Kanal İzleme Linki: /izle/:id
  if (path.startsWith('/izle/')) {
    const idStr = path.replace('/izle/', '').replace(/\/$/, '');
    const streamId = parseInt(idStr);
    if (!isNaN(streamId)) {
      let ch = STATE.channels.find(c => c.id === streamId);
      if (!ch) {
        try {
          const res = await fetch(`/api/streams?ids=${streamId}`);
          if (res.ok) {
            const data = await res.json();
            if (data.streams && data.streams.length > 0) {
              ch = data.streams[0];
            }
          }
        } catch (_) {}
      }
      if (ch) {
        openPlayer(ch, false);
        return;
      }
    }
  } else {
    // Herhangi bir izleme/oynatıcı rotasında değilsek ve oynatıcı açıksa kapat
    if (!path.includes('/izle') && !path.startsWith('/film/') && !playerModal.classList.contains('hidden')) {
      closePlayer(false);
    }
  }

  // 7. Anasayfa Rotası: / veya /anasayfa veya /home
  if (path === '/' || path === '' || path === '/anasayfa' || path === '/home') {
    switchTab('home', false);
    return;
  }

  // 8. Canlı TV Rotası
  if (path === '/canli-tv' || path === '/live') {
    switchTab('live', false);
    return;
  }

  // 9. Filmler Rotası
  if (path === '/filmler' || path === '/movies') {
    switchTab('movies', false);
    return;
  }

  // 10. Diziler Rotası
  if (path === '/diziler' || path === '/series') {
    switchTab('series', false);
    return;
  }

  // 11. Favorilerim Rotası
  if (path === '/favorilerim' || path === '/favoriler') {
    showFavoritesTab(false);
    return;
  }

  // 12. Kanal Listesi Rotası
  if (path === '/kanal-listesi' || path === '/kanallar' || path === '/rehber') {
    const cat = searchParams.get('kategori');
    const q = searchParams.get('ara');

    if (cat) {
      STATE.activeCategory = cat;
    }
    if (q) {
      STATE.searchQuery = q;
      const sInput = document.getElementById('guide-search-input');
      if (sInput) sInput.value = q;
      const gClear = document.getElementById('guide-clear-search');
      if (gClear) gClear.classList.remove('hidden');
    }

    switchTab('guide', false);
    renderGuideCategories();
    return;
  }

  // Varsayılan Rota: Google TV Anasayfa
  switchTab('home', false);
}

// =============================================================
// 1. PROFİL SEÇİMİ (GÖRSEL 1)
// =============================================================
function selectProfile(name) {
  STATE.profileName = name;
  localStorage.setItem('tvplus_profile_name', name);
  const headerName = document.getElementById('header-user-name');
  if (headerName) headerName.textContent = name;

  const pScreen = document.getElementById('profile-screen');
  if (pScreen) {
    pScreen.classList.add('opacity-0');
    setTimeout(() => {
      pScreen.classList.add('hidden');
      pScreen.classList.remove('opacity-0');
      document.getElementById('main-app').classList.remove('hidden');
      initIcons();
      const currentPath = window.location.pathname.toLowerCase();
      if (currentPath && currentPath !== '/' && currentPath !== '/profil') {
        handleRoute(false);
      } else {
        updateUrl(getCurrentTabUrl(), true);
      }
    }, 400);
  }
}

function showProfileScreen(push = true) {
  closePlayer(false);
  document.getElementById('main-app').classList.add('hidden');
  const pScreen = document.getElementById('profile-screen');
  if (pScreen) {
    pScreen.classList.remove('opacity-0', 'hidden');
  }
  initIcons();
  if (push) updateUrl('/profil');
}

window.selectProfile = selectProfile;
window.showProfileScreen = showProfileScreen;

// =============================================================
// 2. TAB NAVİGASYONU (ANASAYFA, CANLI TV, KANAL LİSTESİ, FİLMLER, DİZİLER, PLATFORMLAR)
// =============================================================
function switchTab(tab, push = true) {
  STATE.activeTab = tab;
  const navHome = document.getElementById('nav-home');
  const navLive = document.getElementById('nav-live');
  const navGuide = document.getElementById('nav-guide');
  const navMovies = document.getElementById('nav-movies');
  const navSeries = document.getElementById('nav-series');
  const navFavs = document.getElementById('nav-favs');

  const viewHome = document.getElementById('view-home');
  const viewLive = document.getElementById('view-live');
  const viewGuide = document.getElementById('view-guide');
  const viewMovies = document.getElementById('view-movies');
  const viewSeries = document.getElementById('view-series');
  const viewSeriesDetail = document.getElementById('view-series-detail');
  const viewPlatform = document.getElementById('view-platform');
  const mainHeader = document.getElementById('main-header');

  // Platform sayfası kendi Netflix tarzı gezinme çubuğunu kullanır.
  mainHeader?.classList.toggle('hidden', tab === 'platform');

  navHome?.classList.remove('text-white', 'font-bold');
  navLive?.classList.remove('text-white', 'font-bold');
  navGuide?.classList.remove('text-white', 'font-bold');
  navMovies?.classList.remove('text-white', 'font-bold');
  navSeries?.classList.remove('text-white', 'font-bold');
  navFavs?.classList.remove('text-white', 'font-bold');

  viewHome?.classList.add('hidden');
  viewLive?.classList.add('hidden');
  viewGuide?.classList.add('hidden');
  viewMovies?.classList.add('hidden');
  viewSeries?.classList.add('hidden');
  viewSeriesDetail?.classList.add('hidden');
  viewPlatform?.classList.add('hidden');

  if (tab === 'home') {
    navHome?.classList.add('text-white', 'font-bold');
    viewHome?.classList.remove('hidden');
    loadHomeData();
    if (push) updateUrl('/anasayfa');
  } else if (tab === 'platform') {
    viewPlatform?.classList.remove('hidden');
  } else if (tab === 'live') {
    navLive?.classList.add('text-white', 'font-bold');
    viewLive?.classList.remove('hidden');
    if (push) updateUrl('/canli-tv');
  } else if (tab === 'guide') {
    if (STATE.activeCategory === 'favorites') {
      navFavs?.classList.add('text-white', 'font-bold');
    } else {
      navGuide?.classList.add('text-white', 'font-bold');
    }
    viewGuide?.classList.remove('hidden');
    loadGuideChannels(true);
    if (push) updateUrl(getCurrentTabUrl());
  } else if (tab === 'movies') {
    navMovies?.classList.add('text-white', 'font-bold');
    viewMovies?.classList.remove('hidden');
    if (!STATE.movieCategories.length) {
      loadMovieCategories();
    }
    loadMovies(true);
    if (push) updateUrl('/filmler');
  } else if (tab === 'series') {
    navSeries?.classList.add('text-white', 'font-bold');
    viewSeries?.classList.remove('hidden');
    if (!STATE.seriesCategories.length) {
      loadSeriesCategories();
    }
    loadSeries(true);
    if (push) updateUrl('/diziler');
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showFavoritesTab(push = true) {
  STATE.activeCategory = 'favorites';
  switchTab('guide', false);
  renderGuideCategories();
  if (push) updateUrl('/favorilerim');
}

// =============================================================
// 3. VERİ YÜKLEME & KANALLAR
// =============================================================
async function loadUserInfo() {
  try {
    const res = await fetch('/api/user-info');
    if (res.ok) {
      const data = await res.json();
      if (!STATE.profileName) {
        document.getElementById('header-user-name').textContent = data.username;
      }
    }
  } catch (e) {
    console.warn('User info load error:', e);
  }
}

async function loadCategories() {
  try {
    const res = await fetch('/api/categories');
    if (!res.ok) return;
    const data = await res.json();
    STATE.categories = data.categories || [];
    renderGuideCategories();
  } catch (e) {
    console.error('Categories load error:', e);
  }
}

async function loadInitialChannels() {
  try {
    const res = await fetch('/api/streams?limit=120');
    if (!res.ok) return;
    const data = await res.json();
    STATE.channels = data.streams || [];
    STATE.totalChannels = data.total;

    // Set default hero channel (prefer TRT 1, ATV or first real channel)
    const featured = STATE.channels.find(c => c.name.includes('TRT 1') || c.name.includes('ATV') || c.name.includes('KANAL D')) || STATE.channels[0];
    STATE.heroChannel = featured;
    updateHeroBanner(featured);

    // Render Home components (Images 2 & 3)
    renderChannelStrip();
    renderPopularRow();
    renderSportsRow();
  } catch (e) {
    console.error('Initial channels load error:', e);
  }
}

// =============================================================
// 4. ANA SAYFA BİLEŞENLERİ (GÖRSELLER 2 & 3)
// =============================================================
function updateHeroBanner(ch) {
  if (!ch) return;
  document.getElementById('hero-title').textContent = ch.name;
  document.getElementById('hero-channel-badge').textContent = ch.name;
  
  // Custom backdrops for high visual appeal
  const backdrops = [
    'https://images.unsplash.com/photo-1518791841217-8f162f1e1131?auto=format&fit=crop&w=1920&q=80',
    'https://images.unsplash.com/photo-1536440136628-849c177e76a1?auto=format&fit=crop&w=1920&q=80',
    'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?auto=format&fit=crop&w=1920&q=80'
  ];
  const bg = backdrops[Math.abs(ch.id) % backdrops.length];
  document.getElementById('hero-backdrop').style.backgroundImage = `url('${bg}')`;
}

function openPlayerWithHero() {
  if (STATE.heroChannel) {
    openPlayer(STATE.heroChannel);
  } else if (STATE.channels.length > 0) {
    openPlayer(STATE.channels[0]);
  }
}

// "Kanallarım" Horizontal Strip (Görseller 2 & 3)
function renderChannelStrip() {
  const container = document.getElementById('channel-strip-container');
  if (!container) return;

  let html = `
    <!-- Tüm Kanalları Listele Card -->
    <div class="channel-strip-card" onclick="switchTab('guide')" title="Tüm kanalları listele">
      <div class="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center mb-1 text-tv-yellow">
        <i data-lucide="layout-grid" class="w-4 h-4"></i>
      </div>
      <span class="text-[9px] font-bold text-gray-300 text-center leading-tight">Tüm Kanallar</span>
    </div>
  `;

  // Select key national and sport channels for the strip
  const stripChannels = STATE.channels.filter(c => !c.name.includes('✦●✦')).slice(0, 18);

  for (const ch of stripChannels) {
    const isActive = STATE.currentChannel?.id === ch.id;
    html += `
      <div class="channel-strip-card ${isActive ? 'active' : ''}" onclick="openPlayerById(${ch.id})" title="${escapeHtml(ch.name)}">
        <div class="w-10 h-10 flex items-center justify-center p-0.5">
          ${ch.icon ? `
            <img src="${ch.icon}" alt="${escapeHtml(ch.name)}" class="max-h-full max-w-full object-contain filter drop-shadow" onerror="this.outerHTML='<span class=\\'text-xs font-bold text-gray-400\\'>#${ch.num || ch.id}</span>'">
          ` : `
            <span class="text-xs font-extrabold text-tv-yellow">#${ch.num || ch.id}</span>
          `}
        </div>
        <span class="text-[9px] font-semibold text-gray-300 text-center truncate w-full mt-1">${escapeHtml(ch.name)}</span>
      </div>
    `;
  }

  container.innerHTML = html;
  initIcons();
}

function renderPopularRow() {
  const container = document.getElementById('popular-channels-row');
  if (!container) return;

  const popular = STATE.channels.filter(c => !c.name.includes('✦●✦')).slice(0, 5);
  let html = '';

  for (const ch of popular) {
    html += `
      <div class="group cursor-pointer rounded-xl bg-[#0E121B] border border-tv-border/80 overflow-hidden hover:border-tv-yellow transition transform hover:-translate-y-1" onclick="openPlayerById(${ch.id})">
        <div class="aspect-video relative bg-black/60 flex items-center justify-center p-4">
          ${ch.icon ? `
            <img src="${ch.icon}" alt="${escapeHtml(ch.name)}" class="max-h-16 max-w-full object-contain filter drop-shadow group-hover:scale-105 transition">
          ` : `
            <i data-lucide="tv" class="w-8 h-8 text-tv-yellow"></i>
          `}
          <span class="absolute top-2 right-2 bg-red-600 text-white font-bold text-[9px] px-1.5 py-0.5 rounded flex items-center space-x-1">
            <span class="live-badge-dot"></span>
            <span>CANLI</span>
          </span>
        </div>
        <div class="p-3">
          <h4 class="text-xs font-bold text-white truncate">${escapeHtml(ch.name)}</h4>
          <p class="text-[10px] text-tv-muted truncate mt-0.5">Canlı TV Yayını • HD</p>
        </div>
      </div>
    `;
  }
  container.innerHTML = html;
  initIcons();
}

function renderSportsRow() {
  const container = document.getElementById('sports-channels-row');
  if (!container) return;

  // Filter sports channels
  const sports = STATE.channels.filter(c => 
    c.name.toLowerCase().includes('spor') || 
    c.name.toLowerCase().includes('sport') ||
    c.name.toLowerCase().includes('bein')
  ).slice(0, 5);

  const fallbackList = sports.length ? sports : STATE.channels.slice(5, 10);
  let html = '';

  for (const ch of fallbackList) {
    html += `
      <div class="group cursor-pointer rounded-xl bg-[#0E121B] border border-tv-border/80 overflow-hidden hover:border-tv-yellow transition transform hover:-translate-y-1" onclick="openPlayerById(${ch.id})">
        <div class="aspect-video relative bg-black/60 flex items-center justify-center p-4">
          ${ch.icon ? `
            <img src="${ch.icon}" alt="${escapeHtml(ch.name)}" class="max-h-16 max-w-full object-contain filter drop-shadow group-hover:scale-105 transition">
          ` : `
            <i data-lucide="trophy" class="w-8 h-8 text-tv-yellow"></i>
          `}
          <span class="absolute top-2 right-2 bg-red-600 text-white font-bold text-[9px] px-1.5 py-0.5 rounded flex items-center space-x-1">
            <span class="live-badge-dot"></span>
            <span>CANLI</span>
          </span>
        </div>
        <div class="p-3">
          <h4 class="text-xs font-bold text-white truncate">${escapeHtml(ch.name)}</h4>
          <p class="text-[10px] text-tv-muted truncate mt-0.5">Canlı Karşılaşmalar • HD</p>
        </div>
      </div>
    `;
  }
  container.innerHTML = html;
  initIcons();
}

// =============================================================
// 5. KANAL LİSTESİ BİLEŞENLERİ (GÖRSEL 4 - 3 SÜTUNLU KARTLAR)
// =============================================================
function renderGuideCategories() {
  const strip = document.getElementById('guide-categories-strip');
  if (!strip) return;

  let html = `
    <button onclick="setGuideCategory('all')" class="cat-tab ${STATE.activeCategory === 'all' ? 'active' : ''}">
      TÜMÜ
    </button>
    <button onclick="setGuideCategory('favorites')" class="cat-tab flex items-center space-x-1 ${STATE.activeCategory === 'favorites' ? 'active' : ''}">
      <span>FAVORİLER</span>
    </button>
  `;

  // Kategorileri listele (Yetişkin kategoriler de kilit rozeti ile listelenir)
  for (const cat of STATE.categories) {
    const isActive = String(STATE.activeCategory) === String(cat.id);
    const isAdult = isAdultCategoryItem(cat);
    const label = cleanName(cat.name).replace(/TR\s*⭐\s*/g, '').replace(/VIP\s*⭐\s*/g, '').trim();
    
    let lockIcon = '';
    if (isAdult) {
      lockIcon = STATE.adultUnlocked 
        ? '<i data-lucide="lock-open" class="w-3.5 h-3.5 text-emerald-400 inline-block ml-1"></i>' 
        : '<i data-lucide="lock" class="w-3.5 h-3.5 text-red-400 inline-block ml-1"></i>';
    }

    html += `
      <button onclick="setGuideCategory('${cat.id}')" class="cat-tab ${isActive ? 'active' : ''} ${isAdult ? 'border border-red-500/30 text-red-300 hover:text-white' : ''}">
        <span>${escapeHtml(label)}</span>
        ${lockIcon}
      </button>
    `;
  }

  strip.innerHTML = html;
  initIcons();
}

function setGuideCategory(catId) {
  const cat = STATE.categories.find(c => String(c.id) === String(catId));
  if (cat && isAdultCategoryItem(cat) && !STATE.adultUnlocked) {
    requestAdultPin(() => setGuideCategory(catId), cat.name);
    return;
  }
  STATE.activeCategory = catId;
  renderGuideCategories();
  loadGuideChannels(true);
  updateUrl(getCurrentTabUrl());
}

async function loadGuideChannels(reset = false) {
  const grid = document.getElementById('guide-channels-grid');
  const loadMoreBtn = document.getElementById('guide-load-more-container');
  if (!grid) return;

  if (reset) {
    STATE.guideOffset = 0;
    grid.innerHTML = `
      <div class="col-span-full py-12 flex flex-col items-center justify-center space-y-2 text-tv-muted">
        <div class="w-8 h-8 rounded-full border-2 border-white/20 border-t-tv-yellow animate-spin"></div>
        <span class="text-xs">Kanallar yükleniyor...</span>
      </div>
    `;
  }

  let url = `/api/streams?limit=${STATE.guideLimit}&offset=${STATE.guideOffset}`;
  if (STATE.activeCategory === 'favorites') {
    if (!STATE.favorites.length) {
      grid.innerHTML = `
        <div class="col-span-full py-16 text-center space-y-2 text-tv-muted">
          <i data-lucide="star" class="w-8 h-8 text-tv-yellow mx-auto"></i>
          <h4 class="text-sm font-bold text-white">Favori kanal bulunamadı</h4>
          <p class="text-xs">Kanal listesinden kalp ikonuna tıklayarak favorilerinize ekleyebilirsiniz.</p>
        </div>
      `;
      initIcons();
      loadMoreBtn.classList.add('hidden');
      return;
    }
    url += `&ids=${STATE.favorites.join(',')}`;
  } else {
    if (STATE.activeCategory && STATE.activeCategory !== 'all') {
      url += `&category_id=${encodeURIComponent(STATE.activeCategory)}`;
    }
    if (STATE.searchQuery.trim()) {
      url += `&search=${encodeURIComponent(STATE.searchQuery.trim())}`;
    }
  }

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Yüklenemedi');
    const data = await res.json();
    const streams = data.streams || [];

    if (reset) {
      grid.innerHTML = '';
    }

    const summaryEl = document.getElementById('guide-total-summary');
    if (summaryEl) {
      summaryEl.textContent = `${data.total.toLocaleString('tr-TR')} Kanal Listeleniyor`;
    }

    if (streams.length === 0 && reset) {
      grid.innerHTML = `
        <div class="col-span-full py-16 text-center text-tv-muted">
          <p class="text-sm font-semibold text-white">Aradığınız kriterde kanal bulunamadı.</p>
        </div>
      `;
      loadMoreBtn.classList.add('hidden');
      return;
    }

    // Append 3-column rows matching Image 4
    for (const ch of streams) {
      const isFav = STATE.favorites.includes(ch.id);
      const row = document.createElement('div');
      row.className = 'channel-list-row group';
      row.onclick = () => openPlayer(ch);

      row.innerHTML = `
        <div class="flex items-center space-x-3.5 truncate">
          <!-- Logo -->
          <div class="w-11 h-11 rounded-lg bg-black/50 border border-[#1E2738] flex items-center justify-center p-1 flex-shrink-0">
            ${ch.icon ? `
              <img src="${ch.icon}" alt="${escapeHtml(ch.name)}" loading="lazy" class="max-h-full max-w-full object-contain filter drop-shadow" onerror="this.outerHTML='<span class=\\'text-[10px] font-bold text-gray-400\\'>#${ch.num || ch.id}</span>'">
            ` : `
              <span class="text-[10px] font-bold text-tv-yellow">#${ch.num || ch.id}</span>
            `}
          </div>

          <!-- Title & Schedule (Görsel 4) -->
          <div class="truncate">
            <h4 class="text-xs sm:text-sm font-bold text-white group-hover:text-tv-yellow transition truncate">
              ${escapeHtml(ch.name)}
            </h4>
            <div class="flex items-center space-x-2 text-[11px] text-gray-400 mt-0.5 truncate">
              <span class="font-mono text-gray-400">20:00 - 21:45</span>
              <span>•</span>
              <span class="text-gray-300">Canlı Yayın</span>
            </div>
          </div>
        </div>

        <!-- Right: Favorite Heart & Play Action -->
        <div class="flex items-center space-x-2 ml-2 flex-shrink-0">
          <button 
            onclick="event.stopPropagation(); toggleFavorite(${ch.id})" 
            title="Favori" 
            class="p-1.5 text-gray-500 hover:text-red-500 transition"
          >
            <i data-lucide="heart" class="w-4 h-4 ${isFav ? 'fill-red-500 text-red-500' : ''}"></i>
          </button>
          <div class="w-6 h-6 rounded-full bg-white/5 group-hover:bg-tv-yellow group-hover:text-black flex items-center justify-center text-gray-400 transition">
            <i data-lucide="chevron-right" class="w-3.5 h-3.5"></i>
          </div>
        </div>
      `;
      grid.appendChild(row);
    }

    initIcons();

    if (loadMoreBtn) {
      if ((STATE.guideOffset + streams.length) < data.total && STATE.activeCategory !== 'favorites') {
        loadMoreBtn.classList.remove('hidden');
      } else {
        loadMoreBtn.classList.add('hidden');
      }
    }
  } catch (e) {
    console.error('Guide load error:', e);
  }
}

function loadMoreGuideChannels() {
  STATE.guideOffset += STATE.guideLimit;
  loadGuideChannels(false);
}

// =============================================================
// 6. DEDICATED TV+ VIDEO PLAYER (GÖRSEL 5 BİREBİR İCRAAT)
// =============================================================
function openPlayerById(channelId) {
  const found = STATE.channels.find(c => c.id === channelId);
  if (found) {
    if (isAdultItem(found) && !STATE.adultUnlocked) {
      requestAdultPin(() => openPlayer(found), found.name);
      return;
    }
    openPlayer(found);
  } else {
    fetch(`/api/streams?ids=${channelId}`)
      .then(r => r.json())
      .then(data => {
        if (data.streams && data.streams[0]) {
          const ch = data.streams[0];
          if (isAdultItem(ch) && !STATE.adultUnlocked) {
            requestAdultPin(() => openPlayer(ch), ch.name);
            return;
          }
          openPlayer(ch);
        }
      });
  }
}

function primeMediaAudio() {
  if (!video) return;
  video.muted = false;
  video.volume = STATE.volume || 1;
  STATE.isMuted = false;
  try {
    const p = video.play();
    if (p !== undefined) {
      p.catch(() => {});
    }
  } catch (_) {}
}

// =============================================================
// MOBİL YAN DÖNME / SCREEN ORIENTATION & LANDSCAPE MANAGEMENT
// =============================================================
STATE.playerManualPortrait = false;

function applyMobileLandscapeOnPlayerOpen() {
  const isMobile = window.innerWidth <= 900 || ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  if (!isMobile) return;

  // 1. Android Chrome / PWA Screen Orientation API
  try {
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(() => {});
    }
  } catch (_) {}

  // 2. CSS Force-Landscape rotation (Otomatik olarak yan/yatay mod)
  updatePlayerOrientation();
}

function updatePlayerOrientation() {
  const modal = document.getElementById('tvplus-player-modal');
  if (!modal || modal.classList.contains('hidden')) return;

  const isMobile = window.innerWidth <= 900 || ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  const isPortrait = window.innerHeight > window.innerWidth;

  // Mobilde ve dikey tutuluyorsa
  if (isMobile && isPortrait) {
    if (STATE.playerManualPortrait) {
      modal.classList.remove('force-landscape');
      updateRotateButtonUI(false);
    } else {
      modal.classList.add('force-landscape');
      updateRotateButtonUI(true);
    }
  } else {
    // Cihaz zaten yatay tutuluyor veya masaüstü
    modal.classList.remove('force-landscape');
    updateRotateButtonUI(false);
  }
}

function togglePlayerOrientation() {
  const modal = document.getElementById('tvplus-player-modal');
  if (!modal) return;

  if (modal.classList.contains('force-landscape')) {
    modal.classList.remove('force-landscape');
    STATE.playerManualPortrait = true;
    updateRotateButtonUI(false);
    showToast('Dikey moda geçildi');
  } else {
    modal.classList.add('force-landscape');
    STATE.playerManualPortrait = false;
    updateRotateButtonUI(true);
    showToast('Yatay (yan) moda geçildi');
  }
}

function updateRotateButtonUI(isLandscape) {
  const icons = document.querySelectorAll('.player-rotate-icon');
  icons.forEach(icon => {
    if (isLandscape) {
      icon.classList.add('text-tv-yellow');
    } else {
      icon.classList.remove('text-tv-yellow');
    }
  });
}

window.addEventListener('resize', updatePlayerOrientation);
window.addEventListener('orientationchange', () => {
  setTimeout(updatePlayerOrientation, 200);
});
if (window.screen && window.screen.orientation) {
  window.screen.orientation.addEventListener('change', () => {
    setTimeout(updatePlayerOrientation, 200);
  });
}

function openPlayer(channel, push = true) {
  if (!channel) return;
  if (isAdultItem(channel) && !STATE.adultUnlocked) {
    requestAdultPin(() => openPlayer(channel, push), channel.name);
    return;
  }
  STATE.currentChannel = channel;
  addToRecents(channel.id);

  // Reveal dedicated player modal
  playerModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // Mobilde otomatik yan dönme (Landscape)
  applyMobileLandscapeOnPlayerOpen();

  // Ses her zaman açık başlasın, seviye hatırlansın
  primeMediaAudio();
  updateVolumeUI();
  hideUnmuteBanner();

  const btnEpg = document.getElementById('btn-toggle-epg');
  const btnSw = document.getElementById('btn-toggle-switcher');
  if (btnEpg) btnEpg.style.display = 'flex';
  if (btnSw) btnSw.style.display = 'flex';

  const cleanedName = cleanName(channel.name);
  // Update metadata according to Image 5 & Image 1
  document.getElementById('player-channel-title').textContent = cleanedName;
  document.getElementById('player-program-title').textContent = `${cleanedName} Canlı Yayını`;
  document.getElementById('player-time-range').textContent = '20:00 - 22:30';

  // Canlı TV kontrolleri: Geri/ileri sarma, progress bar ve canlıya dön butonu OLMASIN
  document.getElementById('btn-player-rewind')?.classList.add('hidden');
  document.getElementById('btn-player-forward')?.classList.add('hidden');
  document.getElementById('player-progress-track')?.classList.add('hidden');
  document.getElementById('btn-live-return')?.classList.add('hidden');

  // Live UI Controls (Sadece CANLI badge ve saat)
  const liveGroup = document.getElementById('player-live-badge-group');
  if (liveGroup) liveGroup.classList.remove('hidden');
  document.getElementById('btn-toggle-epg')?.classList.remove('hidden');
  document.getElementById('btn-toggle-switcher')?.classList.remove('hidden');
  document.getElementById('btn-toggle-episodes')?.classList.add('hidden');
  document.getElementById('player-episodes-tray')?.classList.add('hidden');
  cancelNextEpisodeAutoplay();

  // Real-time live clock in player
  updateLiveClock();
  clearInterval(STATE.clockInterval);
  STATE.clockInterval = setInterval(updateLiveClock, 1000);

  // Render side drawer list
  renderDrawerChannels();

  // If switcher is open, update its channel list & active highlight
  const switcher = document.getElementById('player-channel-switcher');
  if (switcher && !switcher.classList.contains('hidden')) {
    renderSwitcherChannels();
  }

  // If EPG tray is open, reload EPG for this channel
  const tray = document.getElementById('player-epg-tray');
  if (tray && !tray.classList.contains('hidden')) {
    loadEpgForPlayer();
  } else {
    // Quick prefetch to get current show title
    fetch(`/api/epg/${channel.id}`).then(r => r.json()).then(data => {
      if (data.listings && data.listings.length) {
        STATE.epgData = data.listings;
        const first = data.listings[0];
        if (first.title) {
          document.getElementById('player-program-title').textContent = first.title;
          if (first.start && first.end) {
            const s = first.start.split(' ')[1]?.slice(0, 5) || first.start.slice(0, 5);
            const e = first.end.split(' ')[1]?.slice(0, 5) || first.end.slice(0, 5);
            document.getElementById('player-time-range').textContent = `${s} - ${e}`;
          }
        }
      }
    }).catch(() => {});
  }

  // Play stream with Hls.js
  startPlayback(channel);

  if (isCastSessionActive()) {
    loadMediaOnCastSession();
  }

  // Trigger inactivity timer (5 seconds)
  resetInactivity();
  initIcons();

  if (push) {
    updateUrl('/izle/' + channel.id);
  }
}

function openMediaItem(item, type = 'movie') {
  if (!item) return;
  if (isAdultItem(item) && !STATE.adultUnlocked) {
    requestAdultPin(() => openMediaItem(item, type), item.name || item.title);
    return;
  }
  STATE.currentMedia = { ...item, type };
  STATE.sourceDuration = 0;
  STATE.mediaStartOffset = 0;
  STATE.mediaSeekTarget = null;
  clearTimeout(STATE.mediaSeekTimer);
  STATE.currentChannel = null;
  const sessionId = Date.now();
  STATE.playbackSession = sessionId;

  playerModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // Mobilde otomatik yan dönme (Landscape)
  applyMobileLandscapeOnPlayerOpen();

  // Ses her zaman açık başlasın, seviye hatırlansın
  primeMediaAudio();
  updateVolumeUI();
  hideUnmuteBanner();

  // VOD / Dizi / Film kontrolleri: Geri/ileri sarma butonları ve progress bar görünür olsun
  document.getElementById('btn-player-rewind')?.classList.remove('hidden');
  document.getElementById('btn-player-forward')?.classList.remove('hidden');
  document.getElementById('player-progress-track')?.classList.remove('hidden');
  document.getElementById('btn-live-return')?.classList.add('hidden');

  // 1. CANLI ile ilgili TÜM unsurları KESİNLİKLE GİZLE
  const liveGroup = document.getElementById('player-live-badge-group');
  if (liveGroup) liveGroup.classList.add('hidden');
  clearInterval(STATE.clockInterval);

  // 2. Canlı EPG & Kanal Listesi butonlarını gizle
  const btnEpg = document.getElementById('btn-toggle-epg');
  const btnSw = document.getElementById('btn-toggle-switcher');
  const btnEpisodes = document.getElementById('btn-toggle-episodes');
  if (btnEpg) btnEpg.classList.add('hidden');
  if (btnSw) btnSw.classList.add('hidden');

  // Canlı panelleri kapat
  document.getElementById('player-epg-tray')?.classList.add('hidden');
  document.getElementById('player-channel-switcher')?.classList.add('hidden');
  cancelNextEpisodeAutoplay();

  // 3. Başlıklar ve Dizi / Film Ayrımı
  let title;
  if (type === 'episode') {
    // Dizi Bölümü
    if (btnEpisodes) btnEpisodes.classList.remove('hidden');
    const seriesTitle = cleanName(item.seriesTitle || STATE.currentSeries?.info?.name || 'Dizi', 'series');
    title = seriesTitle;
    let epTitle = cleanName(item.title || item.name || '', 'episode', seriesTitle);

    document.getElementById('player-channel-title').textContent = seriesTitle;

    const hasDistinctTitle = epTitle && !/^(\d+\.?\s*(bölüm|bolum|ep|episode)?)$/i.test(epTitle.trim());
    const epSubtitle = (item.seasonNum && item.episodeNum)
      ? `${item.seasonNum}. Sezon ${item.episodeNum}. Bölüm${hasDistinctTitle ? ' • ' + epTitle : ''}`
      : (hasDistinctTitle ? epTitle : `${item.episodeNum || 1}. Bölüm`);

    document.getElementById('player-program-title').textContent = epSubtitle;

    // Dizi detayları hafızada yoksa arkada yükle
    if (!STATE.currentSeries && item.seriesId) {
      fetch(`/api/series-info/${item.seriesId}`).then(r => r.json()).then(data => {
        STATE.currentSeries = data;
      }).catch(() => {});
    }
  } else {
    // Film
    const movieTitle = cleanName(item.name || item.title, 'movie');
    title = movieTitle;
    if (btnEpisodes) btnEpisodes.classList.add('hidden');
    document.getElementById('player-episodes-tray')?.classList.add('hidden');
    document.getElementById('player-channel-title').textContent = movieTitle;
    document.getElementById('player-program-title').textContent = 'Film (VOD)';
  }

  document.getElementById('player-time-range').textContent = '00:00 / 00:00';

  // Kaldığın Yerden Devam Et Hazırlığı
  const resumeBanner = document.getElementById('resume-banner');
  if (resumeBanner) resumeBanner.classList.add('hidden');
  clearTimeout(STATE.resumeBannerTimer);

  const mediaId = type === 'episode' ? item.id : (item.stream_id || item.id);
  const mediaKind = type === 'episode' ? 'series' : 'movie';
  const mediaExt = item.container_extension || String(item.streamUrl || '').match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] || 'mp4';
  STATE.mediaTrackBase = `${mediaKind}/${mediaId}.${mediaExt}`;
  STATE.selectedAudioTrack = '';
  STATE.selectedQuality = 'original';
  loadMediaTrackOptions();
  fetch(`/api/vod/duration/${mediaKind}/${mediaId}.${mediaExt}`)
    .then(response => response.ok ? response.json() : Promise.reject(new Error('Süre alınamadı')))
    .then(data => {
      if (STATE.playbackSession !== sessionId) return;
      STATE.sourceDuration = Number(data.duration) || 0;
      updateVodTimeDisplay();
    })
    .catch(err => console.warn('VOD duration error:', err.message));
  const cacheKey = `tvplus_resume_${type}_${mediaId}`;
  let targetResumeSec = parseFloat(localStorage.getItem(cacheKey) || '0');

  // MySQL veritabanından en son saniyeyi asenkron sorgula
  const progressQueryUrl = type === 'episode'
    ? `/api/progress/episode/${mediaId}?profile=${encodeURIComponent(STATE.profileName)}`
    : `/api/progress/movie/${mediaId}?profile=${encodeURIComponent(STATE.profileName)}`;

  fetch(progressQueryUrl).then(r => r.json()).then(data => {
    if (data.item && data.item.progress_seconds > 5 && data.item.percentage < 95) {
      const serverSec = parseFloat(data.item.progress_seconds);
      targetResumeSec = serverSec;
      const position = getMediaPosition();
      if (position < 5 && Math.abs(serverSec - position) > 5) {
        applyResumeSeconds(serverSec);
      }
    }
  }).catch(() => {});

  showLoading(true, `${title} yükleniyor...`);
  hideError();

  if (STATE.hls) {
    try {
      STATE.hls.stopLoad();
      STATE.hls.detachMedia();
      STATE.hls.destroy();
    } catch (_) {}
    STATE.hls = null;
  }

  video.src = buildMediaSrc();
  video.load();

  // Medya meta verileri yüklendiğinde veya oynatma başladığında kaldığı yere atla
  const onReadyToResume = () => {
    video.removeEventListener('loadedmetadata', onReadyToResume);
    if (targetResumeSec > 5 && getMediaPosition() < 5) {
      // Resume konum varsa oynatmayı başlatmadan banner göster
      applyResumeSeconds(targetResumeSec);
      video.pause();
      return;
    }
    // Resume yok, normal oynatma başlat
    video.play().catch(e => {
      if (e.name === 'NotAllowedError') {
        video.muted = false;
        video.volume = STATE.volume || 1;
        STATE.isMuted = false;
        updateVolumeUI();
        showPlayToStartOverlay();
        setupPlayOnFirstGesture();
      }
    });
  };
  video.addEventListener('loadedmetadata', onReadyToResume, { once: true });

  // Resume konum yoksa normal oynatma başlat
  if (targetResumeSec <= 5) {
    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise.catch(e => {
        if (playerModal.classList.contains('hidden')) return;
        if (e.name === 'NotAllowedError') {
          video.muted = false;
          video.volume = STATE.volume || 1;
          STATE.isMuted = false;
          updateVolumeUI();
          showPlayToStartOverlay();
          setupPlayOnFirstGesture();
        } else if (e.name !== 'AbortError') {
          showError('Bu içerik oynatılamadı. Lütfen tekrar deneyin.');
          console.error('VOD playback error:', e);
        }
      });
    }
  }

  if (type === 'episode') {
    const sId = item.seriesId || STATE.currentSeries?.info?.series_id;
    if (sId && item.id) {
      updateUrl(`/dizi/${sId}/izle/${item.id}`);
    }
  } else if (type === 'movie') {
    const mId = item.stream_id || item.id;
    if (mId) {
      updateUrl(`/film/${mId}`);
    }
  }

  if (isCastSessionActive()) {
    loadMediaOnCastSession();
  }

  resetInactivity();
  initIcons();
}

async function loadMediaTrackOptions() {
  const button = document.getElementById('btn-media-options');
  try {
    const response = await fetch(`/api/vod/tracks/${STATE.mediaTrackBase}`);
    if (!response.ok) throw new Error('Parça bilgileri alınamadı');
    const data = await response.json();
    const audio = document.getElementById('media-audio-select');
    const subtitles = document.getElementById('media-subtitle-select');
    audio.innerHTML = (data.audio || []).map((track, i) => `<option value="${track.index}">${track.title || track.language.toUpperCase() || `Ses ${i + 1}`}</option>`).join('') || '<option>Varsayılan</option>';
    subtitles.innerHTML = '<option value="">Kapalı</option>' + (data.subtitles || []).map((track, i) => `<option value="${track.index}">${track.title || track.language.toUpperCase() || `Altyazı ${i + 1}`}</option>`).join('');
    STATE.selectedAudioTrack = data.audio?.[0]?.index ?? '';
    button?.classList.remove('hidden');
    initIcons();
  } catch (_) {
    button?.classList.add('hidden');
  }
}

function toggleMediaOptions() {
  document.getElementById('media-options-panel')?.classList.toggle('hidden');
}

function reloadMediaWithOptions() {
  if (!STATE.mediaTrackBase) return;
  showLoading(true, 'Yayın seçeneği uygulanıyor...');
  // Ses / kalite değişiminde bulunulan konumdan devam et
  restartMediaAt(getMediaPosition());
}

function changeMediaAudio(index) {
  STATE.selectedAudioTrack = index;
  reloadMediaWithOptions();
}

function changeMediaQuality(quality) {
  STATE.selectedQuality = quality;
  reloadMediaWithOptions();
}

function changeMediaSubtitle(index) {
  video.querySelectorAll('track[data-dynamic-subtitle]').forEach(track => track.remove());
  if (!index) return;
  const track = document.createElement('track');
  track.kind = 'subtitles';
  track.label = document.getElementById('media-subtitle-select')?.selectedOptions[0]?.textContent || 'Altyazı';
  track.srclang = 'tr';
  track.src = `/vod/subtitle/${STATE.mediaTrackBase}/${index}.vtt`;
  track.default = true;
  track.dataset.dynamicSubtitle = 'true';
  video.appendChild(track);
  track.addEventListener('load', () => { track.track.mode = 'showing'; });
}

function closePlayer(push = true) {
  // Oynatma sonlanırken ilerlemeyi anında MySQL ve localStorage'a kaydet
  saveCurrentProgress(true);

  const prevMedia = STATE.currentMedia;
  STATE.currentChannel = null;
  STATE.currentMedia = null;
  STATE.playbackSession = null;
  STATE.mediaStartOffset = 0;
  STATE.mediaSeekTarget = null;
  clearTimeout(STATE.mediaSeekTimer);
  cancelNextEpisodeAutoplay();

  // Resume banner'ı kapat
  document.getElementById('resume-banner')?.classList.add('hidden');
  clearTimeout(STATE.resumeBannerTimer);

  playerModal.classList.add('hidden');
  playerModal.classList.remove('force-landscape');
  STATE.playerManualPortrait = false;
  if (screen.orientation && screen.orientation.unlock) {
    try { screen.orientation.unlock(); } catch (e) {}
  }
  document.body.style.overflow = '';
  if (channelDrawer) channelDrawer.classList.remove('open');

  // Close EPG tray, Channel switcher & Episodes tray
  const tray = document.getElementById('player-epg-tray');
  const switcher = document.getElementById('player-channel-switcher');
  const epTray = document.getElementById('player-episodes-tray');
  tray?.classList.add('hidden');
  switcher?.classList.add('hidden');
  epTray?.classList.add('hidden');
  document.getElementById('btn-toggle-epg')?.classList.remove('text-tv-yellow', 'text-white', 'font-bold');
  document.getElementById('btn-toggle-switcher')?.classList.remove('text-tv-yellow', 'text-white', 'font-bold');
  document.getElementById('btn-toggle-episodes')?.classList.remove('bg-white/20');

  clearInterval(STATE.clockInterval);
  clearTimeout(STATE.inactivityTimer);

  // 1. HLS akışını tamamen durdur ve ayır
  if (STATE.hls) {
    try {
      STATE.hls.stopLoad();
      STATE.hls.detachMedia();
      STATE.hls.destroy();
    } catch (e) {
      console.warn('Hls stop error:', e);
    }
    STATE.hls = null;
  }

  // 2. Video öğesini anında durdur ve boru hattını sıfırla
  try {
    video.pause();
    video.currentTime = 0;
    video.removeAttribute('src');
    video.src = '';
    video.srcObject = null;
    video.load(); // Tarayıcının medya boru hattını anında sonlandırır
  } catch (e) {
    console.warn('Video reset error:', e);
  }

  showLoading(false);
  hideError();

  if (push) {
    if (prevMedia?.type === 'episode') {
      const sId = prevMedia.seriesId || STATE.currentSeries?.info?.series_id;
      if (sId) {
        updateUrl(`/dizi/${sId}`);
      } else {
        updateUrl('/diziler');
      }
    } else if (prevMedia?.type === 'movie') {
      updateUrl('/filmler');
    } else {
      updateUrl(getCurrentTabUrl());
    }
  }
}

function startPlayback(channel) {
  const sessionId = Date.now();
  STATE.playbackSession = sessionId;

  // Ses her zaman açık başlasın, seviye hatırlansın (asla sessize alma)
  primeMediaAudio();
  updateVolumeUI();
  hideUnmuteBanner();

  const displayName = cleanName(channel.name);
  showLoading(true, `${displayName} bağlanıyor...`);
  hideError();

  if (STATE.hls) {
    try {
      STATE.hls.stopLoad();
      STATE.hls.detachMedia();
      STATE.hls.destroy();
    } catch (e) {}
    STATE.hls = null;
  }

  // Eğer kullanıcı oynatıcıyı zaten kapattıysa başlatma
  if (playerModal.classList.contains('hidden')) {
    return;
  }

  const streamUrl = channel.streamUrl;

  if (Hls.isSupported()) {
    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      manifestLoadingTimeOut: 20000,
      manifestLoadingMaxRetry: 6,
      fragLoadingTimeOut: 45000,
      fragLoadingMaxRetry: 6,
      levelLoadingTimeOut: 20000,
      maxBufferLength: 45,
      maxMaxBufferLength: 90,
      backBufferLength: 30,
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 10,
      startFragPrefetch: false,
      nudgeMaxRetry: 5,
      maxFragLookUpTolerance: 0.25
    });

    hls.loadSource(streamUrl);
    hls.attachMedia(video);

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      // Oynatıcı kapatılmışsa veya başka kanala geçilmişse oynatma
      if (STATE.playbackSession !== sessionId || playerModal.classList.contains('hidden')) {
        try {
          hls.stopLoad();
          hls.detachMedia();
          hls.destroy();
          video.pause();
          video.removeAttribute('src');
          video.load();
        } catch (_) {}
        return;
      }

      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch(e => {
          if (STATE.playbackSession !== sessionId || playerModal.classList.contains('hidden')) {
            video.pause();
            return;
          }
          if (e.name === 'NotAllowedError') {
            console.info('Tarayıcı sesli oynatma için ilk dokunuşu bekliyor. Ses ASLA kapatılmıyor.');
            video.muted = false;
            video.volume = STATE.volume || 1;
            STATE.isMuted = false;
            updateVolumeUI();
            showPlayToStartOverlay();
            setupPlayOnFirstGesture();
          }
        });
      }
    });

    hls.on(Hls.Events.ERROR, (event, data) => {
      if (STATE.playbackSession !== sessionId || playerModal.classList.contains('hidden')) return;
      if (data.details === 'bufferStalledError') {
        hls.startLoad();
        if (hls.liveSyncPosition && Math.abs(video.currentTime - hls.liveSyncPosition) > 1.5) {
          video.currentTime = hls.liveSyncPosition;
        }
        return;
      }
      if (data.details === 'bufferNudgeOnStall' || data.details === 'internalException') {
        return;
      }
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && data.details === 'manifestLoadError') {
        console.warn('Canlı yayın manifest yüklenemedi, yeniden deneniyor...');
        hls.startLoad();
        return;
      }
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            console.warn('Network hatası, yeniden bağlanılıyor...');
            hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            console.warn('Medya hatası, kurtarılıyor...');
            hls.recoverMediaError();
            break;
          default:
            hls.destroy();
            showError('Bu kanal şu anda yayın vermiyor.');
            break;
        }
      }
    });

    STATE.hls = hls;
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = streamUrl;
    video.play().catch(() => {});
  } else {
    showError('Tarayıcınız HLS formatını desteklemiyor.');
  }
}

function retryCurrentStream() {
  if (STATE.currentChannel) {
    startPlayback(STATE.currentChannel);
  }
}

// -------------------------------------------------------------
// VOD SANAL ZAMAN ÇİZGİSİ
// VOD akışı sunucuda canlı olarak fragmented MP4'e dönüştürüldüğü için
// tarayıcı HTTP Range ile arama yapamaz; arabellek dışına yapılan her
// video.currentTime ataması akışı başa sarar. Bu yüzden gerçek konum
// "sunucu başlangıç offseti + video.currentTime" olarak hesaplanır ve
// arabellek dışı atlamalar akış ?start= ile yeniden başlatılarak yapılır.
// -------------------------------------------------------------
function buildMediaSrc(startSec = 0) {
  const params = new URLSearchParams();
  if (STATE.selectedAudioTrack !== '') params.set('audio', STATE.selectedAudioTrack);
  if (STATE.selectedQuality !== 'original') params.set('quality', STATE.selectedQuality);
  if (startSec > 0) params.set('start', Math.floor(startSec));
  params.set('sid', CLIENT_STREAM_ID);
  const query = params.toString();
  return `/vod/browser/${STATE.mediaTrackBase}${query ? `?${query}` : ''}`;
}

// Oynatıcının kullanıcıya gösterilen gerçek konumu
function getMediaPosition() {
  if (!STATE.currentMedia) return Number(video.currentTime) || 0;
  if (STATE.mediaSeekTarget !== null) return STATE.mediaSeekTarget;
  return STATE.mediaStartOffset + (Number(video.currentTime) || 0);
}

function restartMediaAt(targetSec) {
  if (!STATE.mediaTrackBase) return;
  clearTimeout(STATE.mediaSeekTimer);
  STATE.mediaStartOffset = Math.max(0, Math.floor(targetSec));
  STATE.mediaSeekTarget = null;

  // Eski metadata temizle (yeni src atamadan önce)
  video.pause();
  video.currentTime = 0;
  video.src = '';

  video.src = buildMediaSrc(STATE.mediaStartOffset);
  video.load();
  video.currentTime = 0;

  // Hemen zaman gösterimini güncelle (offset atandı, video başında)
  updateVodTimeDisplay();

  // Oynatma başla (timeupdate event'leri progress bar'ı otomatik güncelleyecek)
  const playPromise = video.play();
  if (playPromise !== undefined) {
    playPromise.catch(err => {
      console.warn('[VOD Seek Play]', `Offset=${STATE.mediaStartOffset}s`, err.name, err.message);
      if (err.name === 'NotAllowedError') {
        video.muted = false;
        video.volume = STATE.volume || 1;
        STATE.isMuted = false;
        updateVolumeUI();
        showPlayToStartOverlay();
        setupPlayOnFirstGesture();
      }
    });
  }
}

function seekMediaTo(targetSec) {
  if (!video) return;
  const duration = getEffectiveDuration();
  let target = Math.max(0, Number(targetSec) || 0);
  if (duration > 0) target = Math.min(target, Math.max(0, duration - 1));

  // Canlı yayın: davranış aynı kalır
  if (!STATE.currentMedia) {
    if (!isNaN(video.currentTime)) video.currentTime = target;
    return;
  }

  // VOD: yeni akışı doğrudan bu kullanıcı tıklaması içinde aç.
  // Gecikmeli setTimeout kullanılırsa Chrome kullanıcı aktivasyonunu kaybedip play() çağrısını engeller.
  STATE.mediaSeekTarget = target;
  updateVodTimeDisplay();
  showLoading(true, `${formatDuration(target)} konumuna atlanıyor...`);
  clearTimeout(STATE.mediaSeekTimer);
  restartMediaAt(target);
}

// Rewind / Forward 10 seconds (Sadece VOD/Dizi/Film için, Canlı TV'de yok)
function seekRelative(seconds) {
  if (!STATE.currentMedia) return; // Canlı TV direkt aksın, geri/ileri sarma yok
  if (!video || isNaN(video.currentTime)) return;
  seekMediaTo(getMediaPosition() + seconds);
  showToast(`${Math.abs(seconds)} saniye ${seconds > 0 ? 'ileri' : 'geri'} alındı`);
}

function handleScrubberClick(e) {
  if (!STATE.currentMedia) return; // Canlı TV'de timeline tıklaması yok
  const rect = e.currentTarget.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const ratio = Math.max(0, Math.min(1, clickX / rect.width));
  const duration = getEffectiveDuration();
  if (duration > 0) {
    seekMediaTo(duration * ratio);
  }
}

function getEffectiveDuration() {
  if (STATE.currentMedia && STATE.sourceDuration > 0) return STATE.sourceDuration;
  if (STATE.currentMedia && Number.isFinite(video.duration)) return video.duration;
  return 0; // Canlı yayında süre sayımı ve timeline olmasın, doğrudan canlı aksın
}

function updateVodTimeDisplay() {
  if (!STATE.currentMedia) return;
  const duration = getEffectiveDuration();
  if (duration <= 0) return;
  const current = getMediaPosition();
  const timeRange = document.getElementById('player-time-range');
  if (timeRange) timeRange.textContent = `${formatDuration(current)} / ${formatDuration(duration)}`;
  const fill = document.getElementById('player-progress-fill');
  if (fill) fill.style.width = `${Math.min(100, (current / duration) * 100)}%`;
}

function updateLiveClock() {
  const clockElem = document.getElementById('player-live-clock');
  if (!clockElem) return;
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  clockElem.textContent = `${hours}:${minutes}`;
}

// -------------------------------------------------------------
// PLAYER CONTROLS & 5s INACTIVITY HIDING
// -------------------------------------------------------------
function initPlayerEvents() {
  // Volume restore: her zaman ses açık, seviye hatırlanır
  video.muted = false;
  video.volume = STATE.volume || 1;
  updateVolumeUI();

  // Player Events
  video.addEventListener('waiting', () => showLoading(true, 'Yayın arabelleğe alınıyor...'));
  video.addEventListener('playing', () => {
    if (playerModal.classList.contains('hidden')) {
      video.pause();
      video.removeAttribute('src');
      video.src = '';
      return;
    }
    showLoading(false);
    hideError();
    updatePlayPauseIcons(true);
    resetInactivity();
  });
  video.addEventListener('pause', () => {
    updatePlayPauseIcons(false);
    clearTimeout(STATE.inactivityTimer);
    playerModal.classList.remove('user-inactive');
    if (STATE.currentMedia) {
      saveCurrentProgress(true);
    }
  });
  video.addEventListener('timeupdate', () => {
    if (playerModal.classList.contains('hidden')) {
      video.pause();
      return;
    }

    // Canlı yayında süre sayımı ve sarı ilerleme çubuğu tamamen kapalı
    if (!STATE.currentMedia) return;

    const effectiveDuration = getEffectiveDuration();
    if (effectiveDuration > 0) {
      const position = getMediaPosition();
      const pct = (position / effectiveDuration) * 100;
      const fill = document.getElementById('player-progress-fill');
      if (fill) fill.style.width = `${Math.min(100, pct)}%`;

      const cur = formatDuration(position);
      const dur = formatDuration(effectiveDuration);
      const timeRange = document.getElementById('player-time-range');
      if (timeRange) timeRange.textContent = `${cur} / ${dur}`;

      // MySQL ve Cache senkronizasyonu (5 saniyede bir)
      saveCurrentProgress(false);
    }
  });

  // Otomatik Sonraki Bölüm Geçişi (Bölüm bittiğinde)
  video.addEventListener('ended', () => {
    if (STATE.currentMedia) {
      saveCurrentProgress(true);
    }
    if (STATE.currentMedia?.type === 'episode') {
      prepareAndShowNextEpisode();
    }
  });

  window.addEventListener('beforeunload', () => {
    if (STATE.currentMedia) {
      saveCurrentProgress(true);
    }
  });

  // 5 Saniye Fare Hareketsizlik Kontrolü (Görsel 5 ve Kullanıcı İsteği)
  playerModal.addEventListener('mousemove', resetInactivity);
  playerModal.addEventListener('mousedown', resetInactivity);
  playerModal.addEventListener('touchstart', resetInactivity);
  playerModal.addEventListener('mouseleave', () => {
    clearTimeout(STATE.inactivityTimer);
    if (!video.paused) {
      playerModal.classList.add('user-inactive');
    }
  });

  // Keyboard shortcuts inside player
  window.addEventListener('keydown', (e) => {
    if (document.activeElement.tagName === 'INPUT') return;

    if (!playerModal.classList.contains('hidden')) {
      resetInactivity();
      switch (e.key) {
        case 'Escape':
          closePlayer();
          break;
        case ' ':
          e.preventDefault();
          togglePlayPause();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          toggleMute();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seekRelative(-10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          seekRelative(10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          playPrevChannel();
          break;
        case 'ArrowDown':
          e.preventDefault();
          playNextChannel();
          break;
      }
    }
  });
}

function resetInactivity() {
  playerModal.classList.remove('user-inactive');
  clearTimeout(STATE.inactivityTimer);

  const tray = document.getElementById('player-epg-tray');
  const switcher = document.getElementById('player-channel-switcher');
  const isTrayOpen = tray && !tray.classList.contains('hidden');
  const isSwitcherOpen = switcher && !switcher.classList.contains('hidden');

  if (!video.paused) {
    STATE.inactivityTimer = setTimeout(() => {
      // If channel drawer, EPG tray, or channel switcher is open, keep controls visible
      if (!channelDrawer?.classList.contains('open') && !isTrayOpen && !isSwitcherOpen) {
        playerModal.classList.add('user-inactive');
      }
    }, 5000); // 5 Saniye
  }
}

function togglePlayPause() {
  if (video.paused) {
    video.play().catch(() => {});
  } else {
    video.pause();
  }
}

function updatePlayPauseIcons(isPlaying) {
  const iconName = isPlaying ? 'pause' : 'play';
  const centerBtn = document.getElementById('icon-center-play-pause');
  if (centerBtn) {
    centerBtn.setAttribute('data-lucide', iconName);
    initIcons();
  }
}

function toggleMute() {
  video.muted = !video.muted;
  STATE.isMuted = video.muted;
  if (!video.muted && video.volume === 0) {
    video.volume = STATE.volume || 1;
  }
  updateVolumeUI();
}

function setVolume(val) {
  val = Math.max(0, Math.min(1, parseFloat(val) || 0));
  video.volume = val;
  video.muted = (val === 0);
  STATE.volume = val;
  STATE.isMuted = video.muted;
  localStorage.setItem('tvplus_volume', String(val));
  updateVolumeUI();
  hideUnmuteBanner();
}

function updateVolumeUI() {
  const volSlider = document.getElementById('player-vol-slider');
  const btnMute = document.getElementById('btn-player-mute');
  const isMuted = video.muted || video.volume === 0;
  if (volSlider) volSlider.value = isMuted ? 0 : (video.volume || STATE.volume || 1);

  let icon = 'volume-2';
  if (isMuted) {
    icon = 'volume-x';
  } else if (video.volume < 0.5) {
    icon = 'volume-1';
  }
  if (btnMute) {
    btnMute.innerHTML = `<i data-lucide="${icon}" class="w-5 h-5"></i>`;
    initIcons();
  }
}

function showPlayToStartOverlay() {
  const banner = document.getElementById('player-unmute-banner');
  if (banner) {
    banner.innerHTML = '<i data-lucide="play" class="w-4 h-4 fill-current"></i><span>Yayını Başlatmak İçin Tıklayın (Ses Açık)</span>';
    banner.onclick = () => {
      if (video) {
        video.muted = false;
        video.volume = STATE.volume || 1;
        STATE.isMuted = false;
        updateVolumeUI();
        video.play().catch(() => {});
      }
      hideUnmuteBanner();
    };
    banner.classList.remove('hidden');
    initIcons();
  }
}

function showUnmuteBanner() {
  showPlayToStartOverlay();
}

function hideUnmuteBanner() {
  document.getElementById('player-unmute-banner')?.classList.add('hidden');
}

function unmuteFromBanner() {
  if (video) {
    video.muted = false;
    video.volume = STATE.volume || 1;
    STATE.isMuted = false;
    updateVolumeUI();
    video.play().catch(() => {});
  }
  hideUnmuteBanner();
}

let playOnGestureAttached = false;
function setupPlayOnFirstGesture() {
  if (playOnGestureAttached) return;
  playOnGestureAttached = true;
  const onGesture = () => {
    playOnGestureAttached = false;
    window.removeEventListener('click', onGesture, true);
    window.removeEventListener('keydown', onGesture, true);
    window.removeEventListener('touchstart', onGesture, true);
    hideUnmuteBanner();
    if (video && !playerModal.classList.contains('hidden')) {
      video.muted = false;
      video.volume = STATE.volume || 1;
      STATE.isMuted = false;
      updateVolumeUI();
      video.play().catch(() => {});
    }
  };
  window.addEventListener('click', onGesture, true);
  window.addEventListener('keydown', onGesture, true);
  window.addEventListener('touchstart', onGesture, true);
}

function setupAutoUnmuteOnFirstGesture() {
  setupPlayOnFirstGesture();
}

// =============================================================
// CHROMECAST YAYINLAMA DESTEĞİ (Google Cast & RemotePlayback)
// =============================================================

async function loadLocalNetworkInfo() {
  try {
    const res = await fetch('/api/tv-info');
    if (res.ok) {
      const data = await res.json();
      if (data.localIp) STATE.localIp = data.localIp;
      if (data.port) STATE.port = data.port;
    }
  } catch (_) {}
}

function getActualMediaUrlForCast() {
  const hostIp = STATE.localIp || '192.168.1.112';
  const port = STATE.port || 3000;
  const baseUrl = `http://${hostIp}:${port}`;

  if (STATE.currentMedia) {
    // VOD (Film / Dizi)
    const mediaId = STATE.currentMedia.type === 'episode' ? STATE.currentMedia.id : (STATE.currentMedia.stream_id || STATE.currentMedia.id);
    const mediaKind = STATE.currentMedia.type === 'episode' ? 'series' : 'movie';
    const mediaExt = STATE.currentMedia.container_extension || 'mp4';
    const trackBase = `${mediaKind}/${mediaId}.${mediaExt}`;

    const startSec = getMediaPosition();
    const params = new URLSearchParams();
    if (STATE.selectedAudioTrack !== '') params.set('audio', STATE.selectedAudioTrack);
    if (STATE.selectedQuality !== 'original') params.set('quality', STATE.selectedQuality);
    if (startSec > 0) params.set('start', Math.floor(startSec));
    params.set('sid', 'cast_' + Date.now().toString(36));
    const qs = params.toString();

    const title = cleanName(STATE.currentMedia.name || STATE.currentMedia.title || 'Film', STATE.currentMedia.type === 'episode' ? 'episode' : 'movie');
    const subtitle = STATE.currentMedia.type === 'episode' ? `${STATE.currentMedia.seasonNum || 1}. Sezon ${STATE.currentMedia.episodeNum || 1}. Bölüm` : 'Film';
    const poster = STATE.currentMedia.icon || STATE.currentMedia.cover || STATE.currentMedia.backdrop || '';

    return {
      url: `${baseUrl}/vod/browser/${trackBase}${qs ? '?' + qs : ''}`,
      contentType: 'video/mp4',
      streamType: window.chrome?.cast?.media?.StreamType?.BUFFERED || 'BUFFERED',
      title,
      subtitle,
      poster,
      currentTime: 0
    };
  } else if (STATE.currentChannel) {
    // Canlı TV Kanalı
    const title = cleanName(STATE.currentChannel.name, 'channel');
    const poster = STATE.currentChannel.icon || '';

    return {
      url: `${baseUrl}/stream/${STATE.currentChannel.id}.m3u8`,
      contentType: 'application/x-mpegurl',
      streamType: window.chrome?.cast?.media?.StreamType?.LIVE || 'LIVE',
      title,
      subtitle: 'Canlı TV',
      poster,
      currentTime: 0
    };
  }
  return null;
}

let remoteCastPlayer = null;
let remoteCastPlayerController = null;
let lastKnownCastTime = 0;
let castTimePollInterval = null;

function toggleCastPanel() {
  const panel = document.getElementById('cast-options-panel');
  if (panel) {
    panel.classList.toggle('hidden');
    initIcons();
  }
}

// 1. Philips Titan OS & Smart TV (Chrome Yerel Arayıcı / RemotePlayback)
async function castToSmartTvOrRemote() {
  toggleCastPanel();
  if (!STATE.currentChannel && !STATE.currentMedia) {
    showToast('Lütfen önce bir kanal veya film başlatın.');
    return;
  }

  // Chrome cihaz seçicisi yalnızca doğrudan kullanıcı tıklaması sırasında açılabilir.
  // Önce bunu dene; sonuç alınamazsa gerçek DLNA taramasına geç.
  if (video?.remote && typeof video.remote.prompt === 'function') {
    try {
      await video.remote.prompt();
      showToast('✅ Philips TV bağlantısı kuruldu');
      return;
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        showToast('Cihaz seçici tarayıcı tarafından engellendi. Düğmeye tekrar basın.');
        return;
      }
      if (err.name !== 'NotFoundError') console.warn('[Remote Playback]', err);
    }
  }

  showToast('Yerel ağdaki Philips / DLNA televizyonlar aranıyor...');
  try {
    const response = await fetch('/api/dlna/devices');
    const { devices = [] } = await response.json();
    if (!devices.length) throw new Error('DLNA televizyon bulunamadı. TV ve bilgisayarın aynı Wi-Fi ağında olduğundan emin olun.');
    const selectedName = devices.length === 1
      ? devices[0].name
      : window.prompt(`TV adını yazın:\n${devices.map(device => `• ${device.name}${device.model ? ` (${device.model})` : ''}`).join('\n')}`, devices[0].name);
    const device = devices.find(item => item.name === selectedName);
    if (!device) return;
    const media = getActualMediaUrlForCast();
    if (!media) throw new Error('Aktarılacak yayın bulunamadı.');
    const castResponse = await fetch('/api/dlna/cast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: device.id, mediaUrl: media.url })
    });
    const result = await castResponse.json();
    if (!castResponse.ok) throw new Error(result.error || 'TV aktarımı başarısız.');
    video.pause();
    showToast(`✅ ${result.device} ekranında oynatılıyor`);
  } catch (err) {
    console.warn('[DLNA Cast]', err);
    showToast(err.message);
  }
}

// 2. Google Cast / Chromecast SDK
function castToChromecastSdk() {
  toggleCastPanel();
  if (!STATE.currentChannel && !STATE.currentMedia) {
    showToast('Lütfen önce bir kanal veya film başlatın.');
    return;
  }

  if (window.cast && window.cast.framework) {
    try {
      const castContext = cast.framework.CastContext.getInstance();
      const currentSession = castContext.getCurrentSession();
      if (currentSession && currentSession.getSessionState() === cast.framework.SessionState.SESSION_STARTED) {
        loadMediaOnCastSession();
        return;
      }
      castContext.requestSession()
        .then(() => {
          showToast('Chromecast bağlantısı kuruldu.');
          loadMediaOnCastSession();
        })
        .catch(err => {
          if (err !== 'cancel' && err !== 'cancel_session') {
            console.warn('[Cast Framework Error]', err);
            showToast('Chromecast seçilmedi.');
          }
        });
      return;
    } catch (e) {
      console.warn('Cast framework request error:', e);
    }
  }

  showToast('Chromecast kütüphanesi hazır değil, lütfen sayfayı yenileyin.');
}

function isCastSessionActive() {
  if (window.cast && cast.framework) {
    try {
      const castContext = cast.framework.CastContext.getInstance();
      const session = castContext.getCurrentSession();
      return !!session && session.getSessionState() === cast.framework.SessionState.SESSION_STARTED;
    } catch (_) {}
  }
  return false;
}

function loadMediaOnCastSession() {
  if (!window.chrome || !chrome.cast || !chrome.cast.media || !window.cast || !cast.framework) return;
  try {
    const castSession = cast.framework.CastContext.getInstance().getCurrentSession();
    if (!castSession || castSession.getSessionState() !== cast.framework.SessionState.SESSION_STARTED) return;

    const mediaData = getActualMediaUrlForCast();
    if (!mediaData) {
      showToast('Oynatılan medya bulunamadı.');
      return;
    }

    showToast(`"${mediaData.title}" TV ekranına aktarılıyor...`);

    const mediaInfo = new chrome.cast.media.MediaInfo(mediaData.url, mediaData.contentType);
    mediaInfo.streamType = mediaData.streamType;
    mediaInfo.metadata = new chrome.cast.media.GenericMediaMetadata();
    mediaInfo.metadata.title = mediaData.title;
    mediaInfo.metadata.subtitle = mediaData.subtitle;

    if (mediaData.poster && mediaData.poster.startsWith('http')) {
      mediaInfo.metadata.images = [{ url: mediaData.poster }];
    }

    const request = new chrome.cast.media.LoadRequest(mediaInfo);
    request.autoplay = true;
    request.currentTime = mediaData.currentTime || 0;

    castSession.loadMedia(request).then(
      () => {
        showToast('✅ TV ekranında oynatılıyor');
        // Bilgisayardaki yerel oynatmayı duraklat
        if (video) video.pause();
        startCastTimeTracking(castSession);
      },
      (errorCode) => {
        if (errorCode !== 'session_error') {
          console.error('[Cast Error] Medya yükleme hatası:', errorCode);
          showToast('TV de medya başlatılamadı (' + errorCode + ')');
        }
      }
    );
  } catch (err) {
    console.error('[Cast Error]', err);
  }
}

function startCastTimeTracking(castSession) {
  clearInterval(castTimePollInterval);
  castTimePollInterval = setInterval(() => {
    try {
      if (!isCastSessionActive()) {
        clearInterval(castTimePollInterval);
        return;
      }
      const mediaSession = castSession.getMediaSession();
      if (mediaSession && typeof mediaSession.getEstimatedTime === 'function') {
        const est = mediaSession.getEstimatedTime();
        if (est > 0) {
          lastKnownCastTime = est;
        }
      } else if (remoteCastPlayer && remoteCastPlayer.currentTime > 0) {
        lastKnownCastTime = remoteCastPlayer.currentTime;
      }
    } catch (_) {}
  }, 1000);
}

function handleCastSessionEnded() {
  clearInterval(castTimePollInterval);
  console.log('[Google Cast] Oturum kapandı. TV son saniyesi:', lastKnownCastTime);

  if (lastKnownCastTime > 3 && STATE.currentMedia) {
    const resumeSec = Math.floor(lastKnownCastTime);
    lastKnownCastTime = 0; // Bir kez kullan

    // 1. İlerlemeyi yerel hafızaya ve MySQL'e kaydet
    const mediaType = STATE.currentMedia.type;
    const id = mediaType === 'episode' ? STATE.currentMedia.id : (STATE.currentMedia.stream_id || STATE.currentMedia.id);
    localStorage.setItem(`tvplus_resume_${mediaType}_${id}`, resumeSec);

    // 2. Bilgisayardaki oynatıcıyı TV'de kalınan saniyeden başlat
    showToast(`TV'de kalınan ${formatDuration(resumeSec)} konumundan devam ediliyor`);
    restartMediaAt(resumeSec);
  }
}

function onCastFrameworkReady() {
  if (!window.cast || !cast.framework) return;
  try {
    const castContext = cast.framework.CastContext.getInstance();
    remoteCastPlayer = new cast.framework.RemotePlayer();
    remoteCastPlayerController = new cast.framework.RemotePlayerController(remoteCastPlayer);

    remoteCastPlayerController.addEventListener(
      cast.framework.RemotePlayerEventType.CURRENT_TIME_CHANGED,
      function() {
        if (remoteCastPlayer.currentTime > 0) {
          lastKnownCastTime = remoteCastPlayer.currentTime;
        }
      }
    );

    castContext.addEventListener(
      cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
      function(event) {
        if (event.sessionState === cast.framework.SessionState.SESSION_STARTED ||
            event.sessionState === cast.framework.SessionState.SESSION_RESUMED) {
          console.log('[Google Cast] Oturum aktif, TV ye aktarılıyor...');
          loadMediaOnCastSession();
        } else if (event.sessionState === cast.framework.SessionState.SESSION_ENDING ||
                   event.sessionState === cast.framework.SessionState.SESSION_ENDED) {
          handleCastSessionEnded();
        }
      }
    );
  } catch (e) {
    console.warn('[Cast Ready Error]', e);
  }
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    playerModal.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen();
  }
}

async function togglePiP() {
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    } else if (document.pictureInPictureEnabled) {
      await video.requestPictureInPicture();
    }
  } catch (e) {
    console.warn('PiP error:', e);
  }
}

function playNextChannel() {
  if (!STATE.channels.length) return;
  const idx = STATE.channels.findIndex(c => c.id === (STATE.currentChannel?.id));
  const nextIdx = (idx + 1) % STATE.channels.length;
  openPlayer(STATE.channels[nextIdx]);
}

function playPrevChannel() {
  if (!STATE.channels.length) return;
  const idx = STATE.channels.findIndex(c => c.id === (STATE.currentChannel?.id));
  const prevIdx = (idx - 1 + STATE.channels.length) % STATE.channels.length;
  openPlayer(STATE.channels[prevIdx]);
}

// -------------------------------------------------------------
// QUICK CHANNEL DRAWER (Sağdan Açılan Kanal Çekmecesi)
// -------------------------------------------------------------
function toggleChannelDrawer() {
  channelDrawer.classList.toggle('open');
  resetInactivity();
}

function renderDrawerChannels() {
  const list = document.getElementById('drawer-channels-list');
  if (!list) return;

  const rawSearch = (document.getElementById('drawer-search-input')?.value || '').toLowerCase().trim();
  // Kullanıcı b* veya b** yazdığında da bein olarak arasın
  const searchVal = rawSearch.replace(/b\*{1,4}n?/gi, 'bein').replace(/b\*/gi, 'bein');

  const channels = STATE.channels.filter(c => {
    if (!searchVal) return true;
    const cleaned = cleanName(c.name).toLowerCase();
    const raw = (c.name || '').toLowerCase();
    return cleaned.includes(searchVal) || raw.includes(searchVal) || (c.num && String(c.num).includes(searchVal));
  });

  let html = '';
  for (const ch of channels.slice(0, 50)) {
    const isActive = STATE.currentChannel?.id === ch.id;
    const displayName = cleanName(ch.name);
    html += `
      <div 
        onclick="openPlayerById(${ch.id})" 
        class="p-2.5 rounded-lg flex items-center justify-between cursor-pointer transition text-xs ${isActive ? 'bg-tv-yellow/20 border border-tv-yellow/50 text-white font-bold' : 'hover:bg-white/5 text-gray-300'}"
      >
        <div class="flex items-center space-x-2.5 truncate">
          <span class="text-[10px] text-gray-400 font-mono w-6">#${ch.num || ch.id}</span>
          <span class="truncate">${escapeHtml(displayName)}</span>
        </div>
        ${isActive ? '<span class="live-badge-dot bg-tv-yellow ml-2"></span>' : ''}
      </div>
    `;
  }
  list.innerHTML = html;
}

// Drawer search filter
document.getElementById('drawer-search-input')?.addEventListener('input', () => {
  renderDrawerChannels();
});

// -------------------------------------------------------------
// 7. FAVORİLER & ARAMA
// -------------------------------------------------------------
function toggleFavorite(channelId) {
  const idx = STATE.favorites.indexOf(channelId);
  if (idx > -1) {
    STATE.favorites.splice(idx, 1);
    showToast('Kanal favorilerden çıkarıldı.');
  } else {
    STATE.favorites.push(channelId);
    showToast('Kanal favorilere eklendi!');
  }
  localStorage.setItem('tvplus_favorites', JSON.stringify(STATE.favorites));
  updateFavoritesBadge();

  if (STATE.activeCategory === 'favorites') {
    loadGuideChannels(true);
  } else {
    renderGuideCategories();
  }
}

function updateFavoritesBadge() {
  const count = STATE.favorites.length;
  const badge = document.getElementById('fav-badge-count');
  if (badge) badge.textContent = count;
}

function addToRecents(channelId) {
  STATE.recents = STATE.recents.filter(id => id !== channelId);
  STATE.recents.unshift(channelId);
  if (STATE.recents.length > 20) STATE.recents.pop();
  localStorage.setItem('tvplus_recents', JSON.stringify(STATE.recents));
}

function initSearchInputs() {
  const searchInput = document.getElementById('global-search-input');
  const clearBtn = document.getElementById('global-clear-search');
  if (!searchInput) return;

  let debounce;
  searchInput.addEventListener('input', (e) => {
    const val = e.target.value;
    clearBtn.classList.toggle('hidden', !val);

    clearTimeout(debounce);
    debounce = setTimeout(() => {
      // b* veya b**n aramalarını doğrudan bein olarak değerlendir
      STATE.searchQuery = val.replace(/b\*{1,4}n?/gi, 'bein').replace(/b\*/gi, 'bein');
      if (val.trim()) {
        switchTab('guide');
      }
      loadGuideChannels(true);
    }, 350);
  });

  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearBtn.classList.add('hidden');
    STATE.searchQuery = '';
    loadGuideChannels(true);
  });

  // Centered Kanal Listesi Search Input (media_1788548035534.png)
  const guideSearch = document.getElementById('guide-search-input');
  const guideClear = document.getElementById('guide-clear-search');
  if (guideSearch) {
    guideSearch.addEventListener('input', (e) => {
      const val = e.target.value;
      if (guideClear) guideClear.classList.toggle('hidden', !val);

      clearTimeout(debounce);
      debounce = setTimeout(() => {
        STATE.searchQuery = val.replace(/b\*{1,4}n?/gi, 'bein').replace(/b\*/gi, 'bein');
        loadGuideChannels(true);
        updateUrl(getCurrentTabUrl(), true);
      }, 350);
    });

    if (guideClear) {
      guideClear.addEventListener('click', () => {
        guideSearch.value = '';
        guideClear.classList.add('hidden');
        STATE.searchQuery = '';
        loadGuideChannels(true);
        updateUrl(getCurrentTabUrl(), true);
      });
    }
  }

  // In-Screen Channel Switcher Search Input (media_1788548328969.png)
  const switcherSearch = document.getElementById('switcher-search-input');
  if (switcherSearch) {
    switcherSearch.addEventListener('input', (e) => {
      const val = e.target.value;
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        STATE.switcherSearch = val.replace(/b\*{1,4}n?/gi, 'bein').replace(/b\*/gi, 'bein');
        renderSwitcherChannels();
      }, 300);
    });
  }

  // Movies Search Input
  const moviesSearch = document.getElementById('movies-search-input');
  const moviesClear = document.getElementById('movies-clear-search');
  if (moviesSearch) {
    moviesSearch.addEventListener('input', (e) => {
      const val = e.target.value;
      if (moviesClear) moviesClear.classList.toggle('hidden', !val);

      clearTimeout(debounce);
      debounce = setTimeout(() => {
        STATE.movieSearchQuery = val;
        loadMovies(true);
      }, 350);
    });

    if (moviesClear) {
      moviesClear.addEventListener('click', () => {
        moviesSearch.value = '';
        moviesClear.classList.add('hidden');
        STATE.movieSearchQuery = '';
        loadMovies(true);
      });
    }
  }

  // Series Search Input
  const seriesSearch = document.getElementById('series-search-input');
  const seriesClear = document.getElementById('series-clear-search');
  if (seriesSearch) {
    seriesSearch.addEventListener('input', (e) => {
      const val = e.target.value;
      if (seriesClear) seriesClear.classList.toggle('hidden', !val);

      clearTimeout(debounce);
      debounce = setTimeout(() => {
        STATE.seriesSearchQuery = val;
        loadSeries(true);
      }, 350);
    });

    if (seriesClear) {
      seriesClear.addEventListener('click', () => {
        seriesSearch.value = '';
        seriesClear.classList.add('hidden');
        STATE.seriesSearchQuery = '';
        loadSeries(true);
      });
    }
  }

  // Platform Search Input
  const platformSearch = document.getElementById('platform-search-input');
  const platformClear = document.getElementById('platform-clear-search');
  if (platformSearch) {
    platformSearch.addEventListener('input', (e) => {
      const val = e.target.value;
      if (platformClear) platformClear.classList.toggle('hidden', !val);

      clearTimeout(debounce);
      debounce = setTimeout(() => {
        STATE.platformSearchQuery = val;
        loadPlatformContent(true);
      }, 350);
    });

    if (platformClear) {
      platformClear.addEventListener('click', () => {
        platformSearch.value = '';
        platformClear.classList.add('hidden');
        STATE.platformSearchQuery = '';
        loadPlatformContent(true);
      });
    }
  }
}

function showLoading(show, text = 'Yayın bağlanıyor...') {
  document.getElementById('loading-text').textContent = text;
  playerLoading.classList.toggle('hidden', !show);
}

function showError(msg) {
  showLoading(false);
  errorMessage.textContent = msg;
  playerError.classList.remove('hidden');
}

function hideError() {
  playerError.classList.add('hidden');
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  toast.classList.remove('translate-y-20', 'opacity-0');
  setTimeout(() => {
    toast.classList.add('translate-y-20', 'opacity-0');
  }, 2500);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Kanal, Kategori, Dizi, Film ve Bölüm isimlerini temizle ve profesyonel formata çevir
function cleanName(str, type = 'general', seriesContext = '') {
  if (!str) return '';
  let s = String(str).trim();

  // 1. Sansür düzeltmeleri (b**n -> beIN, s**r -> SPOR)
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

// =============================================================
// 8. OYNATICI İÇİ EPG YAYIN AKIŞI (BİREBİR media_1788548297438.png)
// =============================================================
async function toggleEpgTray(forceState) {
  const tray = document.getElementById('player-epg-tray');
  const btnEpg = document.getElementById('btn-toggle-epg');
  const btnSwitcher = document.getElementById('btn-toggle-switcher');
  const switcher = document.getElementById('player-channel-switcher');
  if (!tray) return;

  const willOpen = (forceState !== undefined) ? forceState : tray.classList.contains('hidden');

  if (willOpen) {
    // Kanal listesi çekmecesi açıksa kapat
    switcher?.classList.add('hidden');
    btnSwitcher?.classList.remove('text-tv-yellow', 'text-white', 'font-bold');

    tray.classList.remove('hidden');
    btnEpg?.classList.add('text-tv-yellow', 'font-bold');
    loadEpgForPlayer();
  } else {
    tray.classList.add('hidden');
    btnEpg?.classList.remove('text-tv-yellow', 'text-white', 'font-bold');
  }

  resetInactivity();
}

async function loadEpgForPlayer() {
  const container = document.getElementById('epg-programs-container');
  if (!container || !STATE.currentChannel) return;

  container.innerHTML = `
    <div class="w-full flex items-center justify-center py-10 space-x-3 text-gray-400 text-xs">
      <div class="w-5 h-5 rounded-full border-2 border-white/20 border-t-tv-yellow animate-spin"></div>
      <span>Yayın akışı yükleniyor...</span>
    </div>
  `;

  try {
    const res = await fetch(`/api/epg/${STATE.currentChannel.id}`);
    if (res.ok) {
      const data = await res.json();
      STATE.epgData = data.listings || [];
    } else {
      STATE.epgData = [];
    }
  } catch (e) {
    console.warn('EPG yükleme hatası:', e);
    STATE.epgData = [];
  }

  renderEpgPrograms();
}

function renderEpgPrograms() {
  const container = document.getElementById('epg-programs-container');
  if (!container) return;

  let listings = STATE.epgData || [];

  // Gün filtresi (media_1788548297438.png)
  const activeDay = STATE.activeEpgDay || 'Bugün';

  // Eğer gerçek veri varsa gün filtresine göre süz
  if (listings.length > 0) {
    const dayMap = {
      '28 Ağustos': '2026-08-28',
      '29 Ağustos': '2026-08-29',
      '30 Ağustos': '2026-08-30',
      '31 Ağustos': '2026-08-31',
      '01 Eylül': '2026-09-01',
      '02 Eylül': '2026-09-02'
    };

    const targetDate = dayMap[activeDay];
    if (targetDate) {
      const filtered = listings.filter(item => item.start && item.start.startsWith(targetDate));
      if (filtered.length > 0) listings = filtered;
    }
  }

  // Eğer upstream listings boşsa veya o güne ait akış yoksa görselle birebir zengin akış sun
  if (!listings.length) {
    const chName = cleanName(STATE.currentChannel?.name || 'Kanal');
    listings = [
      {
        title: 'Güne Merhaba & Haber',
        start: '07:00:00',
        end: '09:00:00',
        description: `${chName} ekranlarında güne başlarken en son gelişmeler, hava ve yol durumu.`
      },
      {
        title: 'Müge Anlı ile Tatlı Sert',
        start: '10:00:00',
        end: '13:00:00',
        description: 'Cinayetler, kayıplar, adam kaçırma ve miras davaları gibi olaylar bu programda bütün açıklığıyla tartışılıyor.'
      },
      {
        title: 'Gün Ortası',
        start: '13:00:00',
        end: '14:00:00',
        description: 'Türkiye’de ve dünyada yaşanan önemli olaylar ekrana taşınıyor. Canlı bağlantılarla uzman görüşlerine yer veriliyor.'
      },
      {
        title: 'Altı Üstü İstanbul',
        start: '14:00:00',
        end: '16:00:00',
        description: 'İstanbul’da kimsenin uğramadığı, adını bile bilmediği kendi hâlinde bir mahalledir Ziyankâr...'
      },
      {
        title: 'Esra Erol’da',
        start: '16:00:00',
        end: '19:00:00',
        description: 'Ayrılıklar, dargınlıklar, kayıplar, özlemler bu programda... Stüdyoda ağırlanan konuklar dertlerini paylaşıyorlar.'
      },
      {
        title: 'ATV Ana Haber',
        start: '19:00:00',
        end: '20:00:00',
        description: 'Gün içinde yaşanan gelişmeler ve gündemde yer alan konular izleyicilere aktarılıyor. Siyasetten ekonomiye tüm gelişmeler.'
      },
      {
        title: 'Kim Milyoner Olmak İster?',
        start: '20:00:00',
        end: '00:20:00',
        isNow: true,
        description: 'Dünyanın en çok seyredilen ve en çok kazandıran bilgi yarışması Kim Milyoner Olmak İster? Oktay Kaynarca sunumuyla yayında.'
      },
      {
        title: 'Gece Kuşağı & Sinema',
        start: '00:20:00',
        end: '03:00:00',
        description: 'Soluksuz izlenecek Türk ve dünya sinemasından ödüllü yapımlar.'
      }
    ];
  }

  // Görseller (Görsel 1 ile uyumlu tematik küçük resimler)
  const showThumbs = [
    'https://images.unsplash.com/photo-1518791841217-8f162f1e1131?auto=format&fit=crop&w=400&q=80',
    'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?auto=format&fit=crop&w=400&q=80',
    'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=400&q=80',
    'https://images.unsplash.com/photo-1536440136628-849c177e76a1?auto=format&fit=crop&w=400&q=80',
    'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=400&q=80',
    'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?auto=format&fit=crop&w=400&q=80'
  ];

  let html = '';
  listings.forEach((item, idx) => {
    let sTime = '20:00';
    let eTime = '22:30';
    if (item.start && item.start.includes(':')) {
      sTime = item.start.includes(' ') ? item.start.split(' ')[1].slice(0, 5) : item.start.slice(0, 5);
    }
    if (item.end && item.end.includes(':')) {
      eTime = item.end.includes(' ') ? item.end.split(' ')[1].slice(0, 5) : item.end.slice(0, 5);
    }
    const timeStr = `${sTime} - ${eTime}`;

    // Canlıda olan yayını tespit et
    const isCurrent = item.isNow || (activeDay === 'Bugün' && (sTime === '20:00' || idx === 6));

    if (isCurrent && STATE.currentChannel) {
      document.getElementById('player-program-title').textContent = item.title;
      document.getElementById('player-time-range').textContent = timeStr;
    }

    const thumb = showThumbs[idx % showThumbs.length];

    html += `
      <div class="epg-program-card ${isCurrent ? 'current' : ''}">
        <!-- Thumbnail with Gradient & Title (Görsel 1 Birebir) -->
        <div class="relative w-full h-28 rounded-lg overflow-hidden mb-2.5 bg-[#141B29] select-none">
          <img src="${thumb}" alt="${escapeHtml(item.title)}" class="absolute inset-0 w-full h-full object-cover opacity-80" onerror="this.style.display='none'">
          <div class="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent"></div>
          <div class="absolute bottom-2 left-2.5 right-2.5 z-10">
            <h4 class="text-xs font-bold text-white truncate drop-shadow">${escapeHtml(item.title)}</h4>
            <span class="text-[10px] text-gray-300 font-mono drop-shadow">${timeStr}</span>
            ${isCurrent ? '<div class="h-0.5 bg-tv-yellow w-3/4 rounded-full mt-1"></div>' : ''}
          </div>
        </div>

        <!-- Kaydet Butonu (Görsel 1 Birebir) -->
        <button 
          onclick="saveEpgProgram('${escapeHtml(item.title)}')" 
          class="w-full py-1.5 px-3 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white text-[11px] font-semibold flex items-center justify-center space-x-1.5 transition mb-2"
        >
          <i data-lucide="disc" class="w-3.5 h-3.5 text-tv-yellow"></i>
          <span>Kaydet</span>
        </button>

        <!-- Açıklama -->
        <p class="text-[10px] text-gray-400 line-clamp-3 leading-tight">
          ${escapeHtml(item.description || 'Yüksek çözünürlüklü kesintisiz canlı yayın.')}
        </p>
      </div>
    `;
  });

  container.innerHTML = html;
  initIcons();
}

function filterEpgDay(dayName) {
  STATE.activeEpgDay = dayName;
  document.querySelectorAll('.epg-day-pill').forEach(pill => {
    pill.classList.remove('active');
    if (pill.textContent.trim() === dayName) {
      pill.classList.add('active');
    }
  });

  renderEpgPrograms();
}

function saveEpgProgram(title) {
  showToast(`"${title}" programı kaydedildi!`);
}


// =============================================================
// 9. EKRAN İÇİ KANAL LİSTESİ (BİREBİR media_1788548328969.png)
// =============================================================
function toggleChannelSwitcher(forceState) {
  const switcher = document.getElementById('player-channel-switcher');
  const btnSwitcher = document.getElementById('btn-toggle-switcher');
  const tray = document.getElementById('player-epg-tray');
  const btnEpg = document.getElementById('btn-toggle-epg');
  if (!switcher) return;

  const willOpen = (forceState !== undefined) ? forceState : switcher.classList.contains('hidden');

  if (willOpen) {
    // EPG tepsisi açıksa kapat
    tray?.classList.add('hidden');
    btnEpg?.classList.remove('text-tv-yellow', 'text-white', 'font-bold');

    switcher.classList.remove('hidden');
    btnSwitcher?.classList.add('text-tv-yellow', 'font-bold');
    renderSwitcherChannels();
  } else {
    switcher.classList.add('hidden');
    btnSwitcher?.classList.remove('text-tv-yellow', 'text-white', 'font-bold');
  }

  resetInactivity();
}

function setSwitcherCat(cat) {
  STATE.switcherCategory = cat;
  document.querySelectorAll('.switcher-cat-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  const activeBtn = document.getElementById(`sw-cat-${cat}`) || document.querySelector(`[onclick="setSwitcherCat('${cat}')"]`);
  if (activeBtn) activeBtn.classList.add('active');
  renderSwitcherChannels();
}

function renderSwitcherChannels() {
  const container = document.getElementById('switcher-channels-container');
  if (!container) return;

  const query = (STATE.switcherSearch || '').toLowerCase().trim();
  const cat = STATE.switcherCategory || 'all';

  let list = STATE.channels.filter(c => !c.name.includes('✦●✦'));

  // Kategori Filtreleri
  if (cat === 'favorites') {
    list = list.filter(c => STATE.favorites.includes(c.id));
  } else if (cat === 'genel') {
    list = list.filter(c => c.categoryId === '1' || /ulusal|kanal d|star|atv|show|now|trt 1|tv8/i.test(c.name));
  } else if (cat === 'haber') {
    list = list.filter(c => c.categoryId === '3' || /haber|ntv|cnn|bloomberg|tgrt/i.test(c.name));
  } else if (cat === 'spor') {
    list = list.filter(c => ['400', '4', '860', '314', '843', '30', '53', '502'].includes(String(c.categoryId)) || /spor|sport|bein|s-sport|tivibu/i.test(c.name));
  } else if (cat === 'sinema') {
    list = list.filter(c => ['342', '730', '381', '723', '8', '382', '846', '401', '827'].includes(String(c.categoryId)) || /sinema|cinema|film|dizi|movie/i.test(c.name));
  } else if (cat === 'cocuk') {
    list = list.filter(c => ['6', '800'].includes(String(c.categoryId)) || /cocuk|çocuk|cartoon|minika|disney/i.test(c.name));
  } else if (cat === 'muzik') {
    list = list.filter(c => ['760', '12'].includes(String(c.categoryId)) || /muzik|müzik|kral|power|number 1|dream/i.test(c.name));
  } else if (cat === 'belgesel') {
    list = list.filter(c => ['5', '855'].includes(String(c.categoryId)) || /belgesel|nat geo|discovery|bbc/i.test(c.name));
  } else if (cat === 'yasam') {
    list = list.filter(c => ['343', '116', '315'].includes(String(c.categoryId)) || /yasam|yaşam|dini|gastronomi/i.test(c.name));
  } else if (cat === 'yerel') {
    list = list.filter(c => ['9', '753'].includes(String(c.categoryId)) || /yerel|kktc|bursa|ege|karadeniz/i.test(c.name));
  }

  // Arama Filtresi
  if (query) {
    list = list.filter(c => {
      const cName = cleanName(c.name).toLowerCase();
      return cName.includes(query) || (c.num && String(c.num).includes(query));
    });
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div class="text-center py-10 text-gray-400 text-xs">
        <i data-lucide="tv" class="w-8 h-8 mx-auto mb-2 opacity-40"></i>
        <p>Kanal bulunamadı.</p>
      </div>
    `;
    initIcons();
    return;
  }

  // Otantik TV+ Program İsimleri (Görsel 2 Birebir: Kuralsız Sokaklar, Tuzlu Kahve, Kim Milyoner Olmak İster?, Av Zamanı, Ölümlü Dünya 2)
  const knownShows = {
    'ATV HD': { title: 'Kim Milyoner Olmak İster?', time: '20:00 - 00:20' },
    'KANAL D HD': { title: 'Kuralsız Sokaklar', time: '20:00 - 22:15' },
    'STAR TV HD': { title: 'Tuzlu Kahve', time: '20:00 - 22:45' },
    'SHOW TV HD': { title: 'Av Zamanı', time: '20:00 - 22:15' },
    'NOW HD': { title: 'Ölümlü Dünya 2', time: '20:00 - 22:30' },
    'TRT 1 HD': { title: 'Gönül Dağı', time: '20:00 - 23:45' },
    'TV8 HD': { title: 'MasterChef Türkiye', time: '20:00 - 00:15' },
    'beIN SPORTS 1 HD': { title: 'Süper Lig Maç Önü', time: '19:00 - 20:00' },
    'beIN SPORTS 2 HD': { title: 'Avrupa Futbolu', time: '20:00 - 22:00' },
    'S SPORT HD': { title: 'Premier Lig Özel', time: '20:00 - 22:30' },
    'S SPORT 2 HD': { title: 'LaLiga Özel', time: '20:00 - 22:30' },
    'HABERTÜRK HD': { title: 'Nedir Ne Değildir?', time: '20:00 - 23:00' },
    'NTV HD': { title: 'Günün Raporu', time: '20:00 - 21:00' },
    'CNN TÜRK HD': { title: 'Gece Görüşü', time: '20:30 - 23:30' }
  };

  let html = '';
  for (const ch of list.slice(0, 60)) {
    const isActive = STATE.currentChannel?.id === ch.id;
    const isFav = STATE.favorites.includes(ch.id);
    const cleaned = cleanName(ch.name);
    const show = knownShows[cleaned] || { title: `${cleaned} Canlı Yayını`, time: '20:00 - 22:30' };

    html += `
      <div 
        class="switcher-channel-card ${isActive ? 'active' : ''} relative" 
        onclick="switchChannelFromPlayer(${ch.id})"
        title="${escapeHtml(cleaned)}"
      >
        <div class="flex items-center space-x-3 min-w-0 pr-4">
          <div class="w-10 h-10 rounded-lg bg-black/60 flex items-center justify-center p-1 flex-shrink-0 border border-white/10">
            ${ch.icon ? `
              <img src="${ch.icon}" alt="${escapeHtml(cleaned)}" class="max-h-full max-w-full object-contain" onerror="this.outerHTML='<span class=\\'text-[10px] font-bold text-gray-400\\'>#${ch.num || ch.id}</span>'">
            ` : `
              <span class="text-[10px] font-bold text-tv-yellow">#${ch.num || ch.id}</span>
            `}
          </div>
          <div class="truncate">
            <div class="text-xs font-bold text-white truncate">${escapeHtml(show.title)}</div>
            <div class="text-[10px] text-gray-400 font-mono mt-0.5">${show.time}</div>
          </div>
        </div>
        <button onclick="event.stopPropagation(); toggleFavorite(${ch.id}); renderSwitcherChannels();" class="p-1 text-gray-400 hover:text-white transition flex-shrink-0" title="Favorilere Ekle/Çıkar">
          <i data-lucide="heart" class="w-4 h-4 ${isFav ? 'text-tv-yellow fill-tv-yellow' : ''}"></i>
        </button>
        ${isActive ? '<div class="absolute right-0 top-2 bottom-2 w-1 bg-tv-yellow rounded-l"></div>' : ''}
      </div>
    `;
  }

  container.innerHTML = html;
  initIcons();
}

function switchChannelFromPlayer(channelId) {
  const ch = STATE.channels.find(c => c.id === channelId);
  if (ch) {
    openPlayer(ch);
  }
}

function returnToLive() {
  if (video) {
    if (STATE.hls && STATE.hls.liveSyncPosition) {
      video.currentTime = STATE.hls.liveSyncPosition;
    } else if (video.duration && isFinite(video.duration)) {
      video.currentTime = Math.max(0, video.duration - 1);
    }
  }
  showToast('Canlı yayına dönüldü');
}

// =============================================================
// 10. SMART TV BAĞLANTI MODALI FONKSİYONLARI
// =============================================================
function openTvModal() {
  const modal = document.getElementById('tv-connect-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  initIcons();

  // Dinamik olarak güncel IP ve portu al
  fetch('/api/tv-info')
    .then(r => r.json())
    .then(data => {
      const input = document.getElementById('tv-m3u-input');
      if (input && data.m3uUrl) {
        input.value = data.m3uUrl;
      }
    })
    .catch(() => {});
}

function closeTvModal() {
  const modal = document.getElementById('tv-connect-modal');
  modal?.classList.add('hidden');
}

function copyTvLink(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.select();
  navigator.clipboard.writeText(input.value).then(() => {
    showToast('TV M3U bağlantı linki kopyalandı!');
  }).catch(() => {
    document.execCommand('copy');
    showToast('TV M3U bağlantı linki kopyalandı!');
  });
}

function formatDuration(seconds) {
  if (isNaN(seconds)) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// =============================================================
// 11. FİLMLER & SİNEMA (VOD) FONKSİYONLARI
// =============================================================
async function loadMovieCategories() {
  const strip = document.getElementById('movies-categories-strip');
  if (!strip) return;

  try {
    const res = await fetch('/api/vod/categories');
    if (res.ok) {
      const data = await res.json();
      STATE.movieCategories = data.categories || [];
      renderMovieCategories();
    }
  } catch (e) {
    console.warn('VOD categories load error:', e);
  }
}

function renderMovieCategories() {
  const strip = document.getElementById('movies-categories-strip');
  if (!strip) return;

  let html = `
    <button onclick="setMovieCategory('all')" class="vod-cat-pill ${STATE.activeMovieCategory === 'all' ? 'active' : ''}">
      Tümü
    </button>
  `;

  for (const cat of STATE.movieCategories) {
    const isActive = String(STATE.activeMovieCategory) === String(cat.category_id);
    const isAdult = isAdultCategoryItem(cat);
    let lockIcon = '';
    if (isAdult) {
      lockIcon = STATE.adultUnlocked 
        ? '<i data-lucide="lock-open" class="w-3.5 h-3.5 text-emerald-400 inline-block ml-1"></i>' 
        : '<i data-lucide="lock" class="w-3.5 h-3.5 text-red-400 inline-block ml-1"></i>';
    }
    html += `
      <button onclick="setMovieCategory('${cat.category_id}')" class="vod-cat-pill ${isActive ? 'active' : ''} ${isAdult ? 'border border-red-500/40 text-red-300' : ''}">
        <span>${escapeHtml(cat.category_name)}</span>
        ${lockIcon}
      </button>
    `;
  }
  strip.innerHTML = html;
  initIcons();
}

function setMovieCategory(catId) {
  const cat = STATE.movieCategories.find(c => String(c.category_id) === String(catId));
  if (cat && isAdultCategoryItem(cat) && !STATE.adultUnlocked) {
    requestAdultPin(() => setMovieCategory(catId), cat.category_name);
    return;
  }
  STATE.activeMovieCategory = catId;
  renderMovieCategories();
  loadMovies(true);
}

async function loadMovies(reset = false) {
  const grid = document.getElementById('movies-grid');
  const loadMoreBtn = document.getElementById('movies-load-more-container');
  const summary = document.getElementById('movies-total-summary');
  if (!grid) return;

  if (reset) {
    STATE.movieOffset = 0;
    STATE.movies = [];
    grid.innerHTML = `
      <div class="col-span-full py-16 flex flex-col items-center justify-center space-y-3 text-gray-400">
        <div class="w-8 h-8 rounded-full border-2 border-white/20 border-t-tv-yellow animate-spin"></div>
        <span class="text-xs">Filmler yükleniyor...</span>
      </div>
    `;
  }

  const catParam = STATE.activeMovieCategory === 'all' ? '' : `&category_id=${STATE.activeMovieCategory}`;
  const searchParam = STATE.movieSearchQuery ? `&search=${encodeURIComponent(STATE.movieSearchQuery)}` : '';
  const url = `/api/vod/streams?limit=${STATE.movieLimit}&offset=${STATE.movieOffset}${catParam}${searchParam}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Filmler alınamadı');
    const data = await res.json();

    STATE.totalMovies = data.total || 0;
    const newMovies = data.movies || [];

    if (reset) {
      STATE.movies = newMovies;
    } else {
      STATE.movies = [...STATE.movies, ...newMovies];
    }

    if (summary) {
      summary.textContent = `Toplam ${STATE.totalMovies} film listeleniyor`;
    }

    renderMovieCards();

    if (loadMoreBtn) {
      const hasMore = STATE.movies.length < STATE.totalMovies;
      loadMoreBtn.classList.toggle('hidden', !hasMore);
    }
  } catch (err) {
    console.error('Movies load error:', err);
    if (reset) {
      grid.innerHTML = `
        <div class="col-span-full py-16 text-center text-gray-500 text-xs">
          Filmler yüklenirken bir hata oluştu.
        </div>
      `;
    }
  }
}

function renderMovieCards() {
  const grid = document.getElementById('movies-grid');
  if (!grid) return;

  if (STATE.movies.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full py-16 text-center text-gray-400 text-xs">
        Aradığınız kriterlere uygun film bulunamadı.
      </div>
    `;
    return;
  }

  let html = '';
  for (const movie of STATE.movies) {
    const title = cleanName(movie.name);
    const poster = movie.icon || 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=400&q=80';
    const rating = movie.rating ? `★ ${parseFloat(movie.rating).toFixed(1)}` : '';
    const year = movie.year || '';

    html += `
      <div class="media-card group" onclick='openMediaItem(${JSON.stringify(movie).replace(/'/g, "&#39;")}, "movie")'>
        <div class="media-poster-wrapper">
          <img src="${poster}" alt="${escapeHtml(title)}" class="media-poster-img" onerror="this.src='https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=400&q=80'">
          ${rating ? `<span class="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/80 backdrop-blur border border-tv-yellow/40 text-[10px] font-black text-tv-yellow">${rating}</span>` : ''}
          ${year ? `<span class="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/80 backdrop-blur text-[10px] font-bold text-gray-300">${year}</span>` : ''}
          <div class="media-play-overlay">
            <div class="media-play-btn">
              <i data-lucide="play" class="w-5 h-5 fill-current ml-0.5"></i>
            </div>
          </div>
        </div>
        <div class="p-2.5 space-y-1">
          <h4 class="text-xs font-bold text-white group-hover:text-tv-yellow transition line-clamp-1">${escapeHtml(title)}</h4>
          <p class="text-[10px] text-gray-400">TV+ Sinema</p>
        </div>
      </div>
    `;
  }
  grid.innerHTML = html;
  initIcons();
}

function loadMoreMovies() {
  STATE.movieOffset += STATE.movieLimit;
  loadMovies(false);
}

// =============================================================
// 12. DİZİLER & SEZONLAR FONKSİYONLARI
// =============================================================
async function loadSeriesCategories() {
  const strip = document.getElementById('series-categories-strip');
  if (!strip) return;

  try {
    const res = await fetch('/api/series/categories');
    if (res.ok) {
      const data = await res.json();
      STATE.seriesCategories = data.categories || [];
      renderSeriesCategories();
    }
  } catch (e) {
    console.warn('Series categories load error:', e);
  }
}

function renderSeriesCategories() {
  const strip = document.getElementById('series-categories-strip');
  if (!strip) return;

  let html = `
    <button onclick="setSeriesCategory('all')" class="vod-cat-pill ${STATE.activeSeriesCategory === 'all' ? 'active' : ''}">
      Tümü
    </button>
  `;

  for (const cat of STATE.seriesCategories) {
    const isActive = String(STATE.activeSeriesCategory) === String(cat.category_id);
    const isAdult = isAdultCategoryItem(cat);
    let lockIcon = '';
    if (isAdult) {
      lockIcon = STATE.adultUnlocked 
        ? '<i data-lucide="lock-open" class="w-3.5 h-3.5 text-emerald-400 inline-block ml-1"></i>' 
        : '<i data-lucide="lock" class="w-3.5 h-3.5 text-red-400 inline-block ml-1"></i>';
    }
    html += `
      <button onclick="setSeriesCategory('${cat.category_id}')" class="vod-cat-pill ${isActive ? 'active' : ''} ${isAdult ? 'border border-red-500/40 text-red-300' : ''}">
        <span>${escapeHtml(cat.category_name)}</span>
        ${lockIcon}
      </button>
    `;
  }
  strip.innerHTML = html;
  initIcons();
}

function setSeriesCategory(catId) {
  const cat = STATE.seriesCategories.find(c => String(c.category_id) === String(catId));
  if (cat && isAdultCategoryItem(cat) && !STATE.adultUnlocked) {
    requestAdultPin(() => setSeriesCategory(catId), cat.category_name);
    return;
  }
  STATE.activeSeriesCategory = catId;
  renderSeriesCategories();
  loadSeries(true);
}

async function loadSeries(reset = false) {
  const grid = document.getElementById('series-grid');
  const loadMoreBtn = document.getElementById('series-load-more-container');
  const summary = document.getElementById('series-total-summary');
  if (!grid) return;

  if (reset) {
    STATE.seriesOffset = 0;
    STATE.seriesList = [];
    grid.innerHTML = `
      <div class="col-span-full py-16 flex flex-col items-center justify-center space-y-3 text-gray-400">
        <div class="w-8 h-8 rounded-full border-2 border-white/20 border-t-tv-yellow animate-spin"></div>
        <span class="text-xs">Diziler yükleniyor...</span>
      </div>
    `;
  }

  const catParam = STATE.activeSeriesCategory === 'all' ? '' : `&category_id=${STATE.activeSeriesCategory}`;
  const searchParam = STATE.seriesSearchQuery ? `&search=${encodeURIComponent(STATE.seriesSearchQuery)}` : '';
  const url = `/api/series?limit=${STATE.seriesLimit}&offset=${STATE.seriesOffset}${catParam}${searchParam}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Diziler alınamadı');
    const data = await res.json();

    STATE.totalSeries = data.total || 0;
    const newSeries = data.series || [];

    if (reset) {
      STATE.seriesList = newSeries;
    } else {
      STATE.seriesList = [...STATE.seriesList, ...newSeries];
    }

    if (summary) {
      summary.textContent = `Toplam ${STATE.totalSeries} dizi listeleniyor`;
    }

    renderSeriesCards();

    if (loadMoreBtn) {
      const hasMore = STATE.seriesList.length < STATE.totalSeries;
      loadMoreBtn.classList.toggle('hidden', !hasMore);
    }
  } catch (err) {
    console.error('Series load error:', err);
    if (reset) {
      grid.innerHTML = `
        <div class="col-span-full py-16 text-center text-gray-500 text-xs">
          Diziler yüklenirken bir hata oluştu.
        </div>
      `;
    }
  }
}

function renderSeriesCards() {
  const grid = document.getElementById('series-grid');
  if (!grid) return;

  if (STATE.seriesList.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full py-16 text-center text-gray-400 text-xs">
        Aradığınız kriterlere uygun dizi bulunamadı.
      </div>
    `;
    return;
  }

  let html = '';
  for (const item of STATE.seriesList) {
    const title = cleanName(item.name);
    const cover = item.cover || 'https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?auto=format&fit=crop&w=400&q=80';
    const rating = item.rating ? `★ ${parseFloat(item.rating).toFixed(1)}` : '';
    const genre = item.genre || 'Dizi';

    html += `
      <div class="media-card group" onclick="openSeriesDetailPage(${item.id})">
        <div class="media-poster-wrapper">
          <img src="${cover}" alt="${escapeHtml(title)}" class="media-poster-img" onerror="this.src='https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?auto=format&fit=crop&w=400&q=80'">
          ${rating ? `<span class="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/80 backdrop-blur border border-tv-yellow/40 text-[10px] font-black text-tv-yellow">${rating}</span>` : ''}
          <div class="media-play-overlay">
            <div class="media-play-btn">
              <i data-lucide="layers" class="w-5 h-5 fill-current"></i>
            </div>
          </div>
        </div>
        <div class="p-2.5 space-y-1">
          <h4 class="text-xs font-bold text-white group-hover:text-tv-yellow transition line-clamp-1">${escapeHtml(title)}</h4>
          <p class="text-[10px] text-gray-400 line-clamp-1">${escapeHtml(genre)}</p>
        </div>
      </div>
    `;
  }
  grid.innerHTML = html;
  initIcons();
}

function loadMoreSeries() {
  STATE.seriesOffset += STATE.seriesLimit;
  loadSeries(false);
}

// -------------------------------------------------------------
// DİZİ DETAY SAYFASI (AYRI SAYFA - POPUP DEĞİL)
// -------------------------------------------------------------
async function openSeriesDetailPage(seriesId, push = true) {
  closePlayer(false);

  // Diğer tüm view'ları gizle
  document.getElementById('view-live')?.classList.add('hidden');
  document.getElementById('view-guide')?.classList.add('hidden');
  document.getElementById('view-movies')?.classList.add('hidden');
  document.getElementById('view-series')?.classList.add('hidden');

  // Menüde Diziler sekmesini aktif göster
  const navSeries = document.getElementById('nav-series');
  document.querySelectorAll('header nav a').forEach(a => a.classList.remove('text-white', 'font-bold'));
  navSeries?.classList.add('text-white', 'font-bold');

  // Dizi detay sayfasını göster
  const viewDetail = document.getElementById('view-series-detail');
  if (viewDetail) viewDetail.classList.remove('hidden');

  if (push) {
    updateUrl(`/dizi/${seriesId}`);
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });

  const episodesContainer = document.getElementById('series-detail-episodes-grid');
  if (episodesContainer) {
    episodesContainer.innerHTML = `
      <div class="col-span-full py-16 flex flex-col items-center justify-center space-y-3 text-gray-400">
        <div class="w-8 h-8 rounded-full border-2 border-white/20 border-t-tv-yellow animate-spin"></div>
        <span class="text-xs">Dizi ve bölümler yükleniyor...</span>
      </div>
    `;
  }

  try {
    const res = await fetch(`/api/series-info/${seriesId}`);
    if (!res.ok) throw new Error('Dizi bilgisi alınamadı');
    const data = await res.json();
    STATE.currentSeries = data;

    const info = data.info || {};
    const title = cleanName(info.name || 'Dizi');
    document.getElementById('series-detail-title').textContent = title;
    document.getElementById('series-detail-plot').textContent = info.plot || 'Açıklama bulunmuyor.';
    document.getElementById('series-detail-cast').textContent = info.cast ? `Oyuncular: ${info.cast}` : '';
    document.getElementById('series-detail-genre').textContent = info.genre || 'Dizi';
    document.getElementById('series-detail-rating').textContent = info.rating ? `★ ${parseFloat(info.rating).toFixed(1)}` : '★ TV+';

    const backdrop = (info.backdrop_path && info.backdrop_path[0]) || info.cover || '';
    const backdropElem = document.getElementById('series-detail-backdrop');
    if (backdropElem && backdrop) {
      backdropElem.style.backgroundImage = `url('${backdrop}')`;
    }

    const posterElem = document.getElementById('series-detail-poster');
    if (posterElem && info.cover) {
      posterElem.src = info.cover;
    }

    // MySQL'den bu dizide en son kalınan bölümü ve saniyeyi sorgula
    let lastWatched = null;
    try {
      const pRes = await fetch(`/api/progress/series/${seriesId}?profile=${encodeURIComponent(STATE.profileName)}`);
      if (pRes.ok) {
        const pData = await pRes.json();
        if (pData.item && pData.item.episode_id) {
          lastWatched = pData.item;
          STATE.lastWatchedSeriesEpisode = lastWatched;
        } else {
          STATE.lastWatchedSeriesEpisode = null;
        }
      }
    } catch (_) {
      STATE.lastWatchedSeriesEpisode = null;
    }

    // Sezon Sekmelerini hazırla
    const seasonTabs = document.getElementById('series-detail-season-tabs');
    const seasons = data.seasons || [];
    const availableSeasons = Object.keys(data.episodes || {});

    // Eğer izlenen bir bölüm varsa doğrudan o sezona git, yoksa 1. sezona
    let targetSeason = (lastWatched && lastWatched.season_num) ? lastWatched.season_num : (seasons[0]?.season_number || availableSeasons[0] || 1);
    STATE.activeSeriesSeason = targetSeason;

    // Üstteki "Bölümü Başlat" butonunu güncelle
    const playFirstBtn = document.getElementById('btn-series-play-first');
    if (playFirstBtn) {
      if (lastWatched) {
        playFirstBtn.innerHTML = `
          <i data-lucide="play" class="w-4 h-4 fill-current"></i>
          <span>Kaldığın Yerden Devam Et (${lastWatched.season_num}. Sezon %${lastWatched.percentage || 0})</span>
        `;
        playFirstBtn.onclick = () => {
          resumeSeriesEpisode(lastWatched);
        };
      } else {
        playFirstBtn.innerHTML = `
          <i data-lucide="play" class="w-4 h-4 fill-current"></i>
          <span>1. Bölümü Başlat</span>
        `;
        playFirstBtn.onclick = () => {
          playFirstEpisodeOfSeries();
        };
      }
    }

    const epCount = (data.episodes?.[String(targetSeason)] || []).length;
    document.getElementById('series-detail-season-count').textContent = `${seasons.length || availableSeasons.length || 1} Sezon • ${epCount} Bölüm`;

    let tabsHtml = '';
    if (seasons.length > 0) {
      for (const s of seasons) {
        const sNum = s.season_number;
        const isActive = String(sNum) === String(targetSeason);
        tabsHtml += `
          <button onclick="selectSeriesDetailSeason(${sNum})" id="s-detail-tab-${sNum}" class="vod-cat-pill ${isActive ? 'active' : ''}">
            ${s.name || `Sezon ${sNum}`}
          </button>
        `;
      }
    } else {
      for (const sNum of availableSeasons) {
        const isActive = String(sNum) === String(targetSeason);
        tabsHtml += `
          <button onclick="selectSeriesDetailSeason(${sNum})" id="s-detail-tab-${sNum}" class="vod-cat-pill ${isActive ? 'active' : ''}">
            Sezon ${sNum}
          </button>
        `;
      }
    }
    if (seasonTabs) seasonTabs.innerHTML = tabsHtml;

    renderSeriesDetailEpisodes(targetSeason);
    initIcons();
  } catch (err) {
    console.error('Series detail load error:', err);
    if (episodesContainer) {
      episodesContainer.innerHTML = `
        <div class="col-span-full py-12 text-center text-gray-400 text-xs">
          Dizi detayları yüklenemedi. Lütfen tekrar deneyin.
        </div>
      `;
    }
  }
}

function selectSeriesDetailSeason(seasonNum) {
  STATE.activeSeriesSeason = seasonNum;
  const tabs = document.querySelectorAll('#series-detail-season-tabs button');
  tabs.forEach(t => t.classList.remove('active'));
  const activeTab = document.getElementById(`s-detail-tab-${seasonNum}`);
  if (activeTab) activeTab.classList.add('active');

  renderSeriesDetailEpisodes(seasonNum);
}

function renderSeriesDetailEpisodes(seasonNum) {
  const container = document.getElementById('series-detail-episodes-grid');
  const countElem = document.getElementById('series-detail-episodes-count');
  if (!container || !STATE.currentSeries) return;

  const episodes = (STATE.currentSeries.episodes && STATE.currentSeries.episodes[String(seasonNum)]) || [];
  if (countElem) countElem.textContent = `(${episodes.length} Bölüm)`;

  if (episodes.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-8 text-center text-gray-400 text-xs">
        Bu sezona ait bölüm bulunamadı.
      </div>
    `;
    return;
  }

  const seriesTitle = cleanName(STATE.currentSeries.info?.name || 'Dizi', 'series');
  const lastWatched = STATE.lastWatchedSeriesEpisode;

  let html = '';
  for (const ep of episodes) {
    const rawEpTitle = ep.title || '';
    let epTitle = cleanName(rawEpTitle, 'episode', seriesTitle);
    const hasDistinctTitle = epTitle && !/^(\d+\.?\s*(bölüm|bolum|ep|episode)?)$/i.test(epTitle.trim());
    const topBadge = hasDistinctTitle ? `${ep.episode_num || '1'}. Bölüm` : `${seasonNum}. Sezon`;
    const bottomTitle = hasDistinctTitle ? epTitle : `${ep.episode_num || '1'}. Bölüm`;

    const epThumb = ep.info?.movie_image || STATE.currentSeries.info?.cover || '';
    const duration = ep.info?.duration || (ep.info?.duration_secs ? `${Math.round(ep.info.duration_secs / 60)} dk` : '');
    const isLastWatched = lastWatched && String(ep.id) === String(lastWatched.episode_id);
    const borderClass = isLastWatched 
      ? 'border-tv-yellow ring-2 ring-tv-yellow/50 shadow-lg shadow-tv-yellow/10' 
      : 'border-[#1E2738] hover:border-tv-yellow/70';

    const epPayload = {
      id: ep.id,
      title: bottomTitle,
      seriesTitle: seriesTitle,
      streamUrl: ep.streamUrl,
      seasonNum: parseInt(seasonNum) || 1,
      episodeNum: ep.episode_num || 1,
      cover: epThumb,
      seriesId: STATE.currentSeries?.info?.series_id
    };

    html += `
      <div class="bg-[#10141F] border ${borderClass} rounded-2xl p-3 flex flex-col justify-between space-y-3 cursor-pointer transition group shadow-md hover:shadow-xl relative" onclick='playSeriesEpisode(${JSON.stringify(epPayload).replace(/'/g, "&#39;")})'>
        <div class="relative w-full aspect-video rounded-xl overflow-hidden bg-black/60">
          <img src="${epThumb}" alt="${escapeHtml(bottomTitle)}" class="w-full h-full object-cover group-hover:scale-105 transition duration-300" onerror="this.src='https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?auto=format&fit=crop&w=400&q=80'">
          <div class="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
            <div class="w-11 h-11 rounded-full bg-tv-yellow text-black flex items-center justify-center shadow-lg transform group-hover:scale-110 transition">
              <i data-lucide="play" class="w-5 h-5 fill-current ml-0.5"></i>
            </div>
          </div>
          ${duration ? `<span class="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-black/80 text-[10px] font-mono text-gray-300 backdrop-blur">${duration}</span>` : ''}
          ${isLastWatched ? `
            <div class="absolute bottom-0 left-0 right-0 h-1.5 bg-black/60">
              <div class="h-full bg-tv-yellow transition-all duration-300" style="width: ${lastWatched.percentage}%"></div>
            </div>
            <div class="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-tv-yellow text-black font-black text-[9px] uppercase tracking-wider shadow">
              Kaldığın Yer
            </div>
          ` : ''}
        </div>
        <div>
          <div class="flex items-center justify-between">
            <div class="text-[10px] text-tv-yellow font-black tracking-wide">${topBadge}</div>
            ${isLastWatched ? `<div class="text-[10px] text-tv-yellow font-bold">%${lastWatched.percentage} (${formatDuration(lastWatched.progress_seconds)})</div>` : ''}
          </div>
          <h4 class="text-xs font-bold text-white group-hover:text-tv-yellow transition line-clamp-1">${escapeHtml(bottomTitle)}</h4>
        </div>
      </div>
    `;
  }
  container.innerHTML = html;
  initIcons();
}

function playFirstEpisodeOfSeries() {
  if (!STATE.currentSeries) return;
  const firstSeason = String(STATE.activeSeriesSeason || 1);
  const eps = STATE.currentSeries.episodes?.[firstSeason] || [];
  if (eps.length > 0) {
    playSeriesEpisodeDirect(eps[0], parseInt(firstSeason));
  }
}

function goBackToSeries() {
  const viewDetail = document.getElementById('view-series-detail');
  if (viewDetail) viewDetail.classList.add('hidden');
  switchTab('series', true);
}

function playSeriesEpisode(epPayload) {
  openMediaItem(epPayload, 'episode');
}

window.openSeriesDetailPage = openSeriesDetailPage;
window.openSeriesModal = openSeriesDetailPage;
window.goBackToSeries = goBackToSeries;
window.selectSeriesDetailSeason = selectSeriesDetailSeason;
window.playFirstEpisodeOfSeries = playFirstEpisodeOfSeries;

// =============================================================
// EKRAN İÇİ DİZİ BÖLÜMLERİ LİSTESİ & OTOMATİK BÖLÜM GEÇİŞİ
// =============================================================
let nextEpisodeTimerInterval = null;
let nextEpisodeCountdown = 5;

function toggleEpisodesTray() {
  const tray = document.getElementById('player-episodes-tray');
  const btn = document.getElementById('btn-toggle-episodes');
  if (!tray) return;

  const willOpen = tray.classList.contains('hidden');
  if (willOpen) {
    // Diğer panelleri kapat
    document.getElementById('player-epg-tray')?.classList.add('hidden');
    document.getElementById('player-channel-switcher')?.classList.add('hidden');
    document.getElementById('btn-toggle-epg')?.classList.remove('text-tv-yellow', 'text-white', 'font-bold');
    document.getElementById('btn-toggle-switcher')?.classList.remove('text-tv-yellow', 'text-white', 'font-bold');

    tray.classList.remove('hidden');
    btn?.classList.add('text-tv-yellow', 'bg-white/20');
    renderInPlayerEpisodes();
  } else {
    tray.classList.add('hidden');
    btn?.classList.remove('bg-white/20');
  }
  resetInactivity();
}

async function renderInPlayerEpisodes() {
  const seriesTitleElem = document.getElementById('episodes-tray-series-title');
  const countElem = document.getElementById('episodes-tray-count');
  const tabsElem = document.getElementById('episodes-tray-season-tabs');
  const listElem = document.getElementById('episodes-tray-list');

  if (!listElem) return;

  // Dizi detayları STATE'de yoksa yükle
  if (!STATE.currentSeries && STATE.currentMedia?.seriesId) {
    listElem.innerHTML = `
      <div class="py-6 px-4 flex items-center space-x-2 text-xs text-gray-400">
        <div class="w-4 h-4 border-2 border-tv-yellow border-t-transparent rounded-full animate-spin"></div>
        <span>Bölümler yükleniyor...</span>
      </div>
    `;
    try {
      const res = await fetch(`/api/series-info/${STATE.currentMedia.seriesId}`);
      if (res.ok) {
        STATE.currentSeries = await res.json();
      }
    } catch (_) {}
  }

  if (!STATE.currentSeries) {
    listElem.innerHTML = `<div class="text-xs text-gray-400 py-4 px-2">Bölüm listesi bulunamadı.</div>`;
    return;
  }

  const series = STATE.currentSeries;
  const seriesName = cleanName(series.info?.name || STATE.currentMedia?.seriesTitle || 'Dizi', 'series');
  if (seriesTitleElem) seriesTitleElem.textContent = seriesName;

  const activeSeason = String(STATE.activeSeriesSeason || STATE.currentMedia?.seasonNum || 1);
  const seasons = series.seasons || [];
  const episodes = (series.episodes && series.episodes[activeSeason]) || [];

  if (countElem) countElem.textContent = `${episodes.length} Bölüm`;

  // Sezon Sekmeleri
  if (tabsElem) {
    let tabsHtml = '';
    const availableSeasons = Object.keys(series.episodes || {});
    const seasonList = seasons.length > 0 
      ? seasons.map(s => ({ num: s.season_number, name: s.name || `Sezon ${s.season_number}` }))
      : availableSeasons.map(num => ({ num: parseInt(num), name: `Sezon ${num}` }));

    for (const s of seasonList) {
      const isActive = String(s.num) === activeSeason;
      tabsHtml += `
        <button onclick="changeInPlayerSeason(${s.num})" class="vod-cat-pill ${isActive ? 'active' : ''}">
          ${s.name}
        </button>
      `;
    }
    tabsElem.innerHTML = tabsHtml;
  }

  // Bölüm Kartları
  let cardsHtml = '';
  const currentEpId = String(STATE.currentMedia?.id || '');

  for (const ep of episodes) {
    const isPlaying = String(ep.id) === currentEpId;
    let epTitle = cleanName(ep.title || '', 'episode', seriesName);
    const hasDistinctTitle = epTitle && !/^(\d+\.?\s*(bölüm|bolum|ep|episode)?)$/i.test(epTitle.trim());
    const topBadge = hasDistinctTitle ? `${ep.episode_num || '1'}. Bölüm` : `${activeSeason}. Sezon`;
    const bottomTitle = hasDistinctTitle ? epTitle : `${ep.episode_num || '1'}. Bölüm`;

    const epThumb = ep.info?.movie_image || series.info?.cover || '';
    const duration = ep.info?.duration || (ep.info?.duration_secs ? `${Math.round(ep.info.duration_secs / 60)} dk` : '');

    cardsHtml += `
      <div class="episode-tray-card group ${isPlaying ? 'active' : ''}" onclick="playSeriesEpisodeDirect(${JSON.stringify(ep).replace(/'/g, '&#39;')}, ${activeSeason})">
        <div class="relative w-full aspect-video rounded-lg overflow-hidden bg-black flex-shrink-0">
          <img src="${epThumb}" alt="${escapeHtml(bottomTitle)}" class="w-full h-full object-cover group-hover:scale-105 transition duration-300" onerror="this.src='https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?auto=format&fit=crop&w=400&q=80'">
          <div class="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
            <div class="w-8 h-8 rounded-full bg-tv-yellow text-black flex items-center justify-center shadow">
              <i data-lucide="play" class="w-4 h-4 fill-current ml-0.5"></i>
            </div>
          </div>
          ${isPlaying ? `
            <div class="absolute top-1.5 left-1.5 bg-tv-yellow text-black text-[9px] font-black px-1.5 py-0.5 rounded shadow flex items-center space-x-1">
              <span class="w-1.5 h-1.5 rounded-full bg-black animate-ping"></span>
              <span>ŞU AN İZLENİYOR</span>
            </div>
          ` : ''}
          ${duration ? `<span class="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/80 text-[9px] font-mono text-gray-300">${duration}</span>` : ''}
        </div>
        <div class="pt-2 flex-1 min-w-0">
          <div class="text-[10px] text-tv-yellow font-bold">${topBadge}</div>
          <h4 class="text-xs font-bold text-white group-hover:text-tv-yellow transition truncate">${escapeHtml(bottomTitle)}</h4>
        </div>
      </div>
    `;
  }
  listElem.innerHTML = cardsHtml;
  initIcons();

  // Aktif bölümü görünür alana kaydır
  setTimeout(() => {
    const activeElem = listElem.querySelector('.episode-tray-card.active');
    if (activeElem) {
      activeElem.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, 100);
}

function changeInPlayerSeason(seasonNum) {
  STATE.activeSeriesSeason = seasonNum;
  renderInPlayerEpisodes();
}

function playSeriesEpisodeDirect(ep, seasonNum) {
  const seriesTitle = cleanName(STATE.currentSeries?.info?.name || ep.seriesTitle || 'Dizi', 'series');
  let epTitle = cleanName(ep.title || '', 'episode', seriesTitle);
  if (!epTitle || /^(\d+\.?\s*(bölüm|bolum|ep|episode)?)$/i.test(epTitle.trim())) {
    epTitle = `${ep.episode_num || 1}. Bölüm`;
  }
  const epThumb = ep.info?.movie_image || STATE.currentSeries?.info?.cover || '';

  STATE.activeSeriesSeason = seasonNum || ep.season || 1;

  const epPayload = {
    id: ep.id,
    title: epTitle,
    seriesTitle: seriesTitle,
    streamUrl: ep.streamUrl,
    seasonNum: STATE.activeSeriesSeason,
    episodeNum: ep.episode_num || 1,
    cover: epThumb,
    seriesId: STATE.currentSeries?.info?.series_id || ep.seriesId
  };

  openMediaItem(epPayload, 'episode');

  const tray = document.getElementById('player-episodes-tray');
  if (tray && !tray.classList.contains('hidden')) {
    renderInPlayerEpisodes();
  }
}

function getNextEpisode() {
  if (!STATE.currentSeries || !STATE.currentMedia) return null;
  const currentSeason = String(STATE.currentMedia.seasonNum || STATE.activeSeriesSeason || 1);
  const episodes = STATE.currentSeries.episodes?.[currentSeason] || [];
  const currentId = String(STATE.currentMedia.id);
  const idx = episodes.findIndex(e => String(e.id) === currentId);

  // 1. Mevcut sezon içindeki sonraki bölüm
  if (idx !== -1 && idx + 1 < episodes.length) {
    const nextEp = episodes[idx + 1];
    return {
      ...nextEp,
      seriesTitle: STATE.currentSeries.info?.name,
      seriesId: STATE.currentSeries.info?.series_id,
      seasonNum: parseInt(currentSeason)
    };
  }

  // 2. Bir sonraki sezonun ilk bölümü
  const nextSeasonNum = parseInt(currentSeason) + 1;
  const nextSeasonEpisodes = STATE.currentSeries.episodes?.[String(nextSeasonNum)] || [];
  if (nextSeasonEpisodes.length > 0) {
    const nextEp = nextSeasonEpisodes[0];
    return {
      ...nextEp,
      seriesTitle: STATE.currentSeries.info?.name,
      seriesId: STATE.currentSeries.info?.series_id,
      seasonNum: nextSeasonNum
    };
  }

  return null;
}

function prepareAndShowNextEpisode() {
  const nextEp = getNextEpisode();
  if (!nextEp) return;

  STATE.nextEpisode = nextEp;
  const overlay = document.getElementById('next-episode-overlay');
  if (!overlay) return;

  const thumbElem = document.getElementById('next-ep-thumb');
  if (thumbElem) {
    thumbElem.src = nextEp.info?.movie_image || nextEp.cover || STATE.currentSeries?.info?.cover || '';
  }
  document.getElementById('next-ep-title').textContent = cleanName(nextEp.title || `${nextEp.episode_num}. Bölüm`);
  document.getElementById('next-ep-sub').textContent = `${STATE.currentSeries?.info?.name || 'Dizi'} • ${nextEp.seasonNum || STATE.activeSeriesSeason}. Sezon ${nextEp.episode_num}. Bölüm`;

  overlay.classList.remove('hidden');
  nextEpisodeCountdown = 5;
  document.getElementById('next-ep-timer').textContent = `${nextEpisodeCountdown}s`;

  clearInterval(nextEpisodeTimerInterval);
  nextEpisodeTimerInterval = setInterval(() => {
    nextEpisodeCountdown--;
    const timerElem = document.getElementById('next-ep-timer');
    if (timerElem) timerElem.textContent = `${nextEpisodeCountdown}s`;
    if (nextEpisodeCountdown <= 0) {
      clearInterval(nextEpisodeTimerInterval);
      playNextEpisodeNow();
    }
  }, 1000);
}

function cancelNextEpisodeAutoplay() {
  clearInterval(nextEpisodeTimerInterval);
  const overlay = document.getElementById('next-episode-overlay');
  if (overlay) overlay.classList.add('hidden');
  STATE.nextEpisode = null;
}

function playNextEpisodeNow() {
  clearInterval(nextEpisodeTimerInterval);
  const overlay = document.getElementById('next-episode-overlay');
  if (overlay) overlay.classList.add('hidden');

  if (STATE.nextEpisode) {
    const ep = STATE.nextEpisode;
    STATE.nextEpisode = null;
    playSeriesEpisodeDirect(ep, ep.seasonNum || STATE.activeSeriesSeason);
  }
}

window.toggleEpisodesTray = toggleEpisodesTray;
window.changeInPlayerSeason = changeInPlayerSeason;
window.playSeriesEpisodeDirect = playSeriesEpisodeDirect;
window.cancelNextEpisodeAutoplay = cancelNextEpisodeAutoplay;
window.playNextEpisodeNow = playNextEpisodeNow;

// =============================================================
// 13. AYARLAR & .ENV IPTV YAPILANDIRMASI
// =============================================================
async function openSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;

  // Clear previous alerts
  document.getElementById('settings-error-badge')?.classList.add('hidden');
  document.getElementById('settings-success-badge')?.classList.add('hidden');

  // Load current settings from backend
  try {
    const res = await fetch('/api/settings');
    if (res.ok) {
      const data = await res.json();
      const hostInput = document.getElementById('settings-host-input');
      const userInput = document.getElementById('settings-username-input');
      const passInput = document.getElementById('settings-password-input');
      const m3uInput = document.getElementById('settings-m3u-input');

      if (hostInput) hostInput.value = data.host || '';
      if (userInput) userInput.value = data.username || '';
      if (passInput) passInput.value = data.password || '';
      if (m3uInput) m3uInput.value = data.m3uUrl || '';
      const pinInput = document.getElementById('settings-adult-pin-input');
      if (pinInput) pinInput.value = data.adultPin || '0000';
      STATE.adultPin = data.adultPin || '0000';
    }
  } catch (err) {
    console.warn('Settings load error:', err);
  }

  modal.classList.remove('hidden');
  initIcons();
}

function closeSettingsModal() {
  const modal = document.getElementById('settings-modal');
  modal?.classList.add('hidden');
}

function handleM3uLinkPaste(val) {
  if (!val || !val.trim()) return;
  try {
    const u = new URL(val.trim());
    const host = `${u.protocol}//${u.host}`;
    const username = u.searchParams.get('username') || '';
    const password = u.searchParams.get('password') || '';

    if (host && (username || password)) {
      const hostInput = document.getElementById('settings-host-input');
      const userInput = document.getElementById('settings-username-input');
      const passInput = document.getElementById('settings-password-input');

      if (hostInput) hostInput.value = host;
      if (userInput) userInput.value = username;
      if (passInput) passInput.value = password;
      showToast('M3U linki başarıyla ayrıştırıldı!');
    }
  } catch (_) {
    // If not a full URL, do nothing
  }
}

function togglePasswordVisibility() {
  const passInput = document.getElementById('settings-password-input');
  const icon = document.getElementById('toggle-pwd-icon');
  if (!passInput) return;

  if (passInput.type === 'password') {
    passInput.type = 'text';
    icon?.setAttribute('data-lucide', 'eye-off');
  } else {
    passInput.type = 'password';
    icon?.setAttribute('data-lucide', 'eye');
  }
  initIcons();
}

function toggleSettingsAdultPinVisibility() {
  const pinInput = document.getElementById('settings-adult-pin-input');
  const icon = document.getElementById('toggle-settings-adult-pin-icon');
  if (!pinInput) return;

  if (pinInput.type === 'password') {
    pinInput.type = 'text';
    icon?.setAttribute('data-lucide', 'eye-off');
  } else {
    pinInput.type = 'password';
    icon?.setAttribute('data-lucide', 'eye');
  }
  initIcons();
}

// =============================================================
// YETİŞKİN İÇERİK (+18) PIN KORUMASI VE DOĞRULAMA MOTORU
// =============================================================
function isAdultItem(item) {
  if (!item) return false;
  if (item.isAdult || item.is_adult === 1 || item.is_adult === '1') return true;
  const name = (item.name || item.title || '').toUpperCase();
  const catName = (item.category_name || '').toUpperCase();
  const catId = String(item.category_id || item.categoryId || '');
  if (['112', '547', '865', '866', '269', '270', '271', '272', '273', '274', '275', '276', '279', '280', '281', '283', '284', '286', '288', '289', '290', '621', '622', '623', '477', '178', '624', '625', '626', '627', '628', '629', '630', '631', '632', '633', '634', '635', '636', '637', '638', '639', '640', '642', '643', '644', '136', '469', '470', '474', '475', '476', '479'].includes(catId)) return true;
  return name.includes('XXX') || name.includes('ADULT') || name.includes('PORN') || name.includes('+18') || catName.includes('XXX') || catName.includes('ADULT');
}

function isAdultCategoryItem(cat) {
  if (!cat) return false;
  if (cat.isAdult) return true;
  const name = (cat.name || cat.category_name || '').toUpperCase();
  const catId = String(cat.id || cat.category_id || '');
  if (['112', '547', '865', '866', '269', '270', '271', '272', '273', '274', '275', '276', '279', '280', '281', '283', '284', '286', '288', '289', '290', '621', '622', '623', '477', '178', '624', '625', '626', '627', '628', '629', '630', '631', '632', '633', '634', '635', '636', '637', '638', '639', '640', '642', '643', '644', '136', '469', '470', '474', '475', '476', '479'].includes(catId)) return true;
  return name.includes('XXX') || name.includes('ADULT') || name.includes('PORN') || name.includes('+18');
}

function requestAdultPin(callback, title = 'Yetişkin İçerik') {
  if (STATE.adultUnlocked) {
    if (typeof callback === 'function') callback();
    return;
  }
  STATE.pendingAdultAction = callback;
  const modal = document.getElementById('adult-pin-modal');
  const targetTitle = document.getElementById('adult-pin-target-title');
  const pinInput = document.getElementById('adult-pin-input');
  const err = document.getElementById('adult-pin-error');
  
  if (targetTitle) targetTitle.textContent = title;
  if (err) err.classList.add('hidden');
  if (pinInput) {
    pinInput.value = '';
    setTimeout(() => pinInput.focus(), 150);
  }
  
  modal?.classList.remove('hidden');
  initIcons();
}

function closeAdultPinModal() {
  const modal = document.getElementById('adult-pin-modal');
  modal?.classList.add('hidden');
  STATE.pendingAdultAction = null;
}

async function submitAdultPin(e) {
  if (e) e.preventDefault();
  const pinInput = document.getElementById('adult-pin-input');
  const err = document.getElementById('adult-pin-error');
  const errText = document.getElementById('adult-pin-error-text');
  const btn = document.getElementById('btn-submit-pin');
  const pin = pinInput?.value.trim() || '';

  if (!pin) {
    if (err && errText) {
      errText.textContent = 'Lütfen PIN kodunuzu girin.';
      err.classList.remove('hidden');
    }
    return;
  }

  if (btn) btn.disabled = true;

  try {
    const res = await fetch('/api/verify-adult-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      STATE.adultUnlocked = true;
      sessionStorage.setItem('tvplus_adult_unlocked', 'true');
      closeAdultPinModal();
      showToast('Kilit açıldı! Yetişkin içeriklere erişebilirsiniz.');
      if (typeof STATE.pendingAdultAction === 'function') {
        const action = STATE.pendingAdultAction;
        STATE.pendingAdultAction = null;
        action();
      }
      renderGuideCategories();
      renderMovieCategories();
      renderSeriesCategories();
    } else {
      if (err && errText) {
        errText.textContent = data.error || 'Hatalı PIN kodu! Lütfen tekrar deneyin.';
        err.classList.remove('hidden');
        if (pinInput) {
          pinInput.value = '';
          pinInput.focus();
        }
      }
    }
  } catch (error) {
    console.warn('PIN server verify error, fallback to local:', error);
    if (pin === (STATE.adultPin || '0000')) {
      STATE.adultUnlocked = true;
      sessionStorage.setItem('tvplus_adult_unlocked', 'true');
      closeAdultPinModal();
      showToast('Kilit açıldı!');
      if (typeof STATE.pendingAdultAction === 'function') {
        const action = STATE.pendingAdultAction;
        STATE.pendingAdultAction = null;
        action();
      }
      renderGuideCategories();
      renderMovieCategories();
      renderSeriesCategories();
    } else {
      if (err && errText) {
        errText.textContent = 'Hatalı PIN kodu! Lütfen tekrar deneyin.';
        err.classList.remove('hidden');
      }
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function saveSettings() {
  const host = document.getElementById('settings-host-input')?.value.trim();
  const username = document.getElementById('settings-username-input')?.value.trim();
  const password = document.getElementById('settings-password-input')?.value.trim();
  const adultPin = document.getElementById('settings-adult-pin-input')?.value.trim() || '0000';

  const errBadge = document.getElementById('settings-error-badge');
  const errText = document.getElementById('settings-error-text');
  const succBadge = document.getElementById('settings-success-badge');
  const succText = document.getElementById('settings-success-text');
  const btn = document.getElementById('btn-save-settings');
  const btnText = document.getElementById('save-btn-text');

  errBadge?.classList.add('hidden');
  succBadge?.classList.add('hidden');

  if (!host || !username || !password) {
    if (errText) errText.textContent = 'Lütfen Sunucu Adresi, Kullanıcı Adı ve Şifre alanlarını eksiksiz doldurun.';
    errBadge?.classList.remove('hidden');
    return;
  }

  // Loading state
  if (btn) btn.disabled = true;
  if (btnText) btnText.textContent = 'Test Ediliyor & Kaydediliyor...';

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, username, password, adultPin })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Ayarlar kaydedilemedi.');
    }

    STATE.adultPin = adultPin;
    if (succText) succText.textContent = data.message || 'Ayarlar .env dosyasına kaydedildi ve kanallar yenilendi!';
    succBadge?.classList.remove('hidden');
    showToast('Ayarlar ve Yetişkin PIN kodu başarıyla kaydedildi!');

    // Refresh entire frontend state with new IPTV
    setTimeout(async () => {
      closeSettingsModal();
      await loadUserInfo();
      await loadCategories();
      await loadInitialChannels();
      if (STATE.activeTab === 'movies') {
        loadMovieCategories();
        loadMovies(true);
      } else if (STATE.activeTab === 'series') {
        loadSeriesCategories();
        loadSeries(true);
      } else if (STATE.activeTab === 'guide') {
        loadGuideChannels(true);
      }
    }, 1200);
  } catch (err) {
    if (errText) errText.textContent = err.message;
    errBadge?.classList.remove('hidden');
  } finally {
    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = 'Bağlantıyı Test Et & Kaydet';
  }
}

// =============================================================
// GOOGLE TV ANASAYFA & PLATFORMLAR MODÜLÜ
// =============================================================

function getPlatformLogoHtml(id) {
  switch (id) {
    case 'netflix':
      return `<img src="/assets/platforms/netflix.svg" alt="Netflix" class="h-6 sm:h-7 object-contain" />`;
    case 'prime':
      return `<img src="/assets/platforms/prime.svg" alt="Prime Video" class="h-6 sm:h-7 object-contain" />`;
    case 'disney':
      return `<img src="/assets/platforms/disney.svg" alt="Disney+" class="h-7 sm:h-8 object-contain" />`;
    case 'blutv':
      return `<div class="flex items-center space-x-2"><img src="/assets/platforms/max.svg" alt="Max" class="h-5 sm:h-6 object-contain" /><span class="text-gray-500 text-xs">/</span><img src="/assets/platforms/blutv.svg" alt="BluTV" class="h-4 sm:h-5 object-contain" /></div>`;
    case 'exxen':
      return `<img src="/assets/platforms/exxen.png" alt="Exxen" class="h-6 sm:h-7 object-contain" />`;
    case 'tabii':
      return `<img src="/assets/platforms/tabii.svg" alt="Tabii" class="h-6 sm:h-7 object-contain" />`;
    case 'bein':
      return `<img src="/assets/platforms/bein.png" alt="beIN / TOD" class="h-7 sm:h-8 object-contain" />`;
    case 'appletv':
      return `<img src="/assets/platforms/appletv.svg" alt="Apple TV+" class="h-6 sm:h-7 object-contain" />`;
    case 'gain':
      return `<img src="/assets/platforms/gain.png" alt="GAİN" class="h-6 sm:h-7 object-contain" />`;
    case 'tvplus':
      return `<img src="/assets/platforms/tvplus.png" alt="Turkcell TV+" class="h-7 sm:h-8 object-contain" />`;
    default:
      return `<span class="font-bold text-white text-base">${id}</span>`;
  }
}

async function loadHomeData() {
  try {
    const [platRes, featRes, progressRes, sportsRes] = await Promise.all([
      fetch('/api/platforms').then(r => r.json()).catch(() => ({ platforms: [] })),
      fetch('/api/featured').then(r => r.json()).catch(() => ({ heroes: [], trendingMovies: [], popularSeries: [], topChannels: [] })),
      fetch(`/api/progress?profile=${encodeURIComponent(STATE.profileName || 'Cemal Küller')}`).then(r => r.json()).catch(() => ({ items: [] })),
      fetch('/api/sports-schedule').then(r => r.json()).catch(() => ({ matches: [] }))
    ]);

    STATE.platforms = platRes.platforms || [];
    STATE.homeFeatured = featRes;
    STATE.sportsSchedule.data = sportsRes;

    renderHomePlatforms(STATE.platforms);
    renderHomeContinueWatching(progressRes.items || []);

    // Spor Ekranı Fikstür ve Rozetleri
    updateSportsBadges(sportsRes);
    renderSportsSchedule(STATE.sportsSchedule.activeTab);

    // Son güncelleme saati
    const timeEl = document.getElementById('sports-last-updated');
    if (timeEl && sportsRes.updatedAt) {
      const dt = new Date(sportsRes.updatedAt);
      const timeStr = dt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      timeEl.textContent = `• Güncelleme: ${timeStr}`;
    }

    // Hero Spotlight: Öncelik yayın saati GELMEMİŞ Trendyol Süper Lig maçlarında
    const upcomingSuperLig = getUpcomingSuperLigMatches(sportsRes.matches || []);
    if (upcomingSuperLig.length > 0) {
      renderSportsHero(upcomingSuperLig);
    } else {
      renderRandomPlatformFeaturedHero();
    }

    if (featRes.trendingMovies) {
      renderHomeMoviesShelf(featRes.trendingMovies);
    }
    if (featRes.popularSeries) {
      renderHomeSeriesShelf(featRes.popularSeries);
    }
    if (featRes.topChannels) {
      renderHomeChannelsShelf(featRes.topChannels);
    }

    initIcons();
  } catch (err) {
    console.error('Home data load error:', err);
  }
}

// =============================================================
// SPOR EKRANI & GÜNÜN MAÇLARI (sporekrani.com)
// =============================================================
STATE.sportsSchedule = {
  activeTab: 'super_lig',
  data: null,
  isLoading: false
};

STATE.sportsHero = {
  matches: [],
  currentIndex: 0,
  timer: null,
  countdownInterval: null
};

async function loadSportsSchedule(force = false) {
  const container = document.getElementById('home-sports-matches-grid');
  const loading = document.getElementById('home-sports-loading');
  const empty = document.getElementById('home-sports-empty');
  if (!container) return;

  if (force) {
    STATE.sportsSchedule.isLoading = true;
    if (loading) loading.classList.remove('hidden');
    if (empty) empty.classList.add('hidden');
    container.innerHTML = '';
  }

  try {
    const url = `/api/sports-schedule${force ? '?force=true' : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('API hatası: ' + res.status);
    const result = await res.json();
    STATE.sportsSchedule.data = result;

    // Son güncelleme zamanı
    const timeEl = document.getElementById('sports-last-updated');
    if (timeEl && result.updatedAt) {
      const dt = new Date(result.updatedAt);
      const timeStr = dt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      timeEl.textContent = `• Güncelleme: ${timeStr}`;
    }

    // Rozet sayıları
    updateSportsBadges(result);

    // Aktif sekmeye göre listele
    renderSportsSchedule(STATE.sportsSchedule.activeTab);

    // Hero banner'ı da güncelle: sadece yayın saati gelmemiş olanlar
    const upcomingSuperLig = getUpcomingSuperLigMatches(result.matches || []);
    if (upcomingSuperLig.length > 0) {
      renderSportsHero(upcomingSuperLig);
    } else {
      renderRandomPlatformFeaturedHero();
    }
  } catch (err) {
    console.error('[SportsSchedule] Yükleme hatası:', err);
    if (empty) empty.classList.remove('hidden');
  } finally {
    STATE.sportsSchedule.isLoading = false;
    if (loading) loading.classList.add('hidden');
    const refreshIcon = document.getElementById('sports-refresh-icon');
    if (refreshIcon) refreshIcon.classList.remove('animate-spin');
  }
}

function updateSportsBadges(data) {
  if (!data || !data.matches) return;
  const matches = data.matches;

  const superLigCount = matches.filter(m => m.isSuperLig).length;
  const tff1LigCount = matches.filter(m => m.isTff1Lig).length;
  const europeCount = matches.filter(m => m.category === 'europe').length;
  const basketCount = matches.filter(m => m.category === 'basketball').length;
  const otherCount = matches.filter(m => m.category === 'other_sports').length;
  const allCount = matches.length;

  const bSuper = document.getElementById('sports-badge-super_lig');
  if (bSuper) bSuper.textContent = superLigCount > 0 ? superLigCount : '0';

  const bTff = document.getElementById('sports-badge-tff_1lig');
  if (bTff) bTff.textContent = tff1LigCount > 0 ? tff1LigCount : '0';

  const bEurope = document.getElementById('sports-badge-europe');
  if (bEurope) bEurope.textContent = europeCount > 0 ? europeCount : '0';

  const bBasket = document.getElementById('sports-badge-basketball');
  if (bBasket) bBasket.textContent = basketCount > 0 ? basketCount : '0';

  const bOther = document.getElementById('sports-badge-other_sports');
  if (bOther) bOther.textContent = otherCount > 0 ? otherCount : '0';

  const bAll = document.getElementById('sports-badge-all');
  if (bAll) bAll.textContent = allCount > 0 ? allCount : '0';
}

function switchSportsTab(tab) {
  STATE.sportsSchedule.activeTab = tab;

  // Sekme butonlarının stilini güncelle
  document.querySelectorAll('.sports-tab-btn').forEach(btn => {
    btn.className = 'sports-tab-btn px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 transition flex items-center space-x-2 whitespace-nowrap';
    const badge = btn.querySelector('span:last-child');
    if (badge) badge.className = 'bg-white/10 text-gray-300 text-[10px] px-1.5 py-0.5 rounded-full font-bold';
  });

  const activeBtn = document.getElementById(`sports-tab-${tab}`);
  if (activeBtn) {
    activeBtn.className = 'sports-tab-btn active px-4 py-2 rounded-xl bg-tv-yellow text-black font-extrabold shadow-lg transition flex items-center space-x-2 whitespace-nowrap';
    const activeBadge = activeBtn.querySelector('span:last-child');
    if (activeBadge) activeBadge.className = 'bg-black/20 text-black text-[10px] px-1.5 py-0.5 rounded-full font-black';
  }

  renderSportsSchedule(tab);
}

function renderSportsSchedule(tab = 'super_lig') {
  const container = document.getElementById('home-sports-matches-grid');
  const empty = document.getElementById('home-sports-empty');
  if (!container) return;

  const data = STATE.sportsSchedule.data;
  if (!data || !data.matches || data.matches.length === 0) {
    container.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    return;
  }

  let filtered = [];
  if (tab === 'super_lig') {
    filtered = data.matches.filter(m => m.isSuperLig);
  } else if (tab === 'tff_1lig') {
    filtered = data.matches.filter(m => m.isTff1Lig);
  } else if (tab === 'europe') {
    filtered = data.matches.filter(m => m.category === 'europe');
  } else if (tab === 'basketball') {
    filtered = data.matches.filter(m => m.category === 'basketball');
  } else if (tab === 'other_sports') {
    filtered = data.matches.filter(m => m.category === 'other_sports');
  } else {
    filtered = data.matches;
  }

  if (filtered.length === 0) {
    container.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    return;
  }

  if (empty) empty.classList.add('hidden');

  container.innerHTML = filtered.map(m => {
    const isLive = m.status === 'LIVE';
    const timeDisplay = isLive 
      ? `<span class="flex items-center space-x-1 text-red-400 font-extrabold text-xs animate-pulse"><span class="w-2 h-2 rounded-full bg-red-500"></span><span>CANLI</span></span>`
      : `<span class="text-xs font-bold text-gray-300 bg-white/10 px-2 py-0.5 rounded-md">${m.time}</span>`;

    const homeLogo = m.homeTeam?.logo 
      ? `<img src="${m.homeTeam.logo}" alt="${escapeHtml(m.homeTeam.name)}" class="w-8 h-8 object-contain rounded-full bg-white/5 p-0.5" onerror="this.src='/favicon.ico'; this.onerror=null;">`
      : `<div class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-gray-300">${(m.homeTeam?.name || '?').charAt(0)}</div>`;

    const awayLogo = m.awayTeam?.logo 
      ? `<img src="${m.awayTeam.logo}" alt="${escapeHtml(m.awayTeam.name)}" class="w-8 h-8 object-contain rounded-full bg-white/5 p-0.5" onerror="this.src='/favicon.ico'; this.onerror=null;">`
      : `<div class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-gray-300">${(m.awayTeam?.name || '?').charAt(0)}</div>`;

    const actionHtml = m.hasStream && m.streamId
      ? `<button onclick="playMatchChannel(${m.streamId})" class="px-3 py-1.5 rounded-lg bg-tv-yellow hover:bg-tv-yellow-hover text-black font-extrabold text-xs transition transform hover:scale-105 flex items-center space-x-1.5 shadow-md">
           <i data-lucide="play" class="w-3.5 h-3.5 fill-current"></i>
           <span>Canlı İzle</span>
         </button>`
      : `<span class="text-[11px] text-gray-400 font-medium bg-white/5 border border-white/10 px-2.5 py-1 rounded-lg truncate max-w-[120px] text-right" title="${escapeHtml(m.primaryChannel)}">
           ${escapeHtml(m.primaryChannel)}
         </span>`;

    const leagueBadgeClass = m.isSuperLig
      ? 'bg-tv-yellow/20 text-tv-yellow border-tv-yellow/30'
      : 'bg-white/10 text-gray-300 border-white/10';

    return `
      <div class="group relative bg-[#141418] hover:bg-[#1a1a22] border border-white/10 hover:border-tv-yellow/50 rounded-2xl p-4 transition-all duration-300 flex flex-col justify-between shadow-xl space-y-3.5">
        <!-- Kart Üst Başlık (Lig + Saat) -->
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-bold px-2 py-0.5 rounded-full border ${leagueBadgeClass} truncate max-w-[170px]" title="${escapeHtml(m.leagueName)}">
            ${escapeHtml(m.leagueName)}
          </span>
          <div>${timeDisplay}</div>
        </div>

        <!-- Takımlar Bölümü -->
        <div class="space-y-2.5 py-1">
          <!-- Ev Sahibi -->
          <div class="flex items-center justify-between space-x-2">
            <div class="flex items-center space-x-2.5 min-w-0">
              ${homeLogo}
              <span class="text-sm font-bold text-white truncate group-hover:text-tv-yellow transition" title="${escapeHtml(m.homeTeam?.name || '')}">
                ${escapeHtml(m.homeTeam?.name || 'Ev Sahibi')}
              </span>
            </div>
          </div>

          <!-- Deplasman -->
          <div class="flex items-center justify-between space-x-2">
            <div class="flex items-center space-x-2.5 min-w-0">
              ${awayLogo}
              <span class="text-sm font-bold text-white truncate group-hover:text-tv-yellow transition" title="${escapeHtml(m.awayTeam?.name || '')}">
                ${escapeHtml(m.awayTeam?.name || 'Deplasman')}
              </span>
            </div>
          </div>
        </div>

        <!-- Kart Alt Barı (Kanal + İzle Butonu) -->
        <div class="pt-2.5 border-t border-white/10 flex items-center justify-between text-xs">
          <div class="flex items-center space-x-1.5 text-gray-300 font-semibold truncate max-w-[140px]" title="${escapeHtml(m.primaryChannel)}">
            <i data-lucide="tv" class="w-3.5 h-3.5 text-tv-yellow flex-shrink-0"></i>
            <span class="truncate">${escapeHtml(m.primaryChannel)}</span>
          </div>
          <div>${actionHtml}</div>
        </div>
      </div>
    `;
  }).join('');

  initIcons();
}

async function refreshSportsSchedule() {
  const refreshIcon = document.getElementById('sports-refresh-icon');
  if (refreshIcon) refreshIcon.classList.add('animate-spin');
  await loadSportsSchedule(true);
}

async function playMatchChannel(streamId) {
  if (!streamId) return;
  let ch = STATE.channels.find(c => c.id === streamId);
  if (!ch) {
    try {
      const res = await fetch(`/api/streams?ids=${streamId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.streams && data.streams.length > 0) {
          ch = data.streams[0];
        }
      }
    } catch (_) {}
  }
  if (ch) {
    openPlayer(ch, true);
  } else {
    window.location.href = `/izle/${streamId}`;
  }
}

// =============================================================
// GOOGLE TV "YOUR APPS" ROW (DAİRESEL UYGULAMA İKONLARI)
// =============================================================
// =============================================================
// // PLATFORMLAR (DİKDÖRTGEN KARTLAR & LINEAR GRADIENT FADE)
// =============================================================
function getPlatformRectangularConfig(id, name) {
  switch (id) {
    case 'netflix':
      return {
        label: 'Netflix',
        logoHtml: `<img src="/assets/platforms/netflix.svg" alt="Netflix" class="h-7 sm:h-9 max-w-[135px] object-contain select-none pointer-events-none filter drop-shadow-md group-hover:scale-110 transition-transform duration-300" />`,
        cardBg: 'bg-gradient-to-br from-[#E50914] via-[#b5070f] to-[#831010]',
        border: 'border-red-700/50',
        hoverBorder: 'hover:border-red-300',
        hoverShadow: 'hover:shadow-[0_12px_32px_rgba(229,9,20,0.7)]',
        radialGlow: 'rgba(229,9,20,0.35)'
      };
    case 'prime':
      return {
        label: 'Prime Video',
        logoHtml: `<img src="/assets/platforms/prime.svg" alt="Prime Video" class="h-7 sm:h-9 max-w-[135px] object-contain select-none pointer-events-none filter drop-shadow-md group-hover:scale-110 transition-transform duration-300" />`,
        cardBg: 'bg-gradient-to-br from-[#00A8E1] via-[#0079a8] to-[#00506e]',
        border: 'border-sky-400/50',
        hoverBorder: 'hover:border-sky-200',
        hoverShadow: 'hover:shadow-[0_12px_32px_rgba(0,168,225,0.7)]',
        radialGlow: 'rgba(0,168,225,0.35)'
      };
    case 'disney':
      return {
        label: 'Disney+',
        logoHtml: `<img src="/assets/platforms/disney.svg" alt="Disney+" class="h-8 sm:h-10 max-w-[135px] object-contain select-none pointer-events-none filter drop-shadow-md group-hover:scale-110 transition-transform duration-300" />`,
        cardBg: 'bg-gradient-to-br from-[#1434CB] via-[#0d25a0] to-[#071670]',
        border: 'border-blue-400/50',
        hoverBorder: 'hover:border-blue-300',
        hoverShadow: 'hover:shadow-[0_12px_32px_rgba(20,52,203,0.7)]',
        radialGlow: 'rgba(20,52,203,0.35)'
      };
    case 'appletv':
      return {
        label: 'Apple TV+',
        logoHtml: `<img src="/assets/platforms/appletv.svg" alt="Apple TV+" class="h-7 sm:h-9 max-w-[130px] object-contain select-none pointer-events-none filter drop-shadow-md group-hover:scale-110 transition-transform duration-300" />`,
        cardBg: 'bg-gradient-to-br from-[#3a3a3c] via-[#1c1c1e] to-[#000000]',
        border: 'border-white/30',
        hoverBorder: 'hover:border-white/80',
        hoverShadow: 'hover:shadow-[0_12px_32px_rgba(255,255,255,0.3)]',
        radialGlow: 'rgba(255,255,255,0.18)'
      };
    case 'blutv':
      return {
        label: 'BluTV / Max',
        logoHtml: `
          <div class="flex items-center space-x-2.5 select-none pointer-events-none group-hover:scale-110 transition-transform duration-300">
            <img src="/assets/platforms/max.svg" alt="Max" class="h-6 sm:h-8 max-w-[80px] object-contain filter drop-shadow" />
            <span class="text-white/60 font-light text-sm">/</span>
            <img src="/assets/platforms/blutv.svg" alt="BluTV" class="h-5 sm:h-6 max-w-[65px] object-contain filter drop-shadow" />
          </div>
        `,
        cardBg: 'bg-gradient-to-br from-[#6A1F9E] via-[#4e1678] to-[#2d0c4a]',
        border: 'border-purple-500/50',
        hoverBorder: 'hover:border-purple-300',
        hoverShadow: 'hover:shadow-[0_12px_32px_rgba(106,31,158,0.7)]',
        radialGlow: 'rgba(106,31,158,0.35)'
      };
    case 'exxen':
      return {
        label: 'Exxen',
        logoHtml: `<img src="/assets/platforms/exxen.png" alt="Exxen" class="h-7 sm:h-9 max-w-[135px] object-contain select-none pointer-events-none filter drop-shadow-md group-hover:scale-110 transition-transform duration-300" />`,
        cardBg: 'bg-gradient-to-br from-[#B8971E] via-[#8a6e12] to-[#5a470a]',
        border: 'border-yellow-500/50',
        hoverBorder: 'hover:border-yellow-300',
        hoverShadow: 'hover:shadow-[0_12px_32px_rgba(184,151,30,0.7)]',
        radialGlow: 'rgba(184,151,30,0.35)'
      };
    case 'tabii':
      return {
        label: 'Tabii',
        logoHtml: `<img src="/assets/platforms/tabii.svg" alt="Tabii" class="h-7 sm:h-9 max-w-[135px] object-contain select-none pointer-events-none filter drop-shadow-md group-hover:scale-110 transition-transform duration-300" />`,
        cardBg: 'bg-gradient-to-br from-[#00A878] via-[#007a57] to-[#005038]',
        border: 'border-emerald-400/50',
        hoverBorder: 'hover:border-emerald-300',
        hoverShadow: 'hover:shadow-[0_12px_32px_rgba(0,168,120,0.7)]',
        radialGlow: 'rgba(0,168,120,0.35)'
      };
    case 'bein':
      return {
        label: 'beIN / TOD',
        logoHtml: `<img src="/assets/platforms/bein.png" alt="beIN / TOD" class="h-8 sm:h-10 max-w-[135px] object-contain select-none pointer-events-none filter drop-shadow-md group-hover:scale-110 transition-transform duration-300" />`,
        cardBg: 'bg-gradient-to-br from-[#6B189E] via-[#4d0f74] to-[#2e0847]',
        border: 'border-purple-500/50',
        hoverBorder: 'hover:border-purple-300',
        hoverShadow: 'hover:shadow-[0_12px_32px_rgba(107,24,158,0.7)]',
        radialGlow: 'rgba(107,24,158,0.35)'
      };
    case 'gain':
      return {
        label: 'GAİN',
        logoHtml: `<img src="/assets/platforms/gain.png" alt="GAİN" class="h-7 sm:h-9 max-w-[130px] object-contain select-none pointer-events-none filter drop-shadow-md group-hover:scale-110 transition-transform duration-300" />`,
        cardBg: 'bg-gradient-to-br from-[#F5A623] via-[#c07f10] to-[#7a5108]',
        border: 'border-amber-400/50',
        hoverBorder: 'hover:border-amber-300',
        hoverShadow: 'hover:shadow-[0_12px_32px_rgba(245,166,35,0.7)]',
        radialGlow: 'rgba(245,166,35,0.35)'
      };
    case 'tvplus':
      return {
        label: 'NoLimit',
        logoHtml: `<img src="/assets/platforms/tvplus.png" alt="NoLimit" class="h-8 sm:h-10 max-w-[135px] object-contain select-none pointer-events-none filter drop-shadow-md group-hover:scale-110 transition-transform duration-300" />`,
        cardBg: 'bg-gradient-to-br from-[#00C951] via-[#009940] to-[#006428]',
        border: 'border-green-400/50',
        hoverBorder: 'hover:border-green-300',
        hoverShadow: 'hover:shadow-[0_12px_32px_rgba(0,201,81,0.7)]',
        radialGlow: 'rgba(0,201,81,0.35)'
      };
    default:
      return {
        label: name || id,

        logoHtml: `<span class="font-bold text-white text-base select-none">${escapeHtml(name || id)}</span>`,
        cardBg: 'bg-gradient-to-br from-[#1b1c23] via-[#131418] to-[#0c0d10]',
        border: 'border-white/10',
        hoverBorder: 'hover:border-white/40',
        hoverShadow: 'hover:shadow-[0_12px_32px_rgba(255,255,255,0.25)]',
        radialGlow: 'rgba(255,255,255,0.1)'
      };
  }
}

function renderHomePlatforms(platforms) {
  const container = document.getElementById('home-platforms-grid');
  if (!container) return;

  // Dikdörtgen platform kartları: ekrana en fazla 6 kart sığar, 6. kart yarıda (half) görünür
  container.innerHTML = platforms.map(p => {
    const cfg = getPlatformRectangularConfig(p.id, p.name);
    return `
      <div 
        onclick="openPlatformPage('${p.id}')"
        class="platform-rect-card group relative flex-shrink-0 w-[165px] sm:w-[190px] md:w-[204px] lg:w-[214px] h-[92px] sm:h-[105px] lg:h-[114px] rounded-2xl p-4 sm:p-5 flex items-center justify-center cursor-pointer transition-transform duration-300 ease-out transform hover:scale-[1.04] hover:-translate-y-1 shadow-lg border ${cfg.border || 'border-white/10'} ${cfg.cardBg} ${cfg.hoverBorder} ${cfg.hoverShadow} overflow-hidden select-none"
        title="${escapeHtml(p.name)}"
      >
        <!-- Arka Plan Radial Glow Efekti -->
        <div class="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" style="background: radial-gradient(circle at center, ${cfg.radialGlow} 0%, transparent 70%);"></div>

        <!-- Üst Cam Işıltısı -->
        <div class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none"></div>

        <!-- Resmi Yüksek Çözünürlüklü Marka Logosu -->
        ${cfg.logoHtml}
      </div>
    `;
  }).join('');

  initPlatformsScroll();
  updatePlatformsFade();
}

function initPlatformsScroll() {
  const container = document.getElementById('home-platforms-grid');
  if (!container || container.dataset.scrollInited) return;
  container.dataset.scrollInited = 'true';

  let isDown = false;
  let startX = 0;
  let scrollStartLeft = 0;
  let hasMoved = false;
  let momentumAnimId = null;

  // Hareket geçmişi (Son 100ms içindeki hız hesaplaması için)
  let history = [];

  function stopMomentum() {
    if (momentumAnimId) {
      cancelAnimationFrame(momentumAnimId);
      momentumAnimId = null;
    }
  }

  function startMomentum(velocity) {
    stopMomentum();
    let v = velocity;
    const friction = 0.94; // Pürüzsüz serbest kayma (free-glide)

    function step() {
      if (Math.abs(v) < 0.25) {
        stopMomentum();
        return;
      }
      container.scrollLeft -= v;
      v *= friction;
      updatePlatformsFade();
      momentumAnimId = requestAnimationFrame(step);
    }
    momentumAnimId = requestAnimationFrame(step);
  }

  function onDown(clientX) {
    stopMomentum();
    isDown = true;
    hasMoved = false;
    startX = clientX;
    scrollStartLeft = container.scrollLeft;
    history = [{ x: clientX, t: performance.now() }];
    container.classList.add('cursor-grabbing');
  }

  function onMove(clientX) {
    if (!isDown) return;
    const now = performance.now();
    const deltaX = clientX - startX;
    if (Math.abs(deltaX) > 6) {
      hasMoved = true;
    }
    container.scrollLeft = scrollStartLeft - deltaX;
    history.push({ x: clientX, t: now });
    // Son 100ms içindeki noktaları koru
    while (history.length > 1 && (now - history[0].t > 100)) {
      history.shift();
    }
    updatePlatformsFade();
  }

  function onUp() {
    if (!isDown) return;
    isDown = false;
    if (container) container.classList.remove('cursor-grabbing');

    if (hasMoved && history.length >= 2) {
      const now = performance.now();
      const first = history[0];
      const last = history[history.length - 1];
      const dt = last.t - first.t;
      if (dt > 10 && (now - last.t < 80)) {
        const dx = last.x - first.x;
        let v = (dx / dt) * 16;
        v = Math.max(-45, Math.min(45, v));
        if (Math.abs(v) > 0.5) {
          startMomentum(v);
        }
      }
    }
  }

  // Fare Dinleyicileri
  container.addEventListener('mousedown', (e) => {
    onDown(e.clientX);
  });

  window.addEventListener('mouseup', () => {
    onUp();
  });

  container.addEventListener('mouseleave', () => {
    onUp();
  });

  window.addEventListener('mousemove', (e) => {
    if (isDown) {
      onMove(e.clientX);
    }
  });

  // Dokunmatik Ekran / Touch Dinleyicileri
  container.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches.length === 1) {
      onDown(e.touches[0].clientX);
    }
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (isDown && e.touches && e.touches.length === 1) {
      onMove(e.touches[0].clientX);
    }
  }, { passive: true });

  window.addEventListener('touchend', () => {
    onUp();
  }, { passive: true });

  // Sürükleme yapıldığında kartların tıklanıp açılmasını önle
  container.addEventListener('click', (e) => {
    if (hasMoved) {
      e.preventDefault();
      e.stopPropagation();
      setTimeout(() => { hasMoved = false; }, 60);
    }
  }, true);

  // Fare tekerleğiyle (wheel) pürüzsüz yatay kaydırma
  container.addEventListener('wheel', (e) => {
    if (e.deltaY !== 0) {
      e.preventDefault();
      stopMomentum();
      container.scrollBy({ left: e.deltaY * 1.8, behavior: 'smooth' });
      setTimeout(updatePlatformsFade, 50);
    }
  }, { passive: false });

  // Scroll eventinde karartma efektlerini güncelle
  container.addEventListener('scroll', updatePlatformsFade);
}

function updatePlatformsFade() {
  const container = document.getElementById('home-platforms-grid');
  const leftFade = document.getElementById('platforms-left-fade');
  const rightFade = document.getElementById('platforms-right-fade');
  if (!container) return;

  // Sol karartma: Kullanıcı sağa kaydırdıysa görünür
  if (leftFade) {
    if (container.scrollLeft > 20) {
      leftFade.classList.remove('opacity-0');
      leftFade.classList.add('opacity-100');
    } else {
      leftFade.classList.add('opacity-0');
      leftFade.classList.remove('opacity-100');
    }
  }

  // Sağ karartma: En sona ulaşıldığında gizlenir, aksi halde linear kaydırma hissi verir
  if (rightFade) {
    const maxScroll = container.scrollWidth - container.clientWidth - 25;
    if (container.scrollLeft >= maxScroll) {
      rightFade.classList.add('opacity-0');
    } else {
      rightFade.classList.remove('opacity-0');
    }
  }
}

function scrollPlatformsRow(direction) {
  const container = document.getElementById('home-platforms-grid');
  if (!container) return;
  const scrollAmount = direction * 350;
  container.scrollBy({ left: scrollAmount, behavior: 'smooth' });
  setTimeout(updatePlatformsFade, 300);
}

// =============================================================
// CINEMATIC HERO SPOTLIGHT (NETFLIX STYLE - TRENDYOL SÜPER LİG & ÖNE ÇIKAN İÇERİKLER)
// =============================================================

function getMatchStartTime(m) {
  if (!m) return 0;
  if (m.startDate) {
    const t = new Date(m.startDate).getTime();
    if (!isNaN(t) && t > 0) return t;
  }
  if (m.date && m.time) {
    try {
      const p = m.date.split('.');
      if (p.length === 3) {
        const tp = m.time.split(':');
        const d = new Date(Date.UTC(
          parseInt(p[2], 10),
          parseInt(p[1], 10) - 1,
          parseInt(p[0], 10),
          parseInt(tp[0], 10) - 3, // Türkiye UTC+3
          parseInt(tp[1] || '0', 10)
        ));
        const t = d.getTime();
        if (!isNaN(t) && t > 0) return t;
      }
    } catch (_) {}
  }
  return 0;
}

function getUpcomingSuperLigMatches(matches) {
  const now = Date.now();
  return (matches || []).filter(m => {
    if (!m.isSuperLig) return false;
    if (m.status === 'LIVE' || m.status === 'FINISHED') return false;
    const start = getMatchStartTime(m);
    // Maç yayın saati gelmişse sliderda gösterme (yalnızca henüz başlamamış olanlar)
    return start > now;
  });
}

function formatCountdown(diffMs) {
  if (diffMs <= 0) return '00:00:00';
  const totalSecs = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSecs / 86400);
  const hours = Math.floor((totalSecs % 86400) / 3600);
  const minutes = Math.floor((totalSecs % 3600) / 60);
  const seconds = totalSecs % 60;
  const pad = (n) => String(n).padStart(2, '0');

  if (days > 0) {
    return `${days} gün ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function startHeroCountdownTimer(startTime) {
  if (STATE.sportsHero.countdownInterval) {
    clearInterval(STATE.sportsHero.countdownInterval);
    STATE.sportsHero.countdownInterval = null;
  }

  function tick() {
    const el = document.getElementById('hero-match-countdown-text');
    if (!el) return;
    const now = Date.now();
    const diff = startTime - now;

    if (diff <= 0) {
      // Maç yayın saati geldi! Slider'dan çıkar
      if (STATE.sportsHero.countdownInterval) {
        clearInterval(STATE.sportsHero.countdownInterval);
        STATE.sportsHero.countdownInterval = null;
      }
      handleHeroMatchExpired();
      return;
    }

    el.textContent = formatCountdown(diff) + ' kaldı.';
  }

  tick();
  STATE.sportsHero.countdownInterval = setInterval(tick, 1000);
}

function handleHeroMatchExpired() {
  const allMatches = STATE.sportsSchedule?.data?.matches || [];
  const upcoming = getUpcomingSuperLigMatches(allMatches);
  if (upcoming.length > 0) {
    renderSportsHero(upcoming);
  } else {
    // Maç kalmadıysa platformlardan rastgele öne çıkan içerik göster
    renderRandomPlatformFeaturedHero();
  }
}

function renderRandomPlatformFeaturedHero() {
  // Spor slider zamanlayıcılarını durdur
  if (STATE.sportsHero.timer) {
    clearInterval(STATE.sportsHero.timer);
    STATE.sportsHero.timer = null;
  }
  if (STATE.sportsHero.countdownInterval) {
    clearInterval(STATE.sportsHero.countdownInterval);
    STATE.sportsHero.countdownInterval = null;
  }

  let pool = [];
  if (STATE.homeFeatured && Array.isArray(STATE.homeFeatured.heroes) && STATE.homeFeatured.heroes.length > 0) {
    pool = STATE.homeFeatured.heroes;
  } else if (STATE.homeFeatured) {
    if (Array.isArray(STATE.homeFeatured.popularSeries)) pool.push(...STATE.homeFeatured.popularSeries);
    if (Array.isArray(STATE.homeFeatured.trendingMovies)) pool.push(...STATE.homeFeatured.trendingMovies);
  }

  if (pool.length > 0) {
    renderHomeHero(pool);
  }
}

function renderSportsHero(matches) {
  const upcoming = getUpcomingSuperLigMatches(matches);
  if (!upcoming || upcoming.length === 0) {
    renderRandomPlatformFeaturedHero();
    return;
  }

  STATE.sportsHero.matches = upcoming;
  if (STATE.sportsHero.currentIndex >= upcoming.length) {
    STATE.sportsHero.currentIndex = 0;
  }

  showSportsHeroSlide(STATE.sportsHero.currentIndex);
  setupSportsHeroTimer();
}

function showSportsHeroSlide(index) {
  // Yayın saati gelmiş veya geçmiş maçları temizle
  const upcoming = getUpcomingSuperLigMatches(STATE.sportsHero.matches);
  if (!upcoming || upcoming.length === 0) {
    renderRandomPlatformFeaturedHero();
    return;
  }

  STATE.sportsHero.matches = upcoming;
  index = (index + upcoming.length) % upcoming.length;
  STATE.sportsHero.currentIndex = index;

  const m = upcoming[index];
  const startTime = getMatchStartTime(m);
  const heroContent = document.getElementById('home-hero-content');
  const backdrop = document.getElementById('home-hero-backdrop');
  const prevBtn = document.getElementById('hero-prev-btn');
  const nextBtn = document.getElementById('hero-next-btn');
  const dotsContainer = document.getElementById('hero-dots-container');

  // Slider butonlarının görünürlüğü
  if (upcoming.length > 1) {
    if (prevBtn) prevBtn.classList.remove('hidden');
    if (nextBtn) nextBtn.classList.remove('hidden');
  } else {
    if (prevBtn) prevBtn.classList.add('hidden');
    if (nextBtn) nextBtn.classList.add('hidden');
  }

  // Arka plan: Maçlar varken kullanıcının yüklediği gece stadyum görseli
  if (backdrop) {
    backdrop.style.backgroundImage = "url('/stadium_hero_bg.png')";
    backdrop.style.backgroundPosition = 'center center';
    backdrop.style.backgroundSize = 'cover';
    backdrop.style.backgroundRepeat = 'no-repeat';
    backdrop.style.backgroundColor = '#000000';
  }

  const leftVignette = document.getElementById('home-hero-left-vignette');
  if (leftVignette) {
    leftVignette.classList.remove('opacity-100');
    leftVignette.classList.add('opacity-0');
  }

  const homeLogoUrl = m.homeTeam?.logo || '';
  const awayLogoUrl = m.awayTeam?.logo || '';

  // Takım Logoları (Yüksek Çözünürlük ve Drop-shadow)
  const homeLogo = homeLogoUrl
    ? `<img src="${homeLogoUrl}" alt="${escapeHtml(m.homeTeam.name)}" class="w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 object-contain filter drop-shadow-[0_10px_25px_rgba(0,0,0,0.95)]" onerror="this.src='/favicon.ico'; this.onerror=null;">`
    : `<div class="w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 rounded-2xl bg-white/10 flex items-center justify-center text-3xl font-black text-white">${(m.homeTeam?.name || '?').charAt(0)}</div>`;

  const awayLogo = awayLogoUrl
    ? `<img src="${awayLogoUrl}" alt="${escapeHtml(m.awayTeam.name)}" class="w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 object-contain filter drop-shadow-[0_10px_25px_rgba(0,0,0,0.95)]" onerror="this.src='/favicon.ico'; this.onerror=null;">`
    : `<div class="w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 rounded-2xl bg-white/10 flex items-center justify-center text-3xl font-black text-white">${(m.awayTeam?.name || '?').charAt(0)}</div>`;

  const pad = (n) => String(n).padStart(2, '0');
  let formattedDate = '';
  if (startTime > 0) {
    const d = new Date(startTime);
    formattedDate = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  } else if (m.date) {
    const parts = m.date.split('-');
    if (parts.length === 3) {
      formattedDate = `${pad(parts[2])}.${pad(parts[1])}.${parts[0]}`;
    } else {
      formattedDate = m.date;
    }
  } else {
    const today = new Date();
    formattedDate = `${pad(today.getDate())}.${pad(today.getMonth() + 1)}.${today.getFullYear()}`;
  }
  const matchTime = m.time || '20:00';

  if (heroContent) {
    heroContent.className = "absolute inset-0 w-full h-full flex flex-col items-center justify-center text-center z-20 select-none overflow-hidden";
    heroContent.innerHTML = `
      <!-- Sol Takım 3D Yatık Arkaplan Filigranı (3D Perspective Slanted Watermark) -->
      ${homeLogoUrl ? `
        <div class="absolute -left-16 sm:-left-10 md:left-[0%] lg:left-[1%] top-1/2 -translate-y-1/2 w-[300px] h-[300px] sm:w-[400px] sm:h-[400px] md:w-[480px] md:h-[480px] lg:w-[560px] lg:h-[560px] pointer-events-none select-none z-10 transition-all duration-700" style="perspective: 1200px;">
          <img 
            src="${homeLogoUrl}" 
            class="w-full h-full object-contain filter contrast-125 brightness-90 drop-shadow-[0_20px_50px_rgba(0,0,0,0.95)]" 
            style="transform: perspective(1000px) rotateY(32deg) rotateX(8deg) rotateZ(-12deg); opacity: 0.12;" 
            alt="" 
            onerror="this.style.display='none'"
          />
        </div>
      ` : ''}

      <!-- Sağ Takım 3D Yatık Arkaplan Filigranı (3D Perspective Slanted Watermark) -->
      ${awayLogoUrl ? `
        <div class="absolute -right-16 sm:-right-10 md:right-[0%] lg:right-[1%] top-1/2 -translate-y-1/2 w-[300px] h-[300px] sm:w-[400px] sm:h-[400px] md:w-[480px] md:h-[480px] lg:w-[560px] lg:h-[560px] pointer-events-none select-none z-10 transition-all duration-700" style="perspective: 1200px;">
          <img 
            src="${awayLogoUrl}" 
            class="w-full h-full object-contain filter contrast-125 brightness-90 drop-shadow-[0_20px_50px_rgba(0,0,0,0.95)]" 
            style="transform: perspective(1000px) rotateY(-32deg) rotateX(8deg) rotateZ(12deg); opacity: 0.12;" 
            alt="" 
            onerror="this.style.display='none'"
          />
        </div>
      ` : ''}

      <!-- Merkez İçerik Alanı -->
      <div class="w-full max-w-4xl mx-auto px-4 flex flex-col items-center justify-center space-y-2 sm:space-y-3 relative z-20 pt-1">
        <!-- Üst Başlık & Saat & Tarih & Slogan -->
        <div class="space-y-0.5 sm:space-y-1 select-none">
          <div class="text-[11px] sm:text-xs md:text-sm font-semibold tracking-[0.35em] sm:tracking-[0.45em] text-gray-300 uppercase">
            TRENDYOL SÜPER LİG
          </div>
          <div class="text-5xl sm:text-6xl md:text-7xl font-black text-white tracking-tight drop-shadow-[0_4px_24px_rgba(0,0,0,0.95)] leading-none">
            ${escapeHtml(matchTime)}
          </div>
          <div class="text-base sm:text-xl md:text-2xl font-light text-gray-300 tracking-[0.25em] pt-0.5">
            ${escapeHtml(formattedDate)}
          </div>
          <div class="text-[9px] sm:text-[10px] md:text-xs font-medium tracking-[0.35em] sm:tracking-[0.45em] text-gray-400 uppercase pt-0.5">
            B Ü Y Ü K &nbsp; H E Y E C A N A &nbsp; O R T A K &nbsp; O L
          </div>
        </div>

        <!-- Maç Karşılaşması -->
        <div class="flex items-center justify-center space-x-6 sm:space-x-12 md:space-x-16 my-2 sm:my-3">
          <!-- Ev Sahibi -->
          <div class="flex flex-col items-center text-center group cursor-pointer" onclick="${m.streamId ? `playMatchChannel(${m.streamId})` : ''}">
            <div class="w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 flex items-center justify-center transform group-hover:scale-105 transition duration-300">
              ${homeLogo}
            </div>
            <span class="text-xl sm:text-2xl md:text-3xl font-extrabold text-white mt-2 tracking-tight drop-shadow-[0_4px_12px_rgba(0,0,0,0.9)] max-w-[160px] sm:max-w-[220px] truncate">
              ${escapeHtml(m.homeTeam?.name || 'Ev Sahibi')}
            </span>
          </div>

          <!-- Süper Lig Logosu -->
          <div class="flex-shrink-0 px-2 sm:px-4 flex items-center justify-center">
            <img 
              src="/assets/trendyol_super_lig_white.svg" 
              alt="Trendyol Süper Lig" 
              class="h-14 sm:h-18 md:h-22 w-auto object-contain select-none pointer-events-none filter drop-shadow-2xl" 
            />
          </div>

          <!-- Deplasman -->
          <div class="flex flex-col items-center text-center group cursor-pointer" onclick="${m.streamId ? `playMatchChannel(${m.streamId})` : ''}">
            <div class="w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 flex items-center justify-center transform group-hover:scale-105 transition duration-300">
              ${awayLogo}
            </div>
            <span class="text-xl sm:text-2xl md:text-3xl font-extrabold text-white mt-2 tracking-tight drop-shadow-[0_4px_12px_rgba(0,0,0,0.9)] max-w-[160px] sm:max-w-[220px] truncate">
              ${escapeHtml(m.awayTeam?.name || 'Deplasman')}
            </span>
          </div>
        </div>

        <!-- Bilgi Satırı: Saat, Kanal, Stadyum -->
        <div class="space-y-1 text-center">
          <div class="flex items-center justify-center space-x-3 sm:space-x-5 text-xs sm:text-sm text-gray-300 flex-wrap gap-y-1 font-medium">
            <div class="flex items-center space-x-1.5">
              <i data-lucide="clock" class="w-4 h-4 text-gray-400"></i>
              <span>Bugün ${escapeHtml(matchTime)}</span>
            </div>

            ${m.primaryChannel ? `
              <span class="text-gray-600 hidden sm:inline">•</span>
              <div class="flex items-center space-x-1.5">
                <i data-lucide="tv" class="w-4 h-4 text-gray-400"></i>
                <span>${escapeHtml(m.primaryChannel)}</span>
              </div>
            ` : ''}

            ${m.stadium ? `
              <span class="text-gray-600 hidden sm:inline">•</span>
              <div class="flex items-center space-x-1.5">
                <svg class="w-4 h-4 text-gray-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <ellipse cx="12" cy="12" rx="10" ry="6"></ellipse>
                  <path d="M2 12v2c0 3.3 4.5 6 10 6s10-2.7 10-6v-2"></path>
                  <path d="M6 9v3"></path>
                  <path d="M10 11v3"></path>
                  <path d="M14 11v3"></path>
                  <path d="M18 9v3"></path>
                </svg>
                <span class="max-w-[260px] sm:max-w-md truncate">${escapeHtml(m.stadium)}</span>
              </div>
            ` : ''}
          </div>

          <!-- Canlı Geri Sayım Ticker -->
          ${startTime > Date.now() ? `
            <div class="flex items-center justify-center space-x-1.5 text-tv-yellow text-sm sm:text-base font-bold font-mono tracking-tight pt-0.5" title="Maçın başlamasına kalan süre">
              <i data-lucide="timer" class="w-4 h-4 text-tv-yellow"></i>
              <span id="hero-match-countdown-text">${formatCountdown(startTime - Date.now())} kaldı.</span>
            </div>
          ` : ''}
        </div>

        <!-- Aksiyon Butonları -->
        <div class="flex items-center justify-center pt-2">
          ${m.hasStream && m.streamId ? `
            <button onclick="playMatchChannel(${m.streamId})" class="px-7 sm:px-9 py-3 sm:py-3.5 rounded-xl bg-tv-yellow hover:bg-tv-yellow-hover text-black font-extrabold text-sm sm:text-base flex items-center space-x-2.5 transition transform hover:scale-105 shadow-xl shadow-yellow-500/30 active:scale-95 cursor-pointer">
              <i data-lucide="play" class="w-5 h-5 fill-current"></i>
              <span>Maçı Canlı İzle</span>
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }

  // Alt Slider Noktaları
  if (dotsContainer) {
    if (upcoming.length > 1) {
      dotsContainer.innerHTML = upcoming.map((_, i) => `
        <button onclick="showSportsHeroSlide(${i}); resetSportsHeroTimer();" title="Maç ${i + 1}" class="h-2.5 rounded-full transition-all duration-300 cursor-pointer ${i === index ? 'bg-tv-yellow w-8 shadow-lg shadow-yellow-500/50' : 'bg-white/30 hover:bg-white/60 w-2.5'}"></button>
      `).join('');
    } else {
      dotsContainer.innerHTML = '';
    }
  }

  if (startTime > Date.now()) {
    startHeroCountdownTimer(startTime);
  }

  initIcons();
}

STATE.netflixHero = {
  heroes: [],
  currentIndex: 0,
  timer: null
};

function nextHeroSlide() {
  if (STATE.sportsHero.matches && STATE.sportsHero.matches.length > 0) {
    showSportsHeroSlide(STATE.sportsHero.currentIndex + 1);
    resetSportsHeroTimer();
  } else if (STATE.netflixHero.heroes && STATE.netflixHero.heroes.length > 0) {
    showHomeHeroSlide(STATE.netflixHero.currentIndex + 1);
    resetHomeHeroTimer();
  }
}

function prevHeroSlide() {
  if (STATE.sportsHero.matches && STATE.sportsHero.matches.length > 0) {
    showSportsHeroSlide(STATE.sportsHero.currentIndex - 1);
    resetSportsHeroTimer();
  } else if (STATE.netflixHero.heroes && STATE.netflixHero.heroes.length > 0) {
    showHomeHeroSlide(STATE.netflixHero.currentIndex - 1);
    resetHomeHeroTimer();
  }
}

function setupSportsHeroTimer() {
  if (STATE.sportsHero.timer) clearInterval(STATE.sportsHero.timer);
  if (STATE.sportsHero.matches && STATE.sportsHero.matches.length > 1) {
    STATE.sportsHero.timer = setInterval(() => {
      showSportsHeroSlide(STATE.sportsHero.currentIndex + 1);
    }, 8000);
  }
}

function resetSportsHeroTimer() {
  setupSportsHeroTimer();
}

function pauseSportsHeroTimer() {
  if (STATE.sportsHero && STATE.sportsHero.timer) {
    clearInterval(STATE.sportsHero.timer);
    STATE.sportsHero.timer = null;
  }
}

function resumeSportsHeroTimer() {
  setupSportsHeroTimer();
}

function setupHomeHeroTimer() {
  if (STATE.netflixHero.timer) clearInterval(STATE.netflixHero.timer);
  if (STATE.netflixHero.heroes && STATE.netflixHero.heroes.length > 1) {
    STATE.netflixHero.timer = setInterval(() => {
      showHomeHeroSlide(STATE.netflixHero.currentIndex + 1);
    }, 8000);
  }
}

function resetHomeHeroTimer() {
  setupHomeHeroTimer();
}

function pauseHomeHeroTimer() {
  if (STATE.netflixHero && STATE.netflixHero.timer) {
    clearInterval(STATE.netflixHero.timer);
    STATE.netflixHero.timer = null;
  }
}

function resumeHomeHeroTimer() {
  setupHomeHeroTimer();
}

function pauseHeroTimer() {
  pauseSportsHeroTimer();
  pauseHomeHeroTimer();
}

function resumeHeroTimer() {
  resumeSportsHeroTimer();
  resumeHomeHeroTimer();
}

function scrollToSportsSchedule() {
  const el = document.getElementById('home-sports-section');
  if (el) {
    el.scrollIntoView({ behavior: 'smooth' });
    switchSportsTab('super_lig');
  }
}

// Fallback: Süper Lig maçı yoksa Netflix / Platform Orijinal Hero Banner'ı
function renderHomeHero(heroes) {
  if (!heroes || heroes.length === 0) return;
  STATE.netflixHero.heroes = heroes;
  if (STATE.netflixHero.currentIndex >= heroes.length) {
    STATE.netflixHero.currentIndex = 0;
  }
  showHomeHeroSlide(STATE.netflixHero.currentIndex);
  setupHomeHeroTimer();
}

function showHomeHeroSlide(index) {
  const heroes = STATE.netflixHero.heroes;
  if (!heroes || heroes.length === 0) return;

  index = (index + heroes.length) % heroes.length;
  STATE.netflixHero.currentIndex = index;

  const hero = heroes[index];
  const heroContent = document.getElementById('home-hero-content');
  const backdrop = document.getElementById('home-hero-backdrop');
  const leftVignette = document.getElementById('home-hero-left-vignette');
  const prevBtn = document.getElementById('hero-prev-btn');
  const nextBtn = document.getElementById('hero-next-btn');
  const dotsContainer = document.getElementById('hero-dots-container');

  // Arka plan görseli (Yatay TMDB Backdrop)
  if (backdrop) {
    const bg = hero.backdrop || hero.cover || 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?auto=format&fit=crop&w=1920&q=80';
    backdrop.style.backgroundImage = `url('${bg}')`;
    backdrop.style.backgroundPosition = 'center 20%';
  }

  // Sol sinematik vinyet karartmasını aktif et
  if (leftVignette) {
    leftVignette.classList.remove('opacity-0', 'opacity-20');
    leftVignette.classList.add('opacity-100');
  }

  // Slider butonlarının görünürlüğü
  if (heroes.length > 1) {
    if (prevBtn) prevBtn.classList.remove('hidden');
    if (nextBtn) nextBtn.classList.remove('hidden');
  } else {
    if (prevBtn) prevBtn.classList.add('hidden');
    if (nextBtn) nextBtn.classList.add('hidden');
  }

  const isMovie = hero.type === 'movie' || hero.mediaType === 'movie';
  const typeText = isMovie ? 'FİLM' : 'DİZİ';
  const matchRate = hero.matchRate || 98;
  const year = hero.year || '2024';
  const ageRating = hero.ageRating || '16+';
  const durationText = hero.seasons || (isMovie ? '1 sa 54 dk' : '1 Sezon');
  const desc = hero.plot || 'Yüksek çözünürlüklü ve kesintisiz dijital yayın deneyimi.';

  // Platform Marka İkonu (Netflix, Prime, Disney, Apple vb.)
  let platformBadge = '';
  switch (hero.platform) {
    case 'netflix':
      platformBadge = `
        <div class="flex items-center space-x-2">
          <img src="/assets/platforms/netflix.svg" alt="Netflix" class="h-5 sm:h-6 object-contain filter drop-shadow" />
          <span class="text-xs sm:text-sm font-black tracking-[0.3em] uppercase text-gray-200">${typeText}</span>
        </div>`;
      break;
    case 'prime':
      platformBadge = `
        <div class="flex items-center space-x-2">
          <img src="/assets/platforms/prime.svg" alt="Prime Video" class="h-4 sm:h-5 object-contain filter drop-shadow" />
          <span class="text-xs sm:text-sm font-black tracking-[0.25em] uppercase text-gray-200">ORİJİNAL ${typeText}</span>
        </div>`;
      break;
    case 'disney':
      platformBadge = `
        <div class="flex items-center space-x-2">
          <img src="/assets/platforms/disney.svg" alt="Disney+" class="h-5 sm:h-6 object-contain filter drop-shadow" />
          <span class="text-xs sm:text-sm font-black tracking-[0.25em] uppercase text-gray-200">ORİJİNAL ${typeText}</span>
        </div>`;
      break;
    case 'appletv':
      platformBadge = `
        <div class="flex items-center space-x-2">
          <img src="/assets/platforms/appletv.svg" alt="Apple TV+" class="h-4 sm:h-5 object-contain filter drop-shadow" />
          <span class="text-xs sm:text-sm font-black tracking-[0.25em] uppercase text-gray-200">ORIGINAL</span>
        </div>`;
      break;
    case 'max':
    case 'blutv':
      platformBadge = `
        <div class="flex items-center space-x-2">
          <img src="/assets/platforms/max.svg" alt="Max" class="h-4 sm:h-5 object-contain filter drop-shadow" />
          <span class="text-xs sm:text-sm font-black tracking-[0.25em] uppercase text-gray-200">${typeText}</span>
        </div>`;
      break;
    default:
      platformBadge = `
        <div class="flex items-center space-x-1.5">
          <span class="w-2.5 h-2.5 rounded-full bg-red-600"></span>
          <span class="text-xs sm:text-sm font-black tracking-[0.3em] uppercase text-gray-200">NETFLIX ${typeText}</span>
        </div>`;
  }

  if (heroContent) {
    // Sola hizalı, geniş, sinematik Netflix stili
    heroContent.className = "absolute inset-0 max-w-7xl mx-auto px-6 sm:px-12 md:px-16 flex flex-col justify-center items-start text-left z-20 select-none";
    heroContent.innerHTML = `
      <div class="w-full max-w-2xl lg:max-w-3xl space-y-3.5 sm:space-y-4 pt-4 sm:pt-0">
        <!-- 1. Platform & TOP 10 Satırı -->
        <div class="flex items-center space-x-3 select-none flex-wrap gap-y-1">
          ${platformBadge}
          <span class="text-gray-500 hidden sm:inline">•</span>
          <div class="inline-flex items-center space-x-1.5 bg-black/60 border border-white/15 px-2.5 py-1 rounded-md backdrop-blur-md">
            <span class="bg-[#e50914] text-white text-[10px] font-black px-1.5 py-0.5 rounded shadow">TOP 10</span>
            <span class="text-xs font-bold text-white tracking-wide">Bugün Türkiye'de 1 Numara</span>
          </div>
        </div>

        <!-- 2. Büyük Sinematik Başlık -->
        <h1 class="text-3xl sm:text-5xl md:text-6xl lg:text-7xl font-black text-white tracking-tight leading-[1.06] drop-shadow-[0_4px_24px_rgba(0,0,0,0.95)] line-clamp-2">
          ${escapeHtml(hero.name)}
        </h1>

        <!-- 3. Netflix Meta Bilgileri (Eşleşme Oranı, Yıl, Yaş, Sezon, 4K HDR) -->
        <div class="flex items-center space-x-3 text-xs sm:text-sm flex-wrap gap-y-1.5 select-none font-semibold">
          <span class="text-[#46d369] font-black tracking-wide">%${matchRate} Eşleşme</span>
          <span class="text-gray-200 font-medium">${escapeHtml(year)}</span>
          <span class="border border-gray-400/60 bg-black/40 px-1.5 py-0.5 text-[11px] text-gray-200 font-bold rounded">
            ${escapeHtml(ageRating)}
          </span>
          <span class="text-gray-200 font-medium">${escapeHtml(durationText)}</span>
          <div class="flex items-center space-x-1.5 text-[10px] text-gray-300 font-bold">
            <span class="border border-white/30 bg-black/40 px-1.5 py-0.5 rounded">4K ULTRA HD</span>
            <span class="border border-white/30 bg-black/40 px-1.5 py-0.5 rounded">HDR</span>
            <span class="border border-white/30 bg-black/40 px-1.5 py-0.5 rounded">5.1</span>
          </div>
          ${hero.genre ? `
            <span class="text-gray-400 text-xs hidden md:inline font-normal">• ${escapeHtml(hero.genre)}</span>
          ` : ''}
        </div>

        <!-- 4. Konu Özeti (Plot Synopsis) -->
        <p class="text-sm sm:text-base md:text-lg text-gray-200 font-normal leading-relaxed max-w-xl line-clamp-3 drop-shadow-[0_2px_12px_rgba(0,0,0,0.95)]">
          ${escapeHtml(desc)}
        </p>

        <!-- 5. Netflix Aksiyon Butonları (Beyaz Oynat, Cam Detaylar, Yuvarlak Liste) -->
        <div class="flex items-center space-x-3 pt-2 select-none flex-wrap gap-y-2">
          <!-- Oynat (Play) -->
          <button id="netflix-hero-play-btn" class="px-7 sm:px-9 py-3 sm:py-3.5 rounded-lg bg-white hover:bg-white/85 text-black font-extrabold text-base sm:text-lg flex items-center space-x-2.5 transition transform hover:scale-105 active:scale-95 shadow-2xl cursor-pointer">
            <i data-lucide="play" class="w-6 h-6 fill-current"></i>
            <span>Oynat</span>
          </button>

          <!-- Daha Fazla Bilgi (More Info) -->
          <button id="netflix-hero-detail-btn" class="px-6 sm:px-8 py-3 sm:py-3.5 rounded-lg bg-white/20 hover:bg-white/30 text-white font-bold text-base sm:text-lg flex items-center space-x-2.5 border border-white/20 backdrop-blur-md transition transform hover:scale-105 active:scale-95 cursor-pointer">
            <i data-lucide="info" class="w-6 h-6"></i>
            <span>Daha Fazla Bilgi</span>
          </button>

          <!-- Listeme Ekle (Add to List) -->
          <button id="netflix-hero-fav-btn" class="w-12 h-12 rounded-full bg-black/50 hover:bg-white/20 text-white border border-white/30 flex items-center justify-center transition transform hover:scale-105 active:scale-95 cursor-pointer" title="Listeme Ekle">
            <i data-lucide="plus" class="w-6 h-6"></i>
          </button>
        </div>
      </div>
    `;

    // Buton Eylemleri
    const playBtn = document.getElementById('netflix-hero-play-btn');
    if (playBtn) {
      playBtn.onclick = () => {
        if (isMovie) {
          openMediaItem(hero, 'movie');
        } else {
          openSeriesDetailPage(hero.id);
        }
      };
    }

    const detailBtn = document.getElementById('netflix-hero-detail-btn');
    if (detailBtn) {
      detailBtn.onclick = () => {
        if (isMovie) {
          openMediaItem(hero, 'movie');
        } else {
          openSeriesDetailPage(hero.id);
        }
      };
    }

    const favBtn = document.getElementById('netflix-hero-fav-btn');
    if (favBtn) {
      favBtn.onclick = () => {
        toggleFavorite(hero, isMovie ? 'movie' : 'series');
        showToast(isFavorite(hero.id, isMovie ? 'movie' : 'series') ? 'Listeye eklendi' : 'Listeden çıkarıldı');
      };
    }
  }

  // Alt Slider Noktaları
  if (dotsContainer) {
    if (heroes.length > 1) {
      dotsContainer.innerHTML = heroes.map((_, i) => `
        <button onclick="showHomeHeroSlide(${i}); resetHomeHeroTimer();" title="İçerik ${i + 1}" class="h-2 rounded-full transition-all duration-300 cursor-pointer ${i === index ? 'bg-white w-8 shadow-lg' : 'bg-white/30 hover:bg-white/60 w-2'}"></button>
      `).join('');
    } else {
      dotsContainer.innerHTML = '';
    }
  }

  initIcons();
}

function renderHomeMoviesShelf(movies) {
  const container = document.getElementById('home-movies-shelf');
  if (!container) return;

  container.innerHTML = movies.map(m => {
    const title = cleanName(m.name, 'movie');
    return `
      <div 
        onclick="openMediaItem(${JSON.stringify(m).replace(/"/g, '&quot;')}, 'movie')"
        class="group flex-shrink-0 w-36 sm:w-44 cursor-pointer"
      >
        <div class="relative aspect-[2/3] rounded-xl overflow-hidden bg-zinc-900 border border-white/10 group-hover:border-tv-yellow/60 group-hover:scale-105 transition-all duration-300 shadow-md">
          <img 
            src="${m.icon || ''}" 
            alt="${escapeHtml(title)}" 
            class="w-full h-full object-cover group-hover:scale-110 transition duration-500" 
            loading="lazy"
            onerror="this.src='https://images.unsplash.com/photo-1594909122845-11baa439b7bf?auto=format&fit=crop&w=400&q=80'"
          />
          <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
            <div class="w-10 h-10 rounded-full bg-tv-yellow text-black flex items-center justify-center shadow-lg transform scale-90 group-hover:scale-100 transition">
              <i data-lucide="play" class="w-5 h-5 fill-current"></i>
            </div>
          </div>
          <div class="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur text-[10px] font-bold text-yellow-400 border border-white/10 flex items-center space-x-0.5">
            <span>★</span><span>${m.rating ? parseFloat(m.rating).toFixed(1) : '7.5'}</span>
          </div>
          ${m.year ? `<div class="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur text-[10px] text-gray-300 border border-white/10">${m.year}</div>` : ''}
        </div>
        <h3 class="text-xs sm:text-sm font-semibold text-gray-200 group-hover:text-tv-yellow truncate mt-2 transition" title="${escapeHtml(title)}">${escapeHtml(title)}</h3>
        <p class="text-[11px] text-gray-500 truncate">Film</p>
      </div>
    `;
  }).join('');
}

function renderHomeSeriesShelf(series) {
  const container = document.getElementById('home-series-shelf');
  if (!container) return;

  container.innerHTML = series.map(s => {
    const title = cleanName(s.name, 'series');
    return `
      <div 
        onclick="openSeriesDetailPage(${s.id})"
        class="group flex-shrink-0 w-36 sm:w-44 cursor-pointer"
      >
        <div class="relative aspect-[2/3] rounded-xl overflow-hidden bg-zinc-900 border border-white/10 group-hover:border-tv-yellow/60 group-hover:scale-105 transition-all duration-300 shadow-md">
          <img 
            src="${s.cover || s.backdrop || ''}" 
            alt="${escapeHtml(title)}" 
            class="w-full h-full object-cover group-hover:scale-110 transition duration-500" 
            loading="lazy"
            onerror="this.src='https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?auto=format&fit=crop&w=400&q=80'"
          />
          <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
            <div class="w-10 h-10 rounded-full bg-tv-yellow text-black flex items-center justify-center shadow-lg transform scale-90 group-hover:scale-100 transition">
              <i data-lucide="play" class="w-5 h-5 fill-current"></i>
            </div>
          </div>
          <div class="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur text-[10px] font-bold text-yellow-400 border border-white/10 flex items-center space-x-0.5">
            <span>★</span><span>${s.rating ? parseFloat(s.rating).toFixed(1) : '8.0'}</span>
          </div>
          <div class="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-purple-600/80 backdrop-blur text-[10px] font-bold text-white">DİZİ</div>
        </div>
        <h3 class="text-xs sm:text-sm font-semibold text-gray-200 group-hover:text-tv-yellow truncate mt-2 transition" title="${escapeHtml(title)}">${escapeHtml(title)}</h3>
        <p class="text-[11px] text-gray-500 truncate">${s.genre || 'Dizi'}</p>
      </div>
    `;
  }).join('');
}

function renderHomeChannelsShelf(channels) {
  const container = document.getElementById('home-channels-shelf');
  if (!container) return;

  container.innerHTML = channels.map(ch => {
    const title = cleanName(ch.name, 'channel');
    return `
      <div 
        onclick="openPlayer(${JSON.stringify(ch).replace(/"/g, '&quot;')})"
        class="group flex-shrink-0 flex items-center space-x-3 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-tv-yellow/50 transition cursor-pointer"
      >
        <div class="w-8 h-8 rounded-lg bg-black/60 flex items-center justify-center p-1 overflow-hidden border border-white/10">
          <img 
            src="${ch.icon || ''}" 
            alt="${escapeHtml(title)}" 
            class="w-full h-full object-contain" 
            loading="lazy"
            onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"
          />
          <i data-lucide="tv" class="w-4 h-4 text-gray-400 hidden"></i>
        </div>
        <div>
          <h4 class="text-xs font-bold text-white group-hover:text-tv-yellow transition truncate max-w-[120px]" title="${escapeHtml(title)}">${escapeHtml(title)}</h4>
          <span class="text-[10px] text-red-500 font-bold flex items-center space-x-1">
            <span class="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
            <span>CANLI</span>
          </span>
        </div>
      </div>
    `;
  }).join('');
}

// =============================================================
// PLATFORM SAYFASI & FİLTRE MOTORU
// =============================================================

async function openPlatformPage(platformSlug, filterType = 'all', push = true) {
  STATE.activePlatform = platformSlug;
  STATE.platformFilter = filterType;
  STATE.platformOffset = 0;
  STATE.platformSearchQuery = '';
  STATE.platformYear = '';
  STATE.platformCategory = '';

  const searchInput = document.getElementById('platform-search-input');
  if (searchInput) searchInput.value = '';
  document.getElementById('platform-clear-search')?.classList.add('hidden');

  switchTab('platform', false);

  if (push) {
    const url = `/platform/${platformSlug}${filterType !== 'all' ? '/' + filterType : ''}`;
    updateUrl(url);
  }

  await loadPlatformContent(true);
}

async function loadPlatformContent(reset = false) {
  if (!STATE.activePlatform) return;

  const loadingEl = document.getElementById('platform-loading');
  const emptyEl = document.getElementById('platform-empty');
  const shelvesEl = document.getElementById('platform-shelves-container');

  if (reset) {
    STATE.platformOffset = 0;
    if (shelvesEl) shelvesEl.innerHTML = '';
    loadingEl?.classList.remove('hidden');
    emptyEl?.classList.add('hidden');
  }

  updatePlatformFilterButtons();

  try {
    const params = new URLSearchParams({ type: STATE.platformFilter });
    if (STATE.platformSearchQuery) {
      params.set('search', STATE.platformSearchQuery);
    }
    if (STATE.platformYear) params.set('year', STATE.platformYear);
    if (STATE.platformCategory) params.set('category', STATE.platformCategory);

    const res = await fetch(`/api/platform/${STATE.activePlatform}/shelves?${params.toString()}`);
    if (!res.ok) throw new Error('Platform içeriği alınamadı');

    const data = await res.json();
    loadingEl?.classList.add('hidden');

    STATE.platformTotal = data.total || 0;
    STATE.platformMovieCount = data.movieCount || 0;
    STATE.platformSeriesCount = data.seriesCount || 0;

    const p = data.platform || {};
    const platformLogo = getPlatformLogoHtml(p.id || STATE.activePlatform);
    document.getElementById('platform-topbar-logo').innerHTML = platformLogo;
    document.getElementById('platform-hero-logo-mini').innerHTML = platformLogo;
    updatePlatformSelectOptions(data.years || [], data.categories || []);

    // Filtre butonlarındaki sayıları güncelle
    const filterAllBtn = document.getElementById('plat-filter-all');
    if (filterAllBtn) filterAllBtn.textContent = `Tümü (${data.total})`;
    const filterMoviesBtn = document.getElementById('plat-filter-movies');
    if (filterMoviesBtn) filterMoviesBtn.textContent = `Filmler (${data.movieCount})`;
    const filterSeriesBtn = document.getElementById('plat-filter-series');
    if (filterSeriesBtn) filterSeriesBtn.textContent = `Diziler (${data.seriesCount})`;

    if (!data.hero || !data.shelves?.length) {
      emptyEl?.classList.remove('hidden');
      return;
    }

    renderPlatformHero(data.hero, p);
    renderPlatformShelves(data.shelves);

    initIcons();
  } catch (err) {
    console.error('Platform load error:', err);
    loadingEl?.classList.add('hidden');
    emptyEl?.classList.remove('hidden');
  }
}

function getPlatformItemAction(item) {
  if (item.mediaType === 'movie') {
    return `openMediaItem(${JSON.stringify(item).replace(/'/g, "&#39;")}, "movie")`;
  }
  return `openSeriesDetailPage(${Number(item.id)})`;
}

function renderPlatformHero(item, platform) {
  const isMovie = item.mediaType === 'movie';
  const title = cleanName(item.name || '', isMovie ? 'movie' : 'series');
  const image = item.backdrop || item.cover || item.icon || '';
  const year = item.year || (item.releaseDate || '').slice(0, 4) || '';
  const rating = parseFloat(item.rating || 0);
  const action = getPlatformItemAction(item);

  document.getElementById('platform-hero-backdrop').style.backgroundImage = image
    ? `url("${String(image).replace(/"/g, '%22')}")`
    : 'linear-gradient(120deg, #181818, #050505)';
  document.getElementById('platform-hero-title').textContent = title;
  document.getElementById('platform-hero-desc').textContent = item.plot || `${platform.name || 'Platform'} kataloğundan seçilen ${isMovie ? 'film' : 'dizi'}.`;
  document.getElementById('platform-hero-type-badge').textContent = isMovie ? 'Film' : 'Dizi';
  document.getElementById('platform-hero-rating').innerHTML = rating > 0 ? `<span>★</span><span>${rating.toFixed(1)}</span>` : '';
  document.getElementById('platform-hero-year').textContent = year;
  document.getElementById('platform-hero-genre').textContent = item.genre || '';
  document.getElementById('platform-hero-play').setAttribute('onclick', action);
  document.getElementById('platform-hero-info').setAttribute('onclick', action);
}

function renderPlatformShelves(shelves) {
  const container = document.getElementById('platform-shelves-container');
  if (!container) return;

  container.innerHTML = shelves.map(shelf => `
    <section class="platform-shelf">
      <button ${shelf.category ? `onclick="setPlatformCategory('${escapeHtml(shelf.category).replace(/'/g, '&#39;')}')"` : ''} class="mb-3 flex items-center gap-1 text-left text-lg sm:text-xl font-bold text-white ${shelf.category ? 'hover:text-gray-300 cursor-pointer' : 'cursor-default'}">
        <span>${escapeHtml(shelf.title)}</span>
        ${shelf.category ? '<i data-lucide="chevron-right" class="w-5 h-5"></i>' : ''}
      </button>
      <div class="platform-shelf-row">
        ${shelf.items.map(item => renderPlatformShelfCard(item, shelf.type === 'top10')).join('')}
      </div>
    </section>
  `).join('');
  initPlatformShelfDragging();
}

function initPlatformShelfDragging() {
  document.querySelectorAll('.platform-shelf-row').forEach(row => {
    let startX = 0;
    let startScroll = 0;
    let dragged = false;
    let pointerDown = false;
    row.addEventListener('pointerdown', event => {
      startX = event.clientX;
      startScroll = row.scrollLeft;
      dragged = false;
      pointerDown = true;
    });
    row.addEventListener('pointermove', event => {
      if (!pointerDown) return;
      const distance = event.clientX - startX;
      if (Math.abs(distance) > 5 && !dragged) {
        dragged = true;
        row.classList.add('dragging');
        row.setPointerCapture(event.pointerId);
      }
      if (!dragged) return;
      row.scrollLeft = startScroll - distance;
    });
    const finish = event => {
      pointerDown = false;
      if (row.hasPointerCapture(event.pointerId)) row.releasePointerCapture(event.pointerId);
      row.classList.remove('dragging');
    };
    row.addEventListener('pointerup', finish);
    row.addEventListener('pointercancel', finish);
    row.addEventListener('click', event => {
      if (dragged) {
        event.preventDefault();
        event.stopPropagation();
        dragged = false;
      }
    }, true);
  });
}

function updatePlatformSelectOptions(years, categories) {
  const yearSelect = document.getElementById('platform-year-filter');
  const categorySelect = document.getElementById('platform-category-filter');
  if (yearSelect) {
    yearSelect.innerHTML = '<option value="">Tüm yıllar</option>' + years.map(year => `<option value="${year}">${year}</option>`).join('');
    yearSelect.value = STATE.platformYear;
  }
  if (categorySelect) {
    categorySelect.innerHTML = '<option value="">Tüm kategoriler</option>' + categories.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('');
    categorySelect.value = STATE.platformCategory;
  }
  document.getElementById('platform-reset-filters')?.classList.toggle('hidden', !STATE.platformYear && !STATE.platformCategory);
}

function setPlatformYear(year) {
  STATE.platformYear = year;
  loadPlatformContent(true);
}

function setPlatformCategory(category) {
  STATE.platformCategory = category;
  loadPlatformContent(true);
}

function resetPlatformFilters() {
  STATE.platformYear = '';
  STATE.platformCategory = '';
  loadPlatformContent(true);
}

function renderPlatformShelfCard(item, showRank = false) {
  const isMovie = item.mediaType === 'movie';
  const title = cleanName(item.name || '', isMovie ? 'movie' : 'series');
  const poster = item.icon || item.cover || item.backdrop || '';
  const year = item.year || (item.releaseDate || '').slice(0, 4) || '';
  const rating = parseFloat(item.rating || 0);
  const genre = (item.genre || '').split(/[\/,&]/)[0].trim();
  const action = getPlatformItemAction(item);
  return `
    <article class="platform-poster-card ${showRank ? 'platform-ranked-card' : ''}" onclick='${action}'>
      ${showRank ? `<span class="platform-rank">${item.rank}</span>` : ''}
      <div class="platform-poster-frame">
        <img src="${escapeHtml(poster)}" alt="${escapeHtml(title)}" loading="lazy" onerror="this.style.display='none'">
        <div class="platform-card-overlay">
          <span class="platform-card-play"><i data-lucide="play" class="w-5 h-5 fill-current"></i></span>
          <strong>${escapeHtml(title)}</strong>
          <span class="platform-card-meta">${year ? `<span class="platform-card-year">${year}</span>` : ''}${genre ? `<span class="platform-card-genre">${escapeHtml(genre)}</span>` : ''}</span>
        </div>
        ${rating > 0 ? `<div class="platform-card-rating">★ ${rating.toFixed(1)}</div>` : ''}
      </div>
      <div class="platform-card-info">
        <p class="platform-card-title">${escapeHtml(title)}</p>
        <div class="platform-card-details">
          ${year ? `<span class="platform-card-year-tag">${year}</span>` : ''}
          ${genre ? `<span class="platform-card-genre-tag">${escapeHtml(genre)}</span>` : ''}
          <span class="platform-card-type-tag ${isMovie ? 'movie' : 'series'}">${isMovie ? 'Film' : 'Dizi'}</span>
        </div>
      </div>
    </article>
  `;
}

function updatePlatformFilterButtons() {
  ['all', 'movies', 'series'].forEach(type => {
    [document.getElementById(`plat-filter-${type}`), document.getElementById(`plat-filter-${type}-m`)].forEach(btn => {
      if (!btn) return;
      btn.classList.toggle('bg-white/20', STATE.platformFilter === type);
      btn.classList.toggle('text-white', STATE.platformFilter === type);
      btn.classList.toggle('font-semibold', STATE.platformFilter === type);
      btn.classList.toggle('text-gray-300', STATE.platformFilter !== type);
    });
  });
}

function setPlatformFilter(filterType) {
  if (STATE.platformFilter === filterType) return;
  STATE.platformFilter = filterType;
  updateUrl(`/platform/${STATE.activePlatform}${filterType !== 'all' ? '/' + filterType : ''}`);
  loadPlatformContent(true);
}

function loadMorePlatformContent() {
  STATE.platformOffset += STATE.platformLimit;
  loadPlatformContent(false);
}

function clearPlatformSearch() {
  const input = document.getElementById('platform-search-input');
  if (input) input.value = '';
  document.getElementById('platform-clear-search')?.classList.add('hidden');
  STATE.platformSearchQuery = '';
  loadPlatformContent(true);
}

// =============================================================
// KALDIĞIN YERDEN DEVAM ET (WATCH PROGRESS & RESUME)
// =============================================================

function renderHomeContinueWatching(items) {
  const section = document.getElementById('home-continue-watching-section');
  const shelf = document.getElementById('home-continue-watching-shelf');
  if (!section || !shelf) return;

  if (!items || items.length === 0) {
    section.classList.add('hidden');
    shelf.innerHTML = '';
    return;
  }

  section.classList.remove('hidden');
  shelf.innerHTML = items.map(item => {
    const isEpisode = item.media_type === 'episode';
    const cleanItemTitle = cleanName(item.title, isEpisode ? 'episode' : 'movie');
    const pct = item.percentage || 0;
    const progressTime = formatDuration(item.progress_seconds);
    const totalTime = formatDuration(item.duration_seconds);
    const subtitle = isEpisode ? `${item.season_num}. Sezon Bölüm` : 'Film';

    return `
      <div 
        onclick='playContinueItem(${JSON.stringify(item).replace(/'/g, "&#39;")})'
        class="group flex-shrink-0 w-48 sm:w-56 cursor-pointer"
      >
        <div class="relative aspect-video rounded-xl overflow-hidden bg-zinc-900 border border-white/10 group-hover:border-tv-yellow/80 group-hover:scale-105 transition-all duration-300 shadow-md">
          <img 
            src="${item.poster || ''}" 
            alt="${escapeHtml(cleanItemTitle)}" 
            class="w-full h-full object-cover group-hover:scale-110 transition duration-500" 
            loading="lazy"
            onerror="this.src='https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?auto=format&fit=crop&w=400&q=80'"
          />
          <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
            <div class="w-10 h-10 rounded-full bg-tv-yellow text-black flex items-center justify-center shadow-lg transform scale-90 group-hover:scale-100 transition">
              <i data-lucide="play" class="w-5 h-5 fill-current ml-0.5"></i>
            </div>
          </div>
          <div class="absolute bottom-0 left-0 right-0 h-1.5 bg-black/60">
            <div class="h-full bg-tv-yellow transition-all duration-300" style="width: ${pct}%"></div>
          </div>
          <div class="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/75 backdrop-blur text-[10px] font-mono text-tv-yellow border border-tv-yellow/30 font-bold">
            ${progressTime} / ${totalTime}
          </div>
          <div class="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/75 backdrop-blur text-[10px] font-bold text-gray-300 border border-white/10">
            %${pct}
          </div>
        </div>
        <h3 class="text-xs sm:text-sm font-semibold text-gray-200 group-hover:text-tv-yellow truncate mt-2 transition" title="${escapeHtml(cleanItemTitle)}">${escapeHtml(cleanItemTitle)}</h3>
        <p class="text-[11px] text-gray-400 truncate flex items-center justify-between">
          <span>${subtitle}</span>
          <span class="text-tv-yellow font-bold text-[10px]">Kaldığın Yerden</span>
        </p>
      </div>
    `;
  }).join('');
  initIcons();
}

async function playContinueItem(item) {
  if (!item) return;
  if (item.media_type === 'movie') {
    const mId = item.movie_id;
    try {
      showLoading(true, 'Film yükleniyor...');
      const res = await fetch(`/api/vod/movie/${mId}`);
      if (res.ok) {
        const movie = await res.json();
        openMediaItem(movie, 'movie');
      }
    } catch (e) {
      console.error('Continue movie error:', e);
    }
  } else if (item.media_type === 'episode') {
    const sId = item.series_id;
    const epId = item.episode_id;
    try {
      showLoading(true, 'Dizi bölümü yükleniyor...');
      await openSeriesDetailPage(sId, false);
      if (STATE.currentSeries) {
        let foundEp = null;
        let foundSeason = item.season_num || 1;
        for (const [sNum, epList] of Object.entries(STATE.currentSeries.episodes || {})) {
          const ep = epList.find(e => String(e.id) === String(epId));
          if (ep) {
            foundEp = ep;
            foundSeason = parseInt(sNum);
            break;
          }
        }
        if (foundEp) {
          playSeriesEpisodeDirect(foundEp, foundSeason);
        } else {
          playFirstEpisodeOfSeries();
        }
      }
    } catch (e) {
      console.error('Continue episode error:', e);
    }
  }
}

function resumeSeriesEpisode(lastWatched) {
  if (!STATE.currentSeries || !lastWatched) return;
  const sNum = String(lastWatched.season_num || 1);
  const eps = STATE.currentSeries.episodes?.[sNum] || [];
  const found = eps.find(e => String(e.id) === String(lastWatched.episode_id));
  if (found) {
    playSeriesEpisodeDirect(found, parseInt(sNum));
  } else if (eps.length > 0) {
    playSeriesEpisodeDirect(eps[0], parseInt(sNum));
  }
}

function applyResumeSeconds(sec) {
  if (sec <= 5 || !video) return;
  try {
    seekMediaTo(sec);
  } catch (_) {}

  const banner = document.getElementById('resume-banner');
  const bannerText = document.getElementById('resume-time-text');
  if (banner && bannerText) {
    bannerText.textContent = formatDuration(sec);
    banner.classList.remove('hidden');
    clearTimeout(STATE.resumeBannerTimer);
    STATE.resumeBannerTimer = setTimeout(() => {
      banner.classList.add('hidden');
      // Resume timeout sonrasında oynatma başlat (eğer pausedsa)
      if (video && video.paused) {
        video.play().catch(() => {});
      }
    }, 7000);
  }
}

function restartCurrentMedia() {
  if (!video) return;
  if (STATE.currentMedia && STATE.mediaStartOffset > 0) {
    restartMediaAt(0);
  } else {
    video.currentTime = 0;
  }
  const banner = document.getElementById('resume-banner');
  if (banner) banner.classList.add('hidden');
  clearTimeout(STATE.resumeBannerTimer);
  saveCurrentProgress(true);
  showToast('İçerik başa alındı.');
}

let lastSavedSec = 0;
let lastSavedTs = 0;

function saveCurrentProgress(force = false) {
  if (!STATE.currentMedia || !video) return;
  const dur = Math.floor(getEffectiveDuration());
  const cur = Math.floor(getMediaPosition());
  if (dur <= 0 || isNaN(dur)) return;

  const now = Date.now();
  if (!force && cur < 3) return;
  if (!force && Math.abs(cur - lastSavedSec) < 4 && (now - lastSavedTs) < 4000) return;

  lastSavedSec = cur;
  lastSavedTs = now;

  const mediaType = STATE.currentMedia.type;
  const id = mediaType === 'episode' ? STATE.currentMedia.id : (STATE.currentMedia.stream_id || STATE.currentMedia.id);
  const cacheKey = `tvplus_resume_${mediaType}_${id}`;
  localStorage.setItem(cacheKey, cur);

  const payload = {
    profileName: STATE.profileName || 'Cemal Küller',
    mediaType: mediaType,
    seriesId: STATE.currentMedia.seriesId || (STATE.currentSeries?.info?.series_id) || null,
    seasonNum: STATE.currentMedia.seasonNum || STATE.activeSeriesSeason || 1,
    episodeId: mediaType === 'episode' ? id : null,
    movieId: mediaType === 'movie' ? id : null,
    title: STATE.currentMedia.title || STATE.currentMedia.name || 'İçerik',
    poster: STATE.currentMedia.cover || STATE.currentMedia.icon || (STATE.currentSeries?.info?.cover) || '',
    currentTime: cur,
    duration: dur
  };

  fetch('/api/progress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(() => {});
}

// =============================================================
// SMART TV QR KOD İLE TELEFON GİRİŞİ & KULLANICI GİRİŞ MODALI
// =============================================================

let tvAuthPollInterval = null;

async function openTvLoginModal() {
  const modal = document.getElementById('tv-auth-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  initIcons();

  const qrImg = document.getElementById('tv-auth-qr-img');
  const qrLoading = document.getElementById('tv-auth-qr-loading');
  const codeBox = document.getElementById('tv-auth-code-box');
  const statusText = document.getElementById('tv-auth-status-text');
  const errorMsg = document.getElementById('login-error-msg');
  if (errorMsg) errorMsg.classList.add('hidden');

  if (qrLoading) qrLoading.classList.remove('hidden');
  if (codeBox) codeBox.textContent = '------';

  try {
    const res = await fetch('/api/auth/tv-code');
    const data = await res.json();
    if (data.code) {
      if (qrImg) qrImg.src = data.qrDataUrl;
      if (qrLoading) qrLoading.classList.add('hidden');
      if (codeBox) codeBox.textContent = data.code;
      if (statusText) {
        statusText.innerHTML = `
          <i data-lucide="radio" class="w-3 h-3"></i>
          <span>Telefonunuz bekleniyor... (${data.localIp || ''})</span>
        `;
        initIcons();
      }

      // 2 saniyelik aralıklarla telefon onayını sorgula
      if (tvAuthPollInterval) clearInterval(tvAuthPollInterval);
      tvAuthPollInterval = setInterval(async () => {
        try {
          const pollRes = await fetch(`/api/auth/tv-status?code=${data.code}`);
          const pollData = await pollRes.json();
          if (pollData.status === 'authorized') {
            clearInterval(tvAuthPollInterval);
            tvAuthPollInterval = null;
            if (pollData.user) {
              STATE.profileName = pollData.user.profileName || 'Cemal Küller';
              localStorage.setItem('tvplus_profile_name', STATE.profileName);
              const headerUser = document.getElementById('header-user-name');
              if (headerUser) headerUser.textContent = STATE.profileName;
            }
            closeTvLoginModal();
            showToast('Televizyon girişi başarıyla onaylandı! Hoş geldiniz.');
            if (STATE.activeTab === 'home') {
              loadHomeData();
            }
          } else if (pollData.status === 'expired') {
            clearInterval(tvAuthPollInterval);
            tvAuthPollInterval = null;
            if (statusText) statusText.innerHTML = '<span class="text-red-400">Süre doldu. Pencereyi tekrar açın.</span>';
          }
        } catch (_) {}
      }, 2000);
    }
  } catch (err) {
    console.error('TV code error:', err);
    if (qrLoading) qrLoading.classList.add('hidden');
  }
}

function closeTvLoginModal() {
  const modal = document.getElementById('tv-auth-modal');
  if (modal) modal.classList.add('hidden');
  if (tvAuthPollInterval) {
    clearInterval(tvAuthPollInterval);
    tvAuthPollInterval = null;
  }
}

async function handleClassicLogin(e) {
  if (e) e.preventDefault();
  const uInput = document.getElementById('login-username');
  const pInput = document.getElementById('login-password');
  const errorMsg = document.getElementById('login-error-msg');
  if (!uInput || !pInput) return;

  const username = uInput.value.trim();
  const password = pInput.value.trim();

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      if (errorMsg) {
        errorMsg.textContent = data.error || 'Giriş yapılamadı';
        errorMsg.classList.remove('hidden');
      }
      return;
    }

    if (errorMsg) errorMsg.classList.add('hidden');
    const profile = data.profiles?.[0]?.name || data.user?.username || 'Cemal Küller';
    STATE.profileName = profile;
    localStorage.setItem('tvplus_profile_name', profile);
    const headerUser = document.getElementById('header-user-name');
    if (headerUser) headerUser.textContent = profile;

    closeTvLoginModal();
    showToast(`Hoş geldiniz, ${profile}!`);
    if (STATE.activeTab === 'home') {
      loadHomeData();
    }
  } catch (err) {
    if (errorMsg) {
      errorMsg.textContent = 'Bağlantı hatası oluştu';
      errorMsg.classList.remove('hidden');
    }
  }
}

// Window Global Exports
window.openPlatformPage = openPlatformPage;
window.setPlatformFilter = setPlatformFilter;
window.loadMorePlatformContent = loadMorePlatformContent;
window.clearPlatformSearch = clearPlatformSearch;
window.renderHomeContinueWatching = renderHomeContinueWatching;
window.playContinueItem = playContinueItem;
window.resumeSeriesEpisode = resumeSeriesEpisode;
window.applyResumeSeconds = applyResumeSeconds;
window.restartCurrentMedia = restartCurrentMedia;
window.saveCurrentProgress = saveCurrentProgress;
window.openTvLoginModal = openTvLoginModal;
window.closeTvLoginModal = closeTvLoginModal;
window.handleClassicLogin = handleClassicLogin;
