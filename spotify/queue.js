/* ══════════════════════════════════════════
   NEBULABEAT — QUEUE  ══════════════════════════════════════════ */
(function () {
  'use strict';

  window.NebulaSpotify = window.NebulaSpotify || {};
  const Utils = window.NebulaSpotify.Utils;

  const MAX_HISTORY = 20;

  const STATE = {
    queue: [],          
    history: [],        
    current: null,      
    autoAdvance: true,   
    lastTrackId: null,
    lastWasPlaying: false
  };

  let el = {};
  let listeners = [];

  function onChange(cb) { listeners.push(cb); }
  function emitChange() { listeners.forEach(cb => { try { cb(); } catch (e) {} }); }

  /* ════════════════════════════════════
     QUEUE MUTATION — add / remove / reorder
  ════════════════════════════════════ */
  function addTrack(track) {
    if (!track || !track.uri) return;
    STATE.queue.push({
      id: track.id, uri: track.uri, name: track.name,
      artists: (track.artists || []).map(a => a.name).join(', '),
      album: track.album?.name || '',
      art: Utils.itemArt('track', track),
      duration_ms: track.duration_ms || 0
    });
    emitChange();
    render();
  }

  function removeAt(index) {
    if (index < 0 || index >= STATE.queue.length) return;
    STATE.queue.splice(index, 1);
    emitChange();
    render();
  }

  function reorder(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= STATE.queue.length) return;
    toIndex = Math.max(0, Math.min(STATE.queue.length - 1, toIndex));
    const [item] = STATE.queue.splice(fromIndex, 1);
    STATE.queue.splice(toIndex, 0, item);
    emitChange();
    render();
  }

  function clear() {
    STATE.queue = [];
    emitChange();
    render();
  }

  /* ════════════════════════════════════
     CLICK TO PLAY
  ════════════════════════════════════ */
  function playAt(index) {
    const item = STATE.queue[index];
    if (!item) return;
    window.NebulaSpotify.playTrack?.(item.uri);
    STATE.queue.splice(index, 1);
    STATE.history.unshift(item);
    if (STATE.history.length > MAX_HISTORY) STATE.history.length = MAX_HISTORY;
    emitChange();
    render();
  }

  /* ════════════════════════════════════
     AUTO-ADVANCE
  ════════════════════════════════════ */
  function handlePlaybackState(state) {
    if (!state || !state.track_window) return;
    const track = state.track_window.current_track;
    const trackId = track?.id || null;

    const sameTrackJustStopped = STATE.lastTrackId === trackId && STATE.lastWasPlaying && state.paused && state.position < 1500;

    STATE.current = track;

    if (sameTrackJustStopped && STATE.autoAdvance && STATE.queue.length > 0) {
      const next = STATE.queue.shift();
      STATE.history.unshift({ ...next, playedAt: Date.now() });
      if (STATE.history.length > MAX_HISTORY) STATE.history.length = MAX_HISTORY;
      window.NebulaSpotify.playTrack?.(next.uri);
    } else if (trackId && STATE.queue[0] && STATE.queue[0].uri && STATE.queue[0].uri.endsWith(trackId)) {
      
      const next = STATE.queue.shift();
      STATE.history.unshift({ ...next, playedAt: Date.now() });
      if (STATE.history.length > MAX_HISTORY) STATE.history.length = MAX_HISTORY;
    }

    STATE.lastTrackId = trackId;
    STATE.lastWasPlaying = !state.paused;

    emitChange();
    render();
  }

  function setAutoAdvance(on) { STATE.autoAdvance = !!on; emitChange(); }

  /* ════════════════════════════════════
     RENDER
  ════════════════════════════════════ */
  function fmtDuration(ms) {
    const totalSec = Math.round(ms / 1000);
    const h = Math.floor(totalSec / 3600), m = Math.floor((totalSec % 3600) / 60), s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  function render() {
    if (el.counter) el.counter.textContent = STATE.queue.length + (STATE.queue.length === 1 ? ' track' : ' tracks');
    if (el.duration) {
      const totalMs = STATE.queue.reduce((sum, t) => sum + (t.duration_ms || 0), 0);
      el.duration.textContent = STATE.queue.length ? fmtDuration(totalMs) : '';
    }
    if (el.current) {
      el.current.innerHTML = STATE.current
        ? `<div class="spq-current-art" style="background-image:url('${Utils.itemArt('track', STATE.current)}')"></div>
           <div><div class="spq-current-name">${Utils.escapeHtml(STATE.current.name)}</div>
           <div class="spq-current-artist">${Utils.escapeHtml((STATE.current.artists || []).map(a => a.name).join(', '))}</div></div>`
        : '<div class="spq-current-empty">Nothing playing</div>';
    }
    renderList();
    renderHistory();
  }

  function renderList() {
    if (!el.list) return;
    if (!STATE.queue.length) {
      el.list.innerHTML = '<div class="spq-empty">Queue is empty — add tracks from Search or Library.</div>';
      return;
    }
    el.list.innerHTML = STATE.queue.map((t, i) => `
      <div class="spq-row" data-index="${i}">
        <span class="spq-drag-handle" data-index="${i}">⠿</span>
        <img class="spq-art" src="${t.art}" alt="">
        <div class="spq-row-info" data-play-index="${i}">
          <div class="spq-row-name">${Utils.escapeHtml(t.name)}</div>
          <div class="spq-row-artist">${Utils.escapeHtml(t.artists)}</div>
        </div>
        <button class="spq-remove-btn" data-remove-index="${i}" aria-label="Remove">✕</button>
      </div>
    `).join('');

    el.list.querySelectorAll('[data-play-index]').forEach(row => {
      row.addEventListener('click', () => playAt(Number(row.dataset.playIndex)));
    });
    el.list.querySelectorAll('[data-remove-index]').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); removeAt(Number(btn.dataset.removeIndex)); });
    });
    el.list.querySelectorAll('.spq-drag-handle').forEach(handle => bindDrag(handle));
  }

  function renderHistory() {
    if (!el.history) return;
    if (!STATE.history.length) { el.history.innerHTML = '<div class="spq-empty">Nothing played from this queue yet.</div>'; return; }
    el.history.innerHTML = STATE.history.slice(0, 5).map(t => `
      <div class="spq-history-row">
        <img class="spq-art" src="${t.art}" alt="">
        <div class="spq-row-info">
          <div class="spq-row-name">${Utils.escapeHtml(t.name)}</div>
          <div class="spq-row-artist">${Utils.escapeHtml(t.artists)}</div>
        </div>
      </div>
    `).join('');
  }

  /* ════════════════════════════════════
     DRAG TO REORDER — Pointer Events, not HTML5 native drag-and-drop.
     Native drag-and-drop has notoriously unreliable touch support, and
     this needs to actually work on a phone.
  ════════════════════════════════════ */
  let dragState = null;

  function bindDrag(handle) {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const index = Number(handle.dataset.index);
      const row = handle.closest('.spq-row');
      if (!row) return;
      dragState = { index, startY: e.clientY, rowHeight: row.offsetHeight, row, targetIndex: index };
      row.classList.add('spq-dragging');
      try { handle.setPointerCapture(e.pointerId); } catch (err) {}
    });

    handle.addEventListener('pointermove', (e) => {
      if (!dragState) return;
      const deltaY = e.clientY - dragState.startY;
      dragState.row.style.transform = `translateY(${deltaY}px)`;

      const shift = Math.round(deltaY / dragState.rowHeight);
      dragState.targetIndex = Math.max(0, Math.min(STATE.queue.length - 1, dragState.index + shift));

      el.list.querySelectorAll('.spq-row').forEach((r, i) => {
        if (i === dragState.index) return;
        let offset = 0;
        if (dragState.index < dragState.targetIndex && i > dragState.index && i <= dragState.targetIndex) offset = -dragState.rowHeight;
        if (dragState.index > dragState.targetIndex && i < dragState.index && i >= dragState.targetIndex) offset = dragState.rowHeight;
        r.style.transform = `translateY(${offset}px)`;
      });
    });

    const finish = () => {
      if (!dragState) return;
      const { index, targetIndex } = dragState;
      dragState = null;
      if (targetIndex !== index) reorder(index, targetIndex);
      else render();
    };
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  }

  /* ════════════════════════════════════
     INIT
  ════════════════════════════════════ */
  function init() {
    el = {
      current:  document.getElementById('spqCurrent'),
      counter:  document.getElementById('spqCounter'),
      duration: document.getElementById('spqDuration'),
      list:     document.getElementById('spqList'),
      history:  document.getElementById('spqHistory'),
      autoToggle: document.getElementById('spqAutoAdvanceToggle')
    };
    el.autoToggle?.addEventListener('change', () => setAutoAdvance(el.autoToggle.checked));
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.NebulaSpotify.Queue = {
    addTrack, removeAt, reorder, clear, playAt,
    handlePlaybackState, setAutoAdvance,
    onChange,
    getState: () => ({ queue: STATE.queue.slice(), history: STATE.history.slice(), current: STATE.current, autoAdvance: STATE.autoAdvance })
  };
})();