/* ══════════════════════════════════════════
   NEBULABEAT — SPOTIFY LIBRARY
   Liked Songs · Recently Played · Saved Albums · Saved Artists ·
   Top Artists · Top Tracks · Featured Playlists · Your Playlists
   ══════════════════════════════════════════ */
(function () {
  'use strict';

  window.NebulaSpotify = window.NebulaSpotify || {};
  const Utils = window.NebulaSpotify.Utils;

  const CATEGORIES = {
    liked:      { label: 'Liked Songs',        endpoint: '/me/tracks?limit=20',                 type: 'track',    get: d => d.items.map(i => i.track), next: d => d.next },
    recent:     { label: 'Recently Played',    endpoint: '/me/player/recently-played?limit=20', type: 'track',    get: d => d.items.map(i => i.track), next: d => d.next },
    albums:     { label: 'Saved Albums',       endpoint: '/me/albums?limit=20',                 type: 'album',    get: d => d.items.map(i => i.album), next: d => d.next },
    artists:    { label: 'Followed Artists',   endpoint: '/me/following?type=artist&limit=20',  type: 'artist',   get: d => d.artists.items,           next: d => d.artists.next },
    topArtists: { label: 'Top Artists',        endpoint: '/me/top/artists?limit=20',            type: 'artist',   get: d => d.items,                   next: d => d.next },
    topTracks:  { label: 'Top Tracks',         endpoint: '/me/top/tracks?limit=20',             type: 'track',    get: d => d.items,                   next: d => d.next },
    featured:   { label: 'Featured Playlists', endpoint: '/browse/featured-playlists?limit=20', type: 'playlist', get: d => d.playlists.items,         next: d => d.playlists.next },
    playlists:  { label: 'Your Playlists',     endpoint: '/me/playlists?limit=20',              type: 'playlist', get: d => d.items,                   next: d => d.next }
  };
  const CATEGORY_ORDER = ['liked', 'recent', 'playlists', 'albums', 'artists', 'topTracks', 'topArtists', 'featured'];

  const STATE = {
    activeCategory: 'liked',
    items: {},     
    nextUrl: {},   
    loading: {}, 
    loadedOnce: {}, 
    sortBy: 'default', 
    filterQuery: ''
  };

  let el = {};
  let observer = null;

  /* ════════════════════════════════════
     FETCH
  ════════════════════════════════════ */
  async function loadMore(catKey) {
    if (STATE.loading[catKey]) return;
    if (STATE.loadedOnce[catKey] && !STATE.nextUrl[catKey]) return; 

    const cat = CATEGORIES[catKey];
    const url = STATE.loadedOnce[catKey] ? STATE.nextUrl[catKey] : cat.endpoint;

    STATE.loading[catKey] = true;
    if (catKey === STATE.activeCategory) renderLoading(true);

    const API = window.NebulaSpotify.API;
    const r = await API.get(url);

    STATE.loading[catKey] = false;
    STATE.loadedOnce[catKey] = true;
    if (catKey === STATE.activeCategory) renderLoading(false);

    if (!r.ok) {
      Utils.error('Library', 'Load failed: ' + catKey, r.error);
      if (catKey === STATE.activeCategory) Utils.toast('Couldn\'t load your library.', 'warning');
      return;
    }

    const newItems = (cat.get(r.data) || []).filter(Boolean); 
    STATE.items[catKey] = (STATE.items[catKey] || []).concat(newItems);
    STATE.nextUrl[catKey] = cat.next(r.data) || null;

    if (catKey === STATE.activeCategory) renderItems();
  }

  /* ════════════════════════════════════
     INFINITE SCROLL
  ════════════════════════════════════ */
  function setupInfiniteScroll() {
    if (observer) observer.disconnect();
    if (!el.sentinel || !('IntersectionObserver' in window)) return;
    observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) loadMore(STATE.activeCategory);
    }, { rootMargin: '200px' });
    observer.observe(el.sentinel);
  }

  /* ════════════════════════════════════
     SORT / FILTER
  ════════════════════════════════════ */
  function getVisibleItems() {
    let items = STATE.items[STATE.activeCategory] || [];
    if (STATE.filterQuery.trim()) {
      const q = STATE.filterQuery.toLowerCase();
      items = items.filter(it => it.name && it.name.toLowerCase().includes(q));
    }
    if (STATE.sortBy === 'name') {
      items = [...items].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }
    return items; 
  }

  /* ════════════════════════════════════
     RENDER
  ════════════════════════════════════ */
  function renderLoading(isLoading) {
    if (el.loading) el.loading.style.display = isLoading ? 'flex' : 'none';
  }

  function renderItems() {
    if (!el.list) return;
    const cat = CATEGORIES[STATE.activeCategory];
    const items = getVisibleItems();

    if (!items.length) {
      el.list.innerHTML = STATE.loading[STATE.activeCategory]
        ? ''
        : `<div class="splib-empty">${STATE.filterQuery ? 'No matches.' : 'Nothing here yet.'}</div>`;
      return;
    }

    el.list.innerHTML = items.map((item, i) => `
      <div class="splib-row" data-index="${i}">
        <img class="splib-art splib-art-${cat.type}" src="${Utils.itemArt(cat.type, item)}" alt="">
        <div class="splib-row-info">
          <div class="splib-row-name">${Utils.escapeHtml(item.name || '')}</div>
          <div class="splib-row-sub">${Utils.escapeHtml(Utils.itemSubtitle(cat.type, item))}</div>
        </div>
      </div>
    `).join('');

    el.list.querySelectorAll('.splib-row').forEach(row => {
      row.addEventListener('click', () => {
        const item = items[Number(row.dataset.index)];
        if (item) window.NebulaSpotify.Playback.playSelection(cat.type, item);
      });
    });
  }

  function renderCategoryTabs() {
    if (!el.categoryTabs) return;
    el.categoryTabs.innerHTML = CATEGORY_ORDER.map(key =>
      `<button class="splib-cat-tab${key === STATE.activeCategory ? ' active' : ''}" data-cat="${key}">${CATEGORIES[key].label}</button>`
    ).join('');
    el.categoryTabs.querySelectorAll('.splib-cat-tab').forEach(tab => {
      tab.addEventListener('click', () => switchCategory(tab.dataset.cat));
    });
  }

  /* ════════════════════════════════════
     CATEGORY SWITCHING
  ════════════════════════════════════ */
  function switchCategory(key) {
    if (!CATEGORIES[key] || key === STATE.activeCategory) return;
    STATE.activeCategory = key;
    STATE.filterQuery = '';
    if (el.filterInput) el.filterInput.value = '';
    renderCategoryTabs();
    renderItems();
    if (!STATE.loadedOnce[key]) loadMore(key);
  }

  /* ════════════════════════════════════
     PANEL REGISTRATION
  ════════════════════════════════════ */
  function onActivate() {
    if (!STATE.loadedOnce[STATE.activeCategory]) loadMore(STATE.activeCategory);
  }

  /* ════════════════════════════════════
     INIT
  ════════════════════════════════════ */
  function init() {
    el = {
      section:      document.getElementById('splibSection'),
      categoryTabs: document.getElementById('splibCategoryTabs'),
      filterInput:  document.getElementById('splibFilterInput'),
      sortSelect:   document.getElementById('splibSortSelect'),
      list:         document.getElementById('splibList'),
      sentinel:     document.getElementById('splibSentinel'),
      loading:      document.getElementById('splibLoading')
    };

    renderCategoryTabs();
    setupInfiniteScroll();

    el.filterInput?.addEventListener('input', () => {
      STATE.filterQuery = el.filterInput.value;
      renderItems();
    });
    el.sortSelect?.addEventListener('change', () => {
      STATE.sortBy = el.sortSelect.value;
      renderItems();
    });

    window.NebulaSpotify.Utils.registerPanel('library', 'splibSection', onActivate);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.NebulaSpotify.Library = {
    switchCategory,
    getActiveCategory: () => STATE.activeCategory
  };
})();