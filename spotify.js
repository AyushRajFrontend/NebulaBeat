/* ══════════════════════════════════════════
   NEBULABEAT — SPOTIFY PLAYBACK
   Search · play · now-playing UI · panel wiring
   ══════════════════════════════════════════ */
(function () {
  'use strict';

  window.NebulaSpotify = window.NebulaSpotify || {};
  const Utils      = window.NebulaSpotify.Utils;
  const Auth       = window.NebulaSpotify.Auth;
  const API        = window.NebulaSpotify.API;
  const Connection = window.NebulaSpotify.Connection;

  let playerStateListenerAttached = false;
  let stateInterval = null;

  /* ════════════════════════════════════
     PLAYBACK
  ════════════════════════════════════ */
  async function transferPlayback(deviceId) {
    const r = await API.put('/me/player', { device_ids: [deviceId], play: false });
    if (!r.ok) Utils.warn('Playback', 'Transfer to this device failed', r.error);
  }

  async function pollState() {
    if (!Connection.getDeviceId()) return;
    const r = await API.get('/me/player/currently-playing');
    if (!r.ok || !r.data || !r.data.item) return;
    updateNowPlaying({
      track_window: { current_track: r.data.item },
      paused:   !r.data.is_playing,
      position: r.data.progress_ms,
      duration: r.data.item.duration_ms
    });
  }

  async function playTrack(uri) {
    const deviceId = Connection.getDeviceId();
    if (!deviceId) {
      Utils.toast('Spotify isn\'t connected yet.', 'warning');
      return;
    }
    const r = await API.put('/me/player/play?device_id=' + deviceId, { uris: [uri] });
    if (!r.ok) Utils.toast('Couldn\'t play that track.', 'warning');
  }

  /* ════════════════════════════════════
     NOW PLAYING UI
  ════════════════════════════════════ */
  function updateNowPlaying(state) {
    if (!state || !state.track_window || !state.track_window.current_track) return;
    const track = state.track_window.current_track;

    const title = document.getElementById('playerTitle');
    const mode  = document.getElementById('playerMode');
    const disc  = document.getElementById('playerDisc');
    const fill  = document.getElementById('progressFill');

    if (title) title.textContent = track.name;
    if (mode)  mode.textContent  = track.artists.map(a => a.name).join(', ');
    if (disc)  disc.textContent  = '🟢';
    if (fill && state.duration) fill.style.width = ((state.position / state.duration) * 100).toFixed(1) + '%';

    const artEl = document.getElementById('spArt');
    if (artEl && track.album && track.album.images && track.album.images[0]) {
      artEl.src = track.album.images[0].url;
      artEl.style.display = 'block';
    }
    const spTrack  = document.getElementById('spNowTrack');
    const spArtist = document.getElementById('spNowArtist');
    if (spTrack)  spTrack.textContent  = track.name;
    if (spArtist) spArtist.textContent = track.artists.map(a => a.name).join(', ');

    document.getElementById('uploadZone')?.classList.add('hidden');
    document.getElementById('player')?.classList.remove('hidden');
  }

  function updateLoginUI(connected) {
    const btn  = document.getElementById('spotifyLoginBtn');
    const tabs = document.getElementById('spPanelTabs');
    if (connected) {
      if (btn) { btn.textContent = '🟢 Spotify'; btn.classList.add('sp-connected'); }
      if (tabs) tabs.style.display = 'flex';
      Utils.activatePanel('search'); // known-good default panel on connect
    } else {
      if (btn) { btn.textContent = '🎵 Spotify'; btn.classList.remove('sp-connected'); }
      if (tabs) tabs.style.display = 'none';
      Utils.hideAllPanels(); // whichever panel was open (search/library/profile/...) — all hidden on disconnect
    }
  }

  /* ════════════════════════════════════
     REACT TO CONNECTION STATE
  ════════════════════════════════════ */
  Connection.onStateChange((state) => {
    updateLoginUI(state === 'CONNECTED');

    if (state === 'CONNECTED') {
      const player = Connection.getPlayer();
      if (player && !playerStateListenerAttached) {
        playerStateListenerAttached = true;
        player.addListener('player_state_changed', s => {
          if (!s) return;
          updateNowPlaying(s);
          window.NebulaSpotify.Playback?.syncFromState(s); // keeps playback.js's optimistic state honest against reality
        });
      }
      const deviceId = Connection.getDeviceId();
      if (deviceId) transferPlayback(deviceId);

      Utils.toast('🎵 Spotify connected! Tap a track to play.', 'success');

      clearInterval(stateInterval);
      stateInterval = setInterval(pollState, 2000);
    } else {
      clearInterval(stateInterval);
      stateInterval = null;
    }
  });

  /* ════════════════════════════════════
     INIT + UI BINDINGS
  ════════════════════════════════════ */
  async function init() {
    const loggedIn = await Auth.restoreSession();
    Utils.log('Spotify', loggedIn ? 'Session restored — loading player SDK' : 'Not logged in');

    if (loggedIn) {
      const script = document.createElement('script');
      script.src = 'https://sdk.scdn.co/spotify-player.js';
      document.head.appendChild(script);
    }

    const loginBtn = document.getElementById('spotifyLoginBtn');
    loginBtn?.addEventListener('click', () => {
      if (Auth.isLoggedIn()) {
        Connection.disconnect();
        Auth.logout();
        updateLoginUI(false);
      } else {
        Auth.login();
      }
    });

    const panel    = document.getElementById('spotifyPanel');
    const panelBtn = document.getElementById('spotifyPanelBtn');
    const spClose  = document.getElementById('spClose2');
    panelBtn?.addEventListener('click', () => panel?.classList.toggle('open'));
    spClose?.addEventListener('click', () => panel?.classList.remove('open'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ════════════════════════════════════
     EXPORT
  ════════════════════════════════════ */
  Object.assign(window.NebulaSpotify, {
    login:       Auth.login,
    playTrack,
    getPlayer:   Connection.getPlayer,
    getToken:    Auth.getToken,
    isConnected: () => Connection.getState() === 'CONNECTED'
  });
})();