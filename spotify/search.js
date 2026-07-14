/* ══════════════════════════════════════════
   NEBULABEAT — SPOTIFY PREMIUM SEARCH/  ══════════════════════════════════════════ */
(function () {
  'use strict';

  window.NebulaSpotify = window.NebulaSpotify || {};
  const Utils = window.NebulaSpotify.Utils;

  const DEBOUNCE_MS   = 350;
  const HISTORY_KEY   = 'nebula_spotify_search_history';
  const MAX_HISTORY   = 8;
  const RESULTS_LIMIT = 8;

  const STATE = {
    query: '',
    activeType: 'all', // 'all' | 'track' | 'artist' | 'album' | 'playlist'
    results: { tracks: [], artists: [], albums: [], playlists: [] },
    history: [],
    selectedIndex: -1
  };

  let el = {};
  let debounceTimer = null;
  let searchSeq = 0; 

  /* ════════════════════════════════════
     HISTORY — localStorage; UI preference data, not sensitive
  ════════════════════════════════════ */
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveHistory() {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(STATE.history.slice(0, MAX_HISTORY))); }
    catch (e) {}
  }
  function addToHistory(query) {
    const q = query.trim();
    if (!q) return;
    STATE.history = [q, ...STATE.history.filter(h => h.toLowerCase() !== q.toLowerCase())].slice(0, MAX_HISTORY);
    saveHistory();
  }
  function clearHistory() { STATE.history = []; saveHistory(); renderHistory(); }

  /* ════════════════════════════════════
     ITEM SHAPE HELPERS — track/artist/album/playlist each look different
  ════════════════════════════════════ */
  function flattenForType(type) {
    const R = STATE.results;
    if (type === 'track')    return R.tracks.map(t => ({ type: 'track', item: t }));
    if (type === 'artist')   return R.artists.map(a => ({ type: 'artist', item: a }));
    if (type === 'album')    return R.albums.map(a => ({ type: 'album', item: a }));
    if (type === 'playlist') return R.playlists.map(p => ({ type: 'playlist', item: p }));
    
    return [
      ...R.tracks.slice(0, 4).map(t => ({ type: 'track', item: t })),
      ...R.artists.slice(0, 2).map(a => ({ type: 'artist', item: a })),
      ...R.albums.slice(0, 2).map(a => ({ type: 'album', item: a })),
      ...R.playlists.slice(0, 2).map(p => ({ type: 'playlist', item: p }))
    ];
  }

  /* ════════════════════════════════════
     SEARCH — debounced, race-guarded
  ════════════════════════════════════ */
  function onInput(query) {
    STATE.query = query;
    searchSeq++;
    
    clearTimeout(debounceTimer);

    if (!query.trim()) {
      STATE.results = { tracks: [], artists: [], albums: [], playlists: [] };
      renderHistory();
      return;
    }
    showSkeleton();
    const mySeq = searchSeq;
    debounceTimer = setTimeout(() => runSearch(query, mySeq), DEBOUNCE_MS);
  }


  function searchNow(query) {
    clearTimeout(debounceTimer);
    searchSeq++;
    STATE.query = query;
    showSkeleton();
    runSearch(query, searchSeq);
  }

  async function runSearch(query, seq) {
    const API = window.NebulaSpotify.API;
    const r = await API.get(`/search?q=${encodeURIComponent(query)}&type=track,artist,album,playlist&limit=${RESULTS_LIMIT}`);

    if (seq !== searchSeq) return; 

    if (!r.ok) {
      Utils.error('Search', 'Search failed', r.error);
      renderNoResults('Search failed — try again.');
      return;
    }
    STATE.results = {
      tracks:    r.data?.tracks?.items    || [],
      artists:   r.data?.artists?.items   || [],
      albums:    r.data?.albums?.items    || [],
      playlists: r.data?.playlists?.items || []
    };
    STATE.selectedIndex = -1;
    addToHistory(query);
    renderResults();
  }

  /* ════════════════════════════════════
     RENDER
  ════════════════════════════════════ */
  function showSkeleton() {
    if (!el.results) return;
    el.results.innerHTML = Array.from({ length: 4 }).map(() =>
      `<div class="spsr-skeleton"><div class="spsr-skeleton-art"></div><div class="spsr-skeleton-lines"><div></div><div></div></div></div>`
    ).join('');
  }

  function highlightMatch(text, query) {
    if (!query) return Utils.escapeHtml(text);
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return Utils.escapeHtml(text);
    return Utils.escapeHtml(text.slice(0, idx))
      + '<mark class="spsr-highlight">' + Utils.escapeHtml(text.slice(idx, idx + query.length)) + '</mark>'
      + Utils.escapeHtml(text.slice(idx + query.length));
  }

  function renderResults() {
    if (!el.results) return;
    const flat = flattenForType(STATE.activeType);
    if (!flat.length) { renderNoResults(); return; }

    el.results.innerHTML = flat.map((entry, i) => {
      const showTag = STATE.activeType === 'all';
      return `
        <div class="spsr-row${i === STATE.selectedIndex ? ' spsr-selected' : ''}" data-index="${i}" style="animation-delay:${i * 30}ms">
          <img class="spsr-art spsr-art-${entry.type}" src="${Utils.itemArt(entry.type, entry.item)}" alt="">
          <div class="spsr-row-info">
            <div class="spsr-row-name">${highlightMatch(entry.item.name, STATE.query)}</div>
            <div class="spsr-row-sub">${Utils.escapeHtml(Utils.itemSubtitle(entry.type, entry.item))}</div>
          </div>
          ${entry.type === 'track' ? `<button class="spsr-queue-btn" data-queue-index="${i}" aria-label="Add to queue">➕</button>` : ''}
          ${showTag ? `<span class="spsr-type-tag">${entry.type}</span>` : ''}
        </div>`;
    }).join('');

    el.results.querySelectorAll('.spsr-row').forEach(row => {
      row.addEventListener('click', () => selectResult(Number(row.dataset.index)));
    });
    el.results.querySelectorAll('.spsr-queue-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const entry = flattenForType(STATE.activeType)[Number(btn.dataset.queueIndex)];
        if (entry) { window.NebulaSpotify.Queue?.addTrack(entry.item); Utils.toast('Added to queue', 'success', { duration: 1500 }); }
      });
    });
  }

  function renderNoResults(message) {
    if (!el.results) return;
    el.results.innerHTML = `<div class="spsr-no-results"><div class="spsr-no-results-icon">🔭</div><div>${Utils.escapeHtml(message || `No results for "${STATE.query}"`)}</div></div>`;
  }

  function renderHistory() {
    if (!el.results) return;
    if (!STATE.history.length) { el.results.innerHTML = ''; return; }
    el.results.innerHTML = `
      <div class="spsr-history-header"><span>Recent searches</span><button class="spsr-clear-history" id="spsrClearHistory">Clear</button></div>
      ${STATE.history.map(h => `<div class="spsr-history-item" data-q="${Utils.escapeHtml(h)}">🕐 ${Utils.escapeHtml(h)}</div>`).join('')}
    `;
    el.results.querySelectorAll('.spsr-history-item').forEach(item => {
      item.addEventListener('click', () => {
        const q = item.dataset.q;
        if (el.input) el.input.value = q;
        searchNow(q);
      });
    });
    document.getElementById('spsrClearHistory')?.addEventListener('click', clearHistory);
  }

  /* ════════════════════════════════════
     SELECTION
  ════════════════════════════════════ */
  function selectResult(index) {
    const entry = flattenForType(STATE.activeType)[index];
    if (entry) window.NebulaSpotify.Playback.playSelection(entry.type, entry.item);
  }

  /* ════════════════════════════════════
     KEYBOARD NAVIGATION
  ════════════════════════════════════ */
  function bindKeyboard() {
    el.input?.addEventListener('keydown', (e) => {
      const flat = flattenForType(STATE.activeType);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        STATE.selectedIndex = Math.min(STATE.selectedIndex + 1, flat.length - 1);
        renderResults(); scrollSelectedIntoView();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        STATE.selectedIndex = Math.max(STATE.selectedIndex - 1, -1);
        renderResults(); scrollSelectedIntoView();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (STATE.selectedIndex >= 0 && flat[STATE.selectedIndex]) {
          selectResult(STATE.selectedIndex);
        } else if (STATE.query.trim()) {
          searchNow(STATE.query);
        }
      } else if (e.key === 'Escape') {
        el.input.blur();
      }
    });
  }
  function scrollSelectedIntoView() {
    el.results?.querySelector('.spsr-selected')?.scrollIntoView({ block: 'nearest' });
  }

  /* ════════════════════════════════════
     TYPE TABS
  ════════════════════════════════════ */
  function bindTypeTabs() {
    el.tabs?.querySelectorAll('.spsr-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        STATE.activeType = tab.dataset.type;
        el.tabs.querySelectorAll('.spsr-tab').forEach(t => t.classList.toggle('active', t === tab));
        STATE.selectedIndex = -1;
        if (STATE.query.trim()) renderResults();
      });
    });
  }

  /* ════════════════════════════════════
     INIT
  ════════════════════════════════════ */
  function init() {
    el = {
      wrap:    document.getElementById('spSearchWrap'),
      input:   document.getElementById('spSearchInput'),
      btn:     document.getElementById('spSearchBtn'),
      results: document.getElementById('spResults'),
      tabs:    document.getElementById('spsrTabs')
    };
    STATE.history = loadHistory();

    el.input?.addEventListener('input', () => onInput(el.input.value));
    el.input?.addEventListener('focus', () => { if (!STATE.query.trim()) renderHistory(); });
    el.btn?.addEventListener('click', () => {
      if (STATE.query.trim()) searchNow(STATE.query);
    });
    bindKeyboard();
    bindTypeTabs();
    window.NebulaSpotify.Utils.registerPanel('search', 'spSearchWrap', null);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.NebulaSpotify.Search = {
    clearHistory,
    getHistory: () => STATE.history.slice()
  };
})();