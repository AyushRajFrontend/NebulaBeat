/* ══════════════════════════════════════════
   NEBULABEAT — SPOTIFY UTILS
   Logging · Toast queue · PKCE helpers · Backoff · Fetch timeout
   ══════════════════════════════════════════ */
(function () {
  'use strict';

  window.NebulaSpotify = window.NebulaSpotify || {};

  /* ════════════════════════════════════
     LOGGING
  ════════════════════════════════════ */
  let DEBUG = true;

  function tag(scope) { return '[Spotify' + (scope ? ':' + scope : '') + ']'; }
  function log(scope, msg, data) {
    if (!DEBUG) return;
    data !== undefined ? console.log(tag(scope), msg, data) : console.log(tag(scope), msg);
  }
  function warn(scope, msg, data) {
    if (!DEBUG) return;
    data !== undefined ? console.warn(tag(scope), msg, data) : console.warn(tag(scope), msg);
  }
  function logError(scope, msg, data) {
    if (!DEBUG) return;
    data !== undefined ? console.error(tag(scope), msg, data) : console.error(tag(scope), msg);
  }

  /* ════════════════════════════════════
     TOAST — sequential queue, 5 types
  ════════════════════════════════════ */
  const TOAST_DURATIONS = { success: 3000, warning: 4000, error: 4500, info: 3000, loading: 0 };
  let toastQueue     = [];
  let toastActive    = false;
  let toastEl        = null;
  let toastContainer = null;

  function ensureContainer() {
    if (toastContainer && document.body.contains(toastContainer)) return toastContainer;
    toastContainer = document.createElement('div');
    toastContainer.className = 'sp-toast-container';
    document.body.appendChild(toastContainer);
    return toastContainer;
  }

  function renderToast(entry) {
    const container = ensureContainer();
    const el = document.createElement('div');
    el.className = 'sp-toast sp-toast-' + entry.type;
    if (entry.id) el.dataset.toastId = entry.id;

    if (entry.type === 'loading') {
      const spinner = document.createElement('span');
      spinner.className = 'sp-toast-spinner';
      el.appendChild(spinner);
    }
    const text = document.createElement('span'); 
    text.textContent = entry.msg;
    el.appendChild(text);

    container.appendChild(el);
    requestAnimationFrame(() => el.classList.add('sp-toast-show'));
    return el;
  }

  function showNext() {
    if (!toastQueue.length) { toastActive = false; return; }
    const entry = toastQueue.shift();
    const el = renderToast(entry);
    toastEl = el;

    const finish = () => {
      clearTimeout(el._timer);
      el.classList.remove('sp-toast-show');
      setTimeout(() => {
        el.remove();
        if (toastEl === el) toastEl = null;
        showNext();
      }, 350); 
    };
    el._finish = finish;

    if (entry.duration > 0) el._timer = setTimeout(finish, entry.duration);
  }

  function toast(msg, type, opts) {
    type = type || 'success';
    opts = opts || {};
    const entry = {
      msg, type,
      id: opts.id || null,
      duration: opts.duration != null ? opts.duration : (TOAST_DURATIONS[type] != null ? TOAST_DURATIONS[type] : 3000)
    };
    toastQueue.push(entry);
    if (!toastActive) { toastActive = true; showNext(); }
    return entry.id;
  }

  function dismissToast(id) {
    if (!id) return;
    toastQueue = toastQueue.filter(t => t.id !== id);
    if (toastEl && toastEl.dataset.toastId === id) toastEl._finish();
  }

  /* ════════════════════════════════════
     CLIPBOARD + HTML ESCAPING
  ════════════════════════════════════ */
  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }
  function copyToClipboard(text) {
    return new Promise((resolve) => {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(() => resolve(true)).catch(() => { fallbackCopy(text); resolve(true); });
      } else {
        fallbackCopy(text); resolve(true);
      }
    });
  }
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
  }

  function itemSubtitle(type, item) {
    if (type === 'track')    return item.artists.map(a => a.name).join(', ');
    if (type === 'album')    return item.artists.map(a => a.name).join(', ');
    if (type === 'artist')   return (item.genres && item.genres[0]) || 'Artist';
    if (type === 'playlist') return `By ${item.owner?.display_name || 'Spotify'} · ${item.tracks?.total ?? 0} tracks`;
    return '';
  }
  function itemArt(type, item) {
    const images = type === 'track' ? item.album?.images : item.images;
    return (images && (images[2] || images[0]))?.url || '';
  }

  /* ════════════════════════════════════
     PANEL REGISTRY
  ════════════════════════════════════ */
  let panelRegistry  = [];
  let panelTabsBound = false;

  function bindPanelTabs() {
    if (panelTabsBound) return;
    panelTabsBound = true;
    document.querySelectorAll('.sp-panel-tab').forEach(tab => {
      tab.addEventListener('click', () => activatePanel(tab.dataset.tab));
    });
  }
  function registerPanel(tabKey, sectionId, onActivate) {
    panelRegistry.push({ tabKey, sectionId, onActivate });
    bindPanelTabs();
  }
  function activatePanel(tabKey) {
    panelRegistry.forEach(p => {
      const el = document.getElementById(p.sectionId);
      if (el) el.style.display = p.tabKey === tabKey ? 'flex' : 'none';
    });
    document.querySelectorAll('.sp-panel-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabKey));
    const active = panelRegistry.find(p => p.tabKey === tabKey);
    if (active && active.onActivate) active.onActivate();
  }
  function hideAllPanels() {
    panelRegistry.forEach(p => {
      const el = document.getElementById(p.sectionId);
      if (el) el.style.display = 'none';
    });
  }

  /* ════════════════════════════════════
     PKCE HELPERS
  ════════════════════════════════════ */
  async function sha256(plain) {
    const enc = new TextEncoder().encode(plain);
    return crypto.subtle.digest('SHA-256', enc);
  }
  function base64url(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }
  async function generatePKCE() {
    const verifier  = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = base64url(await sha256(verifier));
    return { verifier, challenge };
  }

  /* ════════════════════════════════════
     RECONNECT BACKOFF — 1s, 2s, 4s, 8s, capped
  ════════════════════════════════════ */
  function backoffDelay(attempt, opts) {
    opts = opts || {};
    const base = opts.baseMs || 1000;
    const max  = opts.maxMs  || 8000;
    return Math.min(base * Math.pow(2, attempt), max);
  }

  /* ════════════════════════════════════
     FETCH WITH TIMEOUT — AbortController-based
  ════════════════════════════════════ */
  async function fetchWithTimeout(url, options, timeoutMs) {
    options   = options || {};
    timeoutMs = timeoutMs || 10000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
      if (err.name === 'AbortError') {
        const timeoutErr = new Error('Request timed out');
        timeoutErr.isTimeout = true;
        throw timeoutErr;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /* ════════════════════════════════════
     EXPORT
  ════════════════════════════════════ */
  window.NebulaSpotify.Utils = {
    log, warn, error: logError,
    toast, dismissToast,
    copyToClipboard, escapeHtml,
    itemSubtitle, itemArt,
    registerPanel, activatePanel, hideAllPanels,
    generatePKCE,
    backoffDelay,
    fetchWithTimeout,
    setDebug: (v) => { DEBUG = !!v; }
  };
})();