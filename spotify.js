/* ══════════════════════════════════════════
   NEBULABEAT — SPOTIFY INTEGRATION
   Web Playback SDK + OAuth 2.0 PKCE Flow  ══════════════════════════════════════════ */

const SPOTIFY_CLIENT_ID = '604067e4e27c4d11b8b67c3609c1ede8';
const SPOTIFY_REDIRECT  = window.location.origin + window.location.pathname;
const SPOTIFY_SCOPES    = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing'
].join(' ');

(function () {
  'use strict';

  const SP = {
    token:       null,
    player:      null,
    deviceId:    null,
    state:       null,
    stateInterval: null
  };

  /* ════════════════════════════════════
     PKCE HELPERS
  ════════════════════════════════════ */
  async function sha256(plain) {
    const enc  = new TextEncoder().encode(plain);
    const buf  = await crypto.subtle.digest('SHA-256', enc);
    return buf;
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
     LOGIN — redirect to Spotify
  ════════════════════════════════════ */
  async function login() {
    if (!SPOTIFY_CLIENT_ID) {
      showSpotifyToast('⚠ Paste your Spotify Client ID in spotify.js first!', 'error');
      return;
    }
    const { verifier, challenge } = await generatePKCE();
    sessionStorage.setItem('sp_verifier', verifier);

    const params = new URLSearchParams({
      client_id:             SPOTIFY_CLIENT_ID,
      response_type:         'code',
      redirect_uri:          SPOTIFY_REDIRECT,
      code_challenge_method: 'S256',
      code_challenge:        challenge,
      scope:                 SPOTIFY_SCOPES,
      state:                 'nebulabeat'
    });
    window.location.href = 'https://accounts.spotify.com/authorize?' + params;
  }

  /* ════════════════════════════════════
     TOKEN EXCHANGE — handle callback
  ════════════════════════════════════ */
  async function handleCallback() {
    const params   = new URLSearchParams(window.location.search);
    const code     = params.get('code');
    const state    = params.get('state');
    const verifier = sessionStorage.getItem('sp_verifier');

    if (!code || state !== 'nebulabeat' || !verifier) return false;

    // Clean URL
    window.history.replaceState({}, '', window.location.pathname);

    try {
      const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:    'authorization_code',
          code,
          redirect_uri:  SPOTIFY_REDIRECT,
          client_id:     SPOTIFY_CLIENT_ID,
          code_verifier: verifier
        })
      });
      const data = await res.json();
      if (data.access_token) {
        SP.token = data.access_token;
        sessionStorage.setItem('sp_token', SP.token);
        // Store refresh token if provided
        if (data.refresh_token) sessionStorage.setItem('sp_refresh', data.refresh_token);
        sessionStorage.removeItem('sp_verifier');
        return true;
      }
    } catch (e) {
      console.error('[Spotify] token exchange failed', e);
    }
    return false;
  }

  /* ════════════════════════════════════
     INIT WEB PLAYBACK SDK
  ════════════════════════════════════ */
  window.onSpotifyWebPlaybackSDKReady = function () {
    if (!SP.token) return;

    SP.player = new Spotify.Player({
      name:       'NebulaBeat 🌌',
      getOAuthToken: cb => cb(SP.token),
      volume: 0.7
    });

    SP.player.addListener('ready', ({ device_id }) => {
      SP.deviceId = device_id;
      console.log('[Spotify] Ready, device:', device_id);
      updateSpotifyUI('connected');
      showSpotifyToast('🎵 Spotify connected! Tap a track to play.', 'ok');
      // Transfer playback to this device
      transferPlayback(device_id);
    });

    SP.player.addListener('not_ready', () => updateSpotifyUI('disconnected'));

    SP.player.addListener('player_state_changed', state => {
      SP.state = state;
      if (state) updateNowPlaying(state);
    });

    SP.player.addListener('authentication_error', () => {
      showSpotifyToast('⚠ Spotify auth expired. Please reconnect.', 'error');
      updateSpotifyUI('disconnected');
    });

    SP.player.connect();

    // Poll current playback state every 2s for visualizer data
    SP.stateInterval = setInterval(pollState, 2000);
  };

  async function transferPlayback(deviceId) {
    await fetch('https://api.spotify.com/v1/me/player', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${SP.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ device_ids: [deviceId], play: false })
    }).catch(() => {});
  }

  async function pollState() {
    if (!SP.token || !SP.deviceId) return;
    try {
      const res  = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
        headers: { Authorization: `Bearer ${SP.token}` }
      });
      if (res.status === 204 || !res.ok) return;
      const data = await res.json();
      if (data?.item) updateNowPlaying({ track_window: { current_track: data.item }, paused: !data.is_playing, position: data.progress_ms, duration: data.item.duration_ms });
    } catch (e) {}
  }

  /* ════════════════════════════════════
     SEARCH
  ════════════════════════════════════ */
  async function searchTracks(query) {
    if (!SP.token || !query.trim()) return [];
    try {
      const res  = await fetch(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=8`,
        { headers: { Authorization: `Bearer ${SP.token}` } }
      );
      const data = await res.json();
      return data.tracks?.items || [];
    } catch (e) { return []; }
  }

  async function playTrack(uri) {
    if (!SP.token || !SP.deviceId) return;
    await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${SP.deviceId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${SP.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [uri] })
    });
  }

  /* ════════════════════════════════════
     UI UPDATES
  ════════════════════════════════════ */
  function updateNowPlaying(state) {
    if (!state?.track_window?.current_track) return;
    const track = state.track_window.current_track;
    const title = document.getElementById('playerTitle');
    const mode  = document.getElementById('playerMode');
    const disc  = document.getElementById('playerDisc');
    const fill  = document.getElementById('progressFill');

    if (title) title.textContent = track.name;
    if (mode)  mode.textContent  = track.artists?.map(a => a.name).join(', ') || 'Spotify';
    if (disc)  disc.textContent  = '🟢';

    // Sync progress bar
    if (fill && state.duration) {
      fill.style.width = ((state.position / state.duration) * 100).toFixed(1) + '%';
    }

    // Show album art in Spotify panel
    const artEl = document.getElementById('spArt');
    if (artEl && track.album?.images?.[0]?.url) {
      artEl.src   = track.album.images[0].url;
      artEl.style.display = 'block';
    }

    // Update Spotify panel track info
    const spTrack  = document.getElementById('spNowTrack');
    const spArtist = document.getElementById('spNowArtist');
    if (spTrack)  spTrack.textContent  = track.name;
    if (spArtist) spArtist.textContent = track.artists?.map(a => a.name).join(', ') || '';
  }

  function updateSpotifyUI(status) {
    const btn    = document.getElementById('spotifyLoginBtn');
    const panel  = document.getElementById('spotifyPanel');
    const badge  = document.getElementById('spBadge');
    const search = document.getElementById('spSearchWrap');

    if (status === 'connected') {
      if (btn)    { btn.textContent = '🟢 Spotify'; btn.classList.add('sp-connected'); }
      if (badge)  badge.textContent = 'CONNECTED';
      if (badge)  badge.className   = 'sp-badge sp-connected';
      if (search) search.style.display = 'flex';
    } else {
      if (btn)    { btn.textContent = '🎵 Spotify'; btn.classList.remove('sp-connected'); }
      if (badge)  badge.textContent = 'OFFLINE';
      if (badge)  badge.className   = 'sp-badge';
      if (search) search.style.display = 'none';
    }
  }

  function renderSearchResults(tracks) {
    const list = document.getElementById('spResults');
    if (!list) return;
    if (!tracks.length) { list.innerHTML = '<div class="sp-no-results">No results found</div>'; return; }

    list.innerHTML = tracks.map(t => `
      <div class="sp-result" data-uri="${t.uri}">
        <img class="sp-result-art" src="${t.album?.images?.[2]?.url || t.album?.images?.[0]?.url || ''}" alt="">
        <div class="sp-result-info">
          <div class="sp-result-name">${t.name}</div>
          <div class="sp-result-artist">${t.artists?.map(a => a.name).join(', ')}</div>
        </div>
        <button class="sp-play-btn" data-uri="${t.uri}">▶</button>
      </div>
    `).join('');

    list.querySelectorAll('.sp-play-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        playTrack(btn.dataset.uri);
        // Show player bar if not visible
        document.getElementById('uploadZone')?.classList.add('hidden');
        document.getElementById('player')?.classList.remove('hidden');
      });
    });
  }

  /* ════════════════════════════════════
     TOAST
  ════════════════════════════════════ */
  let spToastTimer;
  function showSpotifyToast(msg, type = 'ok') {
    let toast = document.getElementById('spToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'spToast';
      toast.className = 'sp-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className = 'sp-toast sp-toast-' + type + ' sp-toast-show';
    clearTimeout(spToastTimer);
    spToastTimer = setTimeout(() => toast.classList.remove('sp-toast-show'), 3500);
  }

  /* ════════════════════════════════════
     BIND UI + INIT
  ════════════════════════════════════ */
  async function init() {
    // Check if returning from Spotify OAuth
    const loggedIn = await handleCallback();
    if (!loggedIn) {
      // Try restoring token from session
      const saved = sessionStorage.getItem('sp_token');
      if (saved) SP.token = saved;
    }

    if (SP.token) {
      // Load Spotify Web Playback SDK
      const script   = document.createElement('script');
      script.src     = 'https://sdk.scdn.co/spotify-player.js';
      document.head.appendChild(script);
    }

    // Bind login button
    const loginBtn = document.getElementById('spotifyLoginBtn');
    loginBtn?.addEventListener('click', () => {
      if (SP.token && SP.player) {
        // Logout
        SP.player?.disconnect();
        SP.token = null;
        sessionStorage.removeItem('sp_token');
        clearInterval(SP.stateInterval);
        updateSpotifyUI('disconnected');
      } else {
        login();
      }
    });

    // Bind panel toggle
    const panelBtn = document.getElementById('spotifyPanelBtn');
    const panel    = document.getElementById('spotifyPanel');
    const spClose  = document.getElementById('spClose2');
    panelBtn?.addEventListener('click', () => panel?.classList.toggle('open'));
    spClose?.addEventListener('click',  () => panel?.classList.remove('open'));

    // Bind search
    const searchInput = document.getElementById('spSearchInput');
    const searchBtn   = document.getElementById('spSearchBtn');
    let searchTimer;

    searchInput?.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        if (!searchInput.value.trim()) return;
        const results = await searchTracks(searchInput.value);
        renderSearchResults(results);
      }, 400);
    });
    searchBtn?.addEventListener('click', async () => {
      const results = await searchTracks(searchInput?.value || '');
      renderSearchResults(results);
    });
    searchInput?.addEventListener('keydown', e => {
      if (e.key === 'Enter') searchBtn?.click();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.NebulaSpotify = {
    login, playTrack, searchTracks,
    getPlayer: () => SP.player,
    getToken:  () => SP.token,
    isConnected: () => !!SP.deviceId
  };
})();