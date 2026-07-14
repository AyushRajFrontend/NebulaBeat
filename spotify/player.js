/* ══════════════════════════════════════════
   NEBULABEAT — SPOTIFY PREMIUM PLAYER UI   ══════════════════════════════════════════ */
(function () {
  'use strict';

  window.NebulaSpotify = window.NebulaSpotify || {};
  const Utils      = window.NebulaSpotify.Utils;
  const API        = window.NebulaSpotify.API;
  const Connection = window.NebulaSpotify.Connection;
  const Playback   = window.NebulaSpotify.Playback;

  let el = {};
  let isOpen = false;
  let currentTrack = null;
  let liked = false;
  let dragging = false;      
  let volDragging = false;   
  let progressTicker = null;
  let tickBase = { position: 0, duration: 0, updatedAt: 0, playing: false };
  let ownListenerAttached = false;

  /* ════════════════════════════════════
     ELEMENT CACHE
  ════════════════════════════════════ */
  function cacheEls() {
    el = {
      overlay: document.getElementById('sppOverlay'),
      close:   document.getElementById('sppClose'),
      art:     document.getElementById('sppArt'),
      title:   document.getElementById('sppTitle'),
      artists: document.getElementById('sppArtists'),
      album:   document.getElementById('sppAlbum'),
      year:    document.getElementById('sppYear'),
      elapsed: document.getElementById('sppElapsed'),
      duration:document.getElementById('sppDuration'),
      track:   document.getElementById('sppProgressTrack'),
      fill:    document.getElementById('sppProgressFill'),
      playBtn: document.getElementById('sppPlayBtn'),
      prevBtn: document.getElementById('sppPrevBtn'),
      nextBtn: document.getElementById('sppNextBtn'),
      shuffleBtn: document.getElementById('sppShuffleBtn'),
      repeatBtn:  document.getElementById('sppRepeatBtn'),
      volSlider:  document.getElementById('sppVolumeSlider'),
      muteBtn:    document.getElementById('sppMuteBtn'),
      device:     document.getElementById('sppDevice'),
      connBadge:  document.getElementById('sppConnBadge'),
      queueBtn:   document.getElementById('sppQueueBtn'),
      likeBtn:    document.getElementById('sppLikeBtn'),
      shareBtn:   document.getElementById('sppShareBtn'),
      queuePanel: document.getElementById('sppQueuePanel'),
      trigger:    { art: document.getElementById('spArt'), track: document.getElementById('spNowTrack'), artist: document.getElementById('spNowArtist') }
    };
  }

  function fmtTime(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  /* ════════════════════════════════════
     OPEN / CLOSE
  ════════════════════════════════════ */
  function openOverlay() {
    if (!el.overlay) return;
    isOpen = true;
    el.overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    startTicker();
    refreshDeviceInfo();
  }
  function closeOverlay() {
    if (!el.overlay) return;
    isOpen = false;
    el.overlay.classList.remove('open');
    document.body.style.overflow = '';
    stopTicker();
    closeQueuePanel();
  }
  function bindTrigger() {
    const open = () => { if (Connection.getState() === 'CONNECTED' && currentTrack) openOverlay(); };
    el.trigger.art?.addEventListener('click', open);
    el.trigger.track?.addEventListener('click', open);
    el.trigger.artist?.addEventListener('click', open);
    el.close?.addEventListener('click', closeOverlay);
  }

  /* ════════════════════════════════════
     RENDER — track info + progress
  ════════════════════════════════════ */
  function renderTrack(state) {
    if (!state || !state.track_window || !state.track_window.current_track) return;
    const track = state.track_window.current_track;
    currentTrack = track;

    if (el.art && track.album?.images?.[0]?.url) el.art.src = track.album.images[0].url;
    if (el.title)   el.title.textContent   = track.name;
    if (el.artists) el.artists.textContent = track.artists.map(a => a.name).join(', ');
    if (el.album)   el.album.textContent   = track.album?.name || '';
    if (el.year)    el.year.textContent    = (track.album?.release_date || '').slice(0, 4);
    if (el.duration)el.duration.textContent= fmtTime(track.duration_ms);

    tickBase = { position: state.position, duration: track.duration_ms, updatedAt: Date.now(), playing: !state.paused };
    renderProgress(state.position, track.duration_ms);
    checkLiked(track.id);
  }

  function renderProgress(positionMs, durationMs) {
    if (dragging) return;
    if (el.elapsed) el.elapsed.textContent = fmtTime(positionMs);
    if (el.fill && durationMs) el.fill.style.width = Math.min(100, (positionMs / durationMs) * 100) + '%';
  }

  function startTicker() {
    stopTicker();
    progressTicker = setInterval(() => {
      if (!tickBase.playing || dragging) return;
      const est = tickBase.position + (Date.now() - tickBase.updatedAt);
      renderProgress(Math.min(est, tickBase.duration), tickBase.duration);
    }, 500);
  }
  function stopTicker() { clearInterval(progressTicker); progressTicker = null; }

  /* ════════════════════════════════════
     OPTIMISTIC STATE → UI (from playback.js)
  ════════════════════════════════════ */
  function applyOptimisticState(state) {
    if (el.playBtn) el.playBtn.textContent = state.isPlaying ? '⏸' : '▶';
    tickBase.playing = state.isPlaying;

    if (el.shuffleBtn) {
      el.shuffleBtn.classList.toggle('active', state.shuffle);
      el.shuffleBtn.classList.toggle('pending', state.pending.shuffle);
    }
    if (el.repeatBtn) {
      el.repeatBtn.classList.toggle('active', state.repeat !== 'off');
      el.repeatBtn.classList.toggle('pending', state.pending.repeat);
      el.repeatBtn.textContent = state.repeat === 'track' ? '🔂' : '🔁';
    }
    if (el.muteBtn) el.muteBtn.textContent = state.muted ? '🔇' : '🔊';
    if (el.volSlider && !volDragging) el.volSlider.value = Math.round(state.volume * 100);
  }

  /* ════════════════════════════════════
     CONNECTION BADGE (own element, same state source as spBadge)
  ════════════════════════════════════ */
  function applyConnectionState(state) {
    if (!el.connBadge) return;
    el.connBadge.textContent = state;
    const cls = { CONNECTED: 'spp-connected', CONNECTING: 'spp-connecting', RECONNECTING: 'spp-connecting', ERROR: 'spp-error' };
    el.connBadge.className = 'spp-conn-badge' + (cls[state] ? ' ' + cls[state] : '');
  }

  async function refreshDeviceInfo() {
    const r = await API.get('/me/player');
    if (r.ok && r.data?.device && el.device) el.device.textContent = r.data.device.name;
  }

  /* ════════════════════════════════════
     LIKE
  ════════════════════════════════════ */
  async function checkLiked(trackId) {
    if (!trackId) return;
    const r = await API.get('/me/tracks/contains?ids=' + trackId);
    liked = !!(r.ok && Array.isArray(r.data) && r.data[0]);
    updateLikeBtn();
  }
  function updateLikeBtn() {
    if (!el.likeBtn) return;
    el.likeBtn.textContent = liked ? '❤️' : '🤍';
    el.likeBtn.classList.toggle('active', liked);
  }
  async function toggleLike() {
    if (!currentTrack) return;
    const wasLiked = liked;
    liked = !wasLiked; updateLikeBtn();

    const r = wasLiked
      ? await API.request('/me/tracks?ids=' + currentTrack.id, { method: 'DELETE' })
      : await API.put('/me/tracks?ids=' + currentTrack.id, null);

    if (!r.ok) {
      liked = wasLiked; updateLikeBtn();
      Utils.error('Player', 'Like toggle failed', r.error);
      Utils.toast('Couldn\'t update your library.', 'warning');
    } else {
      Utils.log('Player', wasLiked ? 'Unliked' : 'Liked', currentTrack.name);
    }
  }

  /* ════════════════════════════════════
     SHARE
  ════════════════════════════════════ */
  function shareTrack() {
    if (!currentTrack) return;
    const url = currentTrack.external_urls?.spotify || ('https://open.spotify.com/track/' + currentTrack.id);
    if (navigator.share) {
      navigator.share({ title: currentTrack.name, url }).catch(() => {});
    } else {
      Utils.copyToClipboard(url).then(() => Utils.toast('Link copied!', 'info'));
    }
  }

  /* ════════════════════════════════════
     QUEUE PANEL
  ════════════════════════════════════ */
  function openQueuePanel() { el.queuePanel?.classList.add('open'); }
  function closeQueuePanel() { el.queuePanel?.classList.remove('open'); }
  function toggleQueuePanel() {
    if (el.queuePanel?.classList.contains('open')) closeQueuePanel();
    else openQueuePanel();
  }

  /* ════════════════════════════════════
     CONTROL BINDINGS
  ════════════════════════════════════ */
  function bindControls() {
    el.playBtn?.addEventListener('click', () => Playback.togglePlay());
    el.prevBtn?.addEventListener('click', () => Playback.previous());
    el.nextBtn?.addEventListener('click', () => Playback.next());
    el.shuffleBtn?.addEventListener('click', () => Playback.toggleShuffle());
    el.repeatBtn?.addEventListener('click', () => Playback.cycleRepeat());
    el.muteBtn?.addEventListener('click', () => Playback.toggleMute());
    el.likeBtn?.addEventListener('click', toggleLike);
    el.shareBtn?.addEventListener('click', shareTrack);
    el.queueBtn?.addEventListener('click', toggleQueuePanel);

    el.volSlider?.addEventListener('input', () => {
      volDragging = true;
      Playback.setVolume(el.volSlider.value / 100);
    });
    el.volSlider?.addEventListener('change', () => { volDragging = false; });


    let trackDragging = false;
    const posFromPointer = (e) => {
      if (!tickBase.duration || !el.track) return null;
      const rect = el.track.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      renderProgress(ratio * tickBase.duration, tickBase.duration);
      return ratio;
    };
    el.track?.addEventListener('pointerdown', (e) => { trackDragging = true; dragging = true; posFromPointer(e); });
    window.addEventListener('pointermove', (e) => { if (trackDragging) posFromPointer(e); });
    window.addEventListener('pointerup', (e) => {
      if (!trackDragging) return;
      trackDragging = false; dragging = false;
      const ratio = posFromPointer(e);
      if (ratio != null) Playback.seek(ratio * tickBase.duration);
    });
  }

  /* ════════════════════════════════════
     GESTURES — swipe art left/right to skip, swipe overlay down to close
  ════════════════════════════════════ */
  function bindGestures() {
    const SWIPE_MIN = 50, SWIPE_MAX_MS = 500;
    let sx = 0, sy = 0, st = 0;

    el.art?.addEventListener('touchstart', (e) => {
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now();
    }, { passive: true });
    el.art?.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - sx;
      const dy = e.changedTouches[0].clientY - sy;
      if (Date.now() - st > SWIPE_MAX_MS) return;
      if (Math.abs(dx) > SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.5) {
        dx < 0 ? Playback.next() : Playback.previous();
      }
    }, { passive: true });

    let oy = 0;
    el.overlay?.addEventListener('touchstart', (e) => { oy = e.touches[0].clientY; }, { passive: true });
    el.overlay?.addEventListener('touchend', (e) => {
      if (e.changedTouches[0].clientY - oy > 80) closeOverlay();
    }, { passive: true });
  }

  /* ════════════════════════════════════
     KEYBOARD SHORTCUTS
  ════════════════════════════════════ */
  function bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
      if (!isOpen && Connection.getState() !== 'CONNECTED') return;

      switch (e.code) {
        case 'Space':      e.preventDefault(); Playback.togglePlay(); break;
        case 'ArrowRight': if (isOpen) { e.preventDefault(); Playback.next(); } break;
        case 'ArrowLeft':  if (isOpen) { e.preventDefault(); Playback.previous(); } break;
        case 'ArrowUp':    if (isOpen) { e.preventDefault(); Playback.setVolume(Playback.getState().volume + 0.05); } break;
        case 'ArrowDown':  if (isOpen) { e.preventDefault(); Playback.setVolume(Playback.getState().volume - 0.05); } break;
        case 'KeyM':       if (isOpen) { e.preventDefault(); Playback.toggleMute(); } break;
        case 'KeyS':       if (isOpen) { e.preventDefault(); Playback.toggleShuffle(); } break;
        case 'KeyR':       if (isOpen) { e.preventDefault(); Playback.cycleRepeat(); } break;
        case 'Escape':     if (isOpen) closeOverlay(); break;
      }
    });
  }

  /* ════════════════════════════════════
     INIT
  ════════════════════════════════════ */
  function init() {
    cacheEls();
    bindTrigger();
    bindControls();
    bindGestures();
    bindKeyboard();

    Playback.onChange(applyOptimisticState);
    Connection.onStateChange(applyConnectionState);

    Connection.onStateChange((state) => {
      if (state !== 'CONNECTED') return;
      const player = Connection.getPlayer();
      if (!player || ownListenerAttached) return;
      ownListenerAttached = true;
      player.addListener('player_state_changed', s => {
        if (!s) return;
        renderTrack(s);
        window.NebulaSpotify.Queue?.handlePlaybackState(s);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();