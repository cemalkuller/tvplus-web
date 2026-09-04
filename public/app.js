// =============================================================
// TURKCELL TV+ WEB APPLICATION LOGIC (1:1 UI/UX IMPLEMENTATION)
// =============================================================

const STATE = {
  activeTab: 'guide', // Default to Kanal Listesi as requested
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
  isMuted: localStorage.getItem('tvplus_muted') === 'true',
  profileName: localStorage.getItem('tvplus_profile_name') || 'Cemal Küller',
  hls: null,
  clockInterval: null,
  inactivityTimer: null,
  epgData: [],
  activeEpgDay: 'Bugün',
  switcherCategory: 'all',
  switcherSearch: '',
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
  currentMedia: null
};

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
  if (STATE.activeTab === 'live') {
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
  return '/kanal-listesi';
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

  // 2. Doğrudan Kanal İzleme Linki: /izle/:id
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
    // /izle/... rotasında değilsek ve oynatıcı açıksa kapat
    if (!playerModal.classList.contains('hidden')) {
      closePlayer(false);
    }
  }

  // 3. Canlı TV Rotası
  if (path === '/canli-tv' || path === '/live') {
    switchTab('live', false);
    return;
  }

  // 4. Filmler Rotası
  if (path === '/filmler' || path === '/movies' || path === '/film') {
    switchTab('movies', false);
    return;
  }

  // 5. Diziler Rotası
  if (path === '/diziler' || path === '/series' || path === '/dizi') {
    switchTab('series', false);
    return;
  }

  // 6. Favorilerim Rotası
  if (path === '/favorilerim' || path === '/favoriler') {
    showFavoritesTab(false);
    return;
  }

  // 7. Kanal Listesi Rotası
  if (path === '/kanal-listesi' || path === '/kanallar' || path === '/rehber' || path === '/' || path === '') {
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

    if (path === '/' || path === '') {
      updateUrl('/kanal-listesi', true);
    }
    return;
  }

  // Tanımlanmayan diğer tüm URL'lerde varsayılan: Kanal Listesi
  switchTab('guide', false);
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
// 2. TAB NAVİGASYONU (CANLI TV & KANAL LİSTESİ & FİLMLER & DİZİLER)
// =============================================================
function switchTab(tab, push = true) {
  STATE.activeTab = tab;
  const navLive = document.getElementById('nav-live');
  const navGuide = document.getElementById('nav-guide');
  const navMovies = document.getElementById('nav-movies');
  const navSeries = document.getElementById('nav-series');
  const navFavs = document.getElementById('nav-favs');
  const viewLive = document.getElementById('view-live');
  const viewGuide = document.getElementById('view-guide');
  const viewMovies = document.getElementById('view-movies');
  const viewSeries = document.getElementById('view-series');

  navLive?.classList.remove('text-white', 'font-bold');
  navGuide?.classList.remove('text-white', 'font-bold');
  navMovies?.classList.remove('text-white', 'font-bold');
  navSeries?.classList.remove('text-white', 'font-bold');
  navFavs?.classList.remove('text-white', 'font-bold');

  viewLive?.classList.add('hidden');
  viewGuide?.classList.add('hidden');
  viewMovies?.classList.add('hidden');
  viewSeries?.classList.add('hidden');

  if (tab === 'live') {
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

  // Yetişkin içerikleri filtrele ve temiz isimleri koy
  const validCats = STATE.categories.filter(c => !c.name.includes('XXX'));

  for (const cat of validCats) {
    const isActive = String(STATE.activeCategory) === String(cat.id);
    const label = cleanName(cat.name).replace(/TR\s*⭐\s*/g, '').replace(/VIP\s*⭐\s*/g, '').trim();
    html += `
      <button onclick="setGuideCategory('${cat.id}')" class="cat-tab ${isActive ? 'active' : ''}">
        ${escapeHtml(label)}
      </button>
    `;
  }

  strip.innerHTML = html;
}

function setGuideCategory(catId) {
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
    openPlayer(found);
  } else {
    fetch(`/api/streams?ids=${channelId}`)
      .then(r => r.json())
      .then(data => {
        if (data.streams && data.streams[0]) openPlayer(data.streams[0]);
      });
  }
}

function openPlayer(channel, push = true) {
  if (!channel) return;
  STATE.currentChannel = channel;
  addToRecents(channel.id);

  // Reveal dedicated player modal
  playerModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // Restore volume and unmute
  video.muted = STATE.isMuted;
  video.volume = STATE.volume;
  updateVolumeUI();

  const btnEpg = document.getElementById('btn-toggle-epg');
  const btnSw = document.getElementById('btn-toggle-switcher');
  if (btnEpg) btnEpg.style.display = 'flex';
  if (btnSw) btnSw.style.display = 'flex';

  const cleanedName = cleanName(channel.name);
  // Update metadata according to Image 5 & Image 1
  document.getElementById('player-channel-title').textContent = cleanedName;
  document.getElementById('player-program-title').textContent = `${cleanedName} Canlı Yayını`;
  document.getElementById('player-time-range').textContent = '20:00 - 22:30';

  // Live UI Controls (CANLI badge, clock, return to live)
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

  // Trigger inactivity timer (5 seconds)
  resetInactivity();
  initIcons();

  if (push) {
    updateUrl('/izle/' + channel.id);
  }
}

function openMediaItem(item, type = 'movie') {
  if (!item) return;
  STATE.currentMedia = { ...item, type };
  STATE.currentChannel = null;
  const sessionId = Date.now();
  STATE.playbackSession = sessionId;

  playerModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // Restore volume
  video.muted = STATE.isMuted;
  video.volume = STATE.volume;
  updateVolumeUI();

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
  const title = cleanName(item.name || item.title);
  if (type === 'episode') {
    // Dizi Bölümü
    if (btnEpisodes) btnEpisodes.classList.remove('hidden');
    document.getElementById('player-channel-title').textContent = cleanName(item.seriesTitle || 'Dizi');
    const epSubtitle = (item.seasonNum && item.episodeNum) 
      ? `${item.seasonNum}. Sezon ${item.episodeNum}. Bölüm • ${title}`
      : title;
    document.getElementById('player-program-title').textContent = epSubtitle;

    // Dizi detayları hafızada yoksa arkada yükle
    if (!STATE.currentSeries && item.seriesId) {
      fetch(`/api/series-info/${item.seriesId}`).then(r => r.json()).then(data => {
        STATE.currentSeries = data;
      }).catch(() => {});
    }
  } else {
    // Film
    if (btnEpisodes) btnEpisodes.classList.add('hidden');
    document.getElementById('player-episodes-tray')?.classList.add('hidden');
    document.getElementById('player-channel-title').textContent = title;
    document.getElementById('player-program-title').textContent = 'Film (VOD)';
  }

  document.getElementById('player-time-range').textContent = '00:00 / 00:00';

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

  video.src = item.streamUrl;
  video.load();
  const playPromise = video.play();
  if (playPromise !== undefined) {
    playPromise.then(() => {
      if (STATE.playbackSession !== sessionId || playerModal.classList.contains('hidden')) {
        video.pause();
        video.muted = true;
        video.volume = 0;
        video.removeAttribute('src');
        video.src = '';
      }
    }).catch(e => {
      if (playerModal.classList.contains('hidden')) return;
      if (e.name !== 'AbortError') {
        video.muted = true;
        STATE.isMuted = true;
        updateVolumeUI();
        video.play().catch(() => {});
      }
    });
  }

  resetInactivity();
  initIcons();
}

function closePlayer(push = true) {
  STATE.currentChannel = null;
  STATE.currentMedia = null;
  STATE.playbackSession = null;
  cancelNextEpisodeAutoplay();

  playerModal.classList.add('hidden');
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

  // 2. Video öğesini anında sustur, durdur ve boru hattını sıfırla
  try {
    video.muted = true;
    video.volume = 0;
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
    updateUrl(getCurrentTabUrl());
  }
}

function startPlayback(channel) {
  const sessionId = Date.now();
  STATE.playbackSession = sessionId;

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
      lowLatencyMode: true,
      manifestLoadingTimeOut: 8000,
      fragLoadingTimeOut: 8000,
      backBufferLength: 30
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
          if (e.name !== 'AbortError') {
            console.warn('Muted autoplay fallback...');
            video.muted = true;
            STATE.isMuted = true;
            updateVolumeUI();
            video.play().catch(() => {});
          }
        });
      }
    });

    hls.on(Hls.Events.ERROR, (event, data) => {
      if (STATE.playbackSession !== sessionId || playerModal.classList.contains('hidden')) return;
      console.warn('HLS Event Error:', data.type, data.details);
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
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

// Rewind / Forward 10 seconds (Görsel 5: ⟲ 10 and ⟳ 10)
function seekRelative(seconds) {
  if (video && !isNaN(video.currentTime)) {
    video.currentTime = Math.max(0, video.currentTime + seconds);
    showToast(`${Math.abs(seconds)} saniye ${seconds > 0 ? 'ileri' : 'geri'} alındı`);
  }
}

function handleScrubberClick(e) {
  const rect = e.currentTarget.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const ratio = Math.max(0, Math.min(1, clickX / rect.width));
  if (video.duration && !isNaN(video.duration)) {
    video.currentTime = video.duration * ratio;
  }
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
  // Volume restore
  video.volume = STATE.volume;
  video.muted = STATE.isMuted;
  updateVolumeUI();

  // Player Events
  video.addEventListener('waiting', () => showLoading(true, 'Yayın arabelleğe alınıyor...'));
  video.addEventListener('playing', () => {
    if (playerModal.classList.contains('hidden')) {
      video.pause();
      video.muted = true;
      video.volume = 0;
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
  });
  video.addEventListener('timeupdate', () => {
    if (playerModal.classList.contains('hidden')) {
      video.pause();
      video.muted = true;
      video.volume = 0;
      return;
    }
    if (video.duration && !isNaN(video.duration)) {
      const pct = (video.currentTime / video.duration) * 100;
      const fill = document.getElementById('player-progress-fill');
      if (fill) fill.style.width = `${pct}%`;

      if (STATE.currentMedia) {
        const cur = formatDuration(video.currentTime);
        const dur = formatDuration(video.duration);
        const timeRange = document.getElementById('player-time-range');
        if (timeRange) timeRange.textContent = `${cur} / ${dur}`;
      }
    }
  });

  // Otomatik Sonraki Bölüm Geçişi (Bölüm bittiğinde)
  video.addEventListener('ended', () => {
    if (STATE.currentMedia?.type === 'episode') {
      prepareAndShowNextEpisode();
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
      if (!channelDrawer.classList.contains('open') && !isTrayOpen && !isSwitcherOpen) {
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
  localStorage.setItem('tvplus_muted', STATE.isMuted);
  updateVolumeUI();
}

function setVolume(val) {
  video.volume = val;
  video.muted = (val === 0);
  STATE.volume = val;
  STATE.isMuted = video.muted;
  localStorage.setItem('tvplus_volume', val);
  localStorage.setItem('tvplus_muted', STATE.isMuted);
  updateVolumeUI();
}

function updateVolumeUI() {
  const volSlider = document.getElementById('player-vol-slider');
  const btnMute = document.getElementById('btn-player-mute');
  if (volSlider) volSlider.value = STATE.isMuted ? 0 : STATE.volume;

  let icon = 'volume-2';
  if (video.muted || video.volume === 0) {
    icon = 'volume-x';
  } else if (video.volume < 0.5) {
    icon = 'volume-1';
  }
  if (btnMute) {
    btnMute.innerHTML = `<i data-lucide="${icon}" class="w-5 h-5"></i>`;
    initIcons();
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

// Sansürlü BeIN isimlerini beIN olarak düzelt
function cleanName(str) {
  if (!str) return '';
  return String(str)
    .replace(/b\*{1,4}n/gi, 'beIN')
    .replace(/b\*{1,4}in/gi, 'beIN');
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
    html += `
      <button onclick="setMovieCategory('${cat.category_id}')" class="vod-cat-pill ${isActive ? 'active' : ''}">
        ${escapeHtml(cat.category_name)}
      </button>
    `;
  }
  strip.innerHTML = html;
}

function setMovieCategory(catId) {
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
    html += `
      <button onclick="setSeriesCategory('${cat.category_id}')" class="vod-cat-pill ${isActive ? 'active' : ''}">
        ${escapeHtml(cat.category_name)}
      </button>
    `;
  }
  strip.innerHTML = html;
}

function setSeriesCategory(catId) {
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
      <div class="media-card group" onclick="openSeriesModal(${item.id})">
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
// DİZİ DETAY & BÖLÜM SEÇİMİ
// -------------------------------------------------------------
async function openSeriesModal(seriesId) {
  const modal = document.getElementById('series-modal');
  if (!modal) return;

  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  const episodesContainer = document.getElementById('series-modal-episodes');
  episodesContainer.innerHTML = `
    <div class="col-span-full py-10 flex flex-col items-center justify-center space-y-2 text-gray-400">
      <div class="w-6 h-6 rounded-full border-2 border-white/20 border-t-tv-yellow animate-spin"></div>
      <span class="text-xs">Dizi ve bölümler yükleniyor...</span>
    </div>
  `;

  try {
    const res = await fetch(`/api/series-info/${seriesId}`);
    if (!res.ok) throw new Error('Dizi bilgisi alınamadı');
    const data = await res.json();
    STATE.currentSeries = data;

    const info = data.info || {};
    const title = cleanName(info.name || 'Dizi');
    document.getElementById('series-modal-title').textContent = title;
    document.getElementById('series-modal-plot').textContent = info.plot || 'Açıklama bulunmuyor.';
    document.getElementById('series-modal-cast').textContent = info.cast ? `Oyuncular: ${info.cast}` : '';
    document.getElementById('series-modal-genre').textContent = info.genre || 'Dizi';
    document.getElementById('series-modal-rating').textContent = info.rating ? `★ ${parseFloat(info.rating).toFixed(1)}` : '★ TV+';

    const backdrop = (info.backdrop_path && info.backdrop_path[0]) || info.cover || '';
    const backdropElem = document.getElementById('series-modal-backdrop');
    if (backdropElem && backdrop) {
      backdropElem.style.backgroundImage = `url('${backdrop}')`;
    }

    const posterElem = document.getElementById('series-modal-poster');
    if (posterElem && info.cover) {
      posterElem.src = info.cover;
    }

    // Render season tabs
    const seasonTabs = document.getElementById('series-modal-season-tabs');
    const seasons = data.seasons || [];
    const availableSeasons = Object.keys(data.episodes || {});

    let firstSeason = seasons[0]?.season_number || availableSeasons[0] || 1;
    STATE.activeSeriesSeason = firstSeason;

    let tabsHtml = '';
    if (seasons.length > 0) {
      for (const s of seasons) {
        const sNum = s.season_number;
        const isActive = String(sNum) === String(firstSeason);
        tabsHtml += `
          <button onclick="selectSeriesSeason(${sNum})" id="s-tab-${sNum}" class="vod-cat-pill ${isActive ? 'active' : ''}">
            ${s.name || `Sezon ${sNum}`}
          </button>
        `;
      }
    } else {
      for (const sNum of availableSeasons) {
        const isActive = String(sNum) === String(firstSeason);
        tabsHtml += `
          <button onclick="selectSeriesSeason(${sNum})" id="s-tab-${sNum}" class="vod-cat-pill ${isActive ? 'active' : ''}">
            Sezon ${sNum}
          </button>
        `;
      }
    }
    seasonTabs.innerHTML = tabsHtml;

    renderSeriesEpisodes(firstSeason);
    initIcons();
  } catch (err) {
    console.error('Series modal error:', err);
    episodesContainer.innerHTML = `
      <div class="col-span-full py-8 text-center text-gray-500 text-xs">
        Dizi detayları yüklenemedi.
      </div>
    `;
  }
}

function selectSeriesSeason(seasonNum) {
  STATE.activeSeriesSeason = seasonNum;
  const tabs = document.querySelectorAll('#series-modal-season-tabs button');
  tabs.forEach(t => t.classList.remove('active'));
  const activeTab = document.getElementById(`s-tab-${seasonNum}`);
  if (activeTab) activeTab.classList.add('active');

  renderSeriesEpisodes(seasonNum);
}

function renderSeriesEpisodes(seasonNum) {
  const container = document.getElementById('series-modal-episodes');
  const epCountElem = document.getElementById('series-modal-ep-count');
  if (!container || !STATE.currentSeries) return;

  const episodes = (STATE.currentSeries.episodes && STATE.currentSeries.episodes[String(seasonNum)]) || [];
  if (epCountElem) epCountElem.textContent = `${episodes.length} Bölüm`;

  if (episodes.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-8 text-center text-gray-400 text-xs">
        Bu sezona ait bölüm bulunamadı.
      </div>
    `;
    return;
  }

  const seriesTitle = STATE.currentSeries.info?.name || 'Dizi';

  let html = '';
  for (const ep of episodes) {
    const epTitle = cleanName(ep.title || `${ep.episode_num}. Bölüm`);
    const epThumb = ep.info?.movie_image || STATE.currentSeries.info?.cover || '';
    const duration = ep.info?.duration || (ep.info?.duration_secs ? `${Math.round(ep.info.duration_secs / 60)} dk` : '');

    const epPayload = {
      id: ep.id,
      title: epTitle,
      seriesTitle: seriesTitle,
      streamUrl: ep.streamUrl,
      seasonNum: parseInt(seasonNum) || 1,
      episodeNum: ep.episode_num || 1,
      cover: epThumb,
      seriesId: STATE.currentSeries?.info?.series_id
    };

    html += `
      <div class="bg-[#131926] border border-[#1E2738] hover:border-tv-yellow/70 rounded-xl p-3 flex flex-col justify-between space-y-2 cursor-pointer transition group" onclick='playSeriesEpisode(${JSON.stringify(epPayload).replace(/'/g, "&#39;")})'>
        <div class="relative w-full aspect-video rounded-lg overflow-hidden bg-black/60">
          <img src="${epThumb}" alt="${escapeHtml(epTitle)}" class="w-full h-full object-cover group-hover:scale-105 transition duration-300" onerror="this.src='https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?auto=format&fit=crop&w=400&q=80'">
          <div class="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
            <div class="w-10 h-10 rounded-full bg-tv-yellow text-black flex items-center justify-center shadow-lg">
              <i data-lucide="play" class="w-5 h-5 fill-current ml-0.5"></i>
            </div>
          </div>
          ${duration ? `<span class="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/80 text-[9px] font-mono text-gray-300">${duration}</span>` : ''}
        </div>
        <div>
          <div class="text-[10px] text-tv-yellow font-bold">${ep.episode_num || '1'}. Bölüm</div>
          <h4 class="text-xs font-bold text-white group-hover:text-tv-yellow transition line-clamp-1">${escapeHtml(epTitle)}</h4>
        </div>
      </div>
    `;
  }
  container.innerHTML = html;
  initIcons();
}

function closeSeriesModal() {
  const modal = document.getElementById('series-modal');
  modal?.classList.add('hidden');
  document.body.style.overflow = '';
}

function playSeriesEpisode(epPayload) {
  closeSeriesModal();
  openMediaItem(epPayload, 'episode');
}

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
  const seriesName = cleanName(series.info?.name || STATE.currentMedia?.seriesTitle || 'Dizi');
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
    const epTitle = cleanName(ep.title || `${ep.episode_num}. Bölüm`);
    const epThumb = ep.info?.movie_image || series.info?.cover || '';
    const duration = ep.info?.duration || (ep.info?.duration_secs ? `${Math.round(ep.info.duration_secs / 60)} dk` : '');

    cardsHtml += `
      <div class="episode-tray-card group ${isPlaying ? 'active' : ''}" onclick="playSeriesEpisodeDirect(${JSON.stringify(ep).replace(/'/g, '&#39;')}, ${activeSeason})">
        <div class="relative w-full aspect-video rounded-lg overflow-hidden bg-black flex-shrink-0">
          <img src="${epThumb}" alt="${escapeHtml(epTitle)}" class="w-full h-full object-cover group-hover:scale-105 transition duration-300" onerror="this.src='https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?auto=format&fit=crop&w=400&q=80'">
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
          <div class="text-[10px] text-tv-yellow font-bold">${ep.episode_num || '1'}. Bölüm</div>
          <h4 class="text-xs font-bold text-white group-hover:text-tv-yellow transition truncate">${escapeHtml(epTitle)}</h4>
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
  const epTitle = cleanName(ep.title || `${ep.episode_num}. Bölüm`);
  const seriesTitle = STATE.currentSeries?.info?.name || ep.seriesTitle || 'Dizi';
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

async function saveSettings() {
  const host = document.getElementById('settings-host-input')?.value.trim();
  const username = document.getElementById('settings-username-input')?.value.trim();
  const password = document.getElementById('settings-password-input')?.value.trim();

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
      body: JSON.stringify({ host, username, password })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Ayarlar kaydedilemedi.');
    }

    if (succText) succText.textContent = data.message || 'Ayarlar .env dosyasına kaydedildi ve kanallar yenilendi!';
    succBadge?.classList.remove('hidden');
    showToast('Ayarlar .env dosyasına başarıyla kaydedildi!');

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
