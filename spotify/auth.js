/* ══════════════════════════════════════════
   NEBULABEAT — SPOTIFY AUTH
   ══════════════════════════════════════════ */
(function () {
  'use strict';

  window.NebulaSpotify = window.NebulaSpotify || {};
  const Utils = window.NebulaSpotify.Utils;

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

  const REFRESH_BUFFER_MS = 60000; 
  const AUTH = {
    token: null,
    refreshToken: null,
    expiresAt: null  
  };

  let refreshTimer   = null;
  let refreshPromise = null; 
  let reauthCallbacks = [];

  function onReauthRequired(cb) { reauthCallbacks.push(cb); }
  function notifyReauthRequired() {
    reauthCallbacks.forEach(cb => { try { cb(); } catch (e) {} });
  }

  /* ════════════════════════════════════
     LOGIN — redirect to Spotify
  ════════════════════════════════════ */
  async function login() {
    if (!SPOTIFY_CLIENT_ID) {
      Utils.toast('⚠ Paste your Spotify Client ID in spotify/auth.js first!', 'error');
      return;
    }
    Utils.log('Auth', 'Login started');
    const { verifier, challenge } = await Utils.generatePKCE();
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
     TOKEN EXCHANGE — handle OAuth callback
  ════════════════════════════════════ */
  function applyTokenResponse(data) {
    AUTH.token     = data.access_token;
    AUTH.expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
    sessionStorage.setItem('sp_token', AUTH.token);
    sessionStorage.setItem('sp_expires_at', String(AUTH.expiresAt));

    if (data.refresh_token) {
      AUTH.refreshToken = data.refresh_token;
      sessionStorage.setItem('sp_refresh', data.refresh_token);
    }
    scheduleTokenRefresh();
  }

  async function handleCallback() {
    const params   = new URLSearchParams(window.location.search);
    const code     = params.get('code');
    const state    = params.get('state');
    const verifier = sessionStorage.getItem('sp_verifier');

    if (!code || state !== 'nebulabeat' || !verifier) return false;

    window.history.replaceState({}, '', window.location.pathname); 

    try {
      const res = await Utils.fetchWithTimeout('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:    'authorization_code',
          code,
          redirect_uri:  SPOTIFY_REDIRECT,
          client_id:     SPOTIFY_CLIENT_ID,
          code_verifier: verifier
        })
      }, 10000);
      const data = await res.json();
      sessionStorage.removeItem('sp_verifier');

      if (data.access_token) {
        applyTokenResponse(data);
        Utils.log('Auth', 'Login complete');
        return true;
      }
      Utils.error('Auth', 'Token exchange returned no access token', data);
    } catch (e) {
      Utils.error('Auth', 'Token exchange failed', e);
    }
    Utils.toast('⚠ Spotify login failed. Please try again.', 'error');
    return false;
  }

  /* ════════════════════════════════════
     SILENT REFRESH
  ════════════════════════════════════ */
  async function refreshAccessToken() {
    if (refreshPromise) return refreshPromise;

    if (!AUTH.refreshToken) {
      Utils.warn('Auth', 'No refresh token available — full re-login required');
      notifyReauthRequired();
      return null;
    }

    refreshPromise = (async () => {
      Utils.log('Auth', 'Refreshing access token…');
      try {
        const res = await Utils.fetchWithTimeout('https://accounts.spotify.com/api/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type:    'refresh_token',
            refresh_token: AUTH.refreshToken,
            client_id:     SPOTIFY_CLIENT_ID
          })
        }, 10000);

        if (!res.ok) {
          
          Utils.error('Auth', 'Refresh token rejected by Spotify', res.status);
          clearSession();
          notifyReauthRequired();
          return null;
        }

        const data = await res.json();
        applyTokenResponse(data);
        Utils.log('Auth', 'Token refreshed');
        return AUTH.token;
      } catch (err) {
        Utils.error('Auth', 'Refresh request failed (network) — will retry later', err);
        return null;
      } finally {
        refreshPromise = null;
      }
    })();

    return refreshPromise;
  }

  function scheduleTokenRefresh() {
    clearTimeout(refreshTimer);
    if (!AUTH.expiresAt) return;
    const delay = Math.max(AUTH.expiresAt - Date.now() - REFRESH_BUFFER_MS, 5000);
    refreshTimer = setTimeout(refreshAccessToken, delay);
    Utils.log('Auth', `Next silent refresh in ${Math.round(delay / 1000)}s`);
  }

  function isTokenValid(bufferMs) {
    bufferMs = bufferMs != null ? bufferMs : REFRESH_BUFFER_MS;
    return !!AUTH.token && !!AUTH.expiresAt && Date.now() < AUTH.expiresAt - bufferMs;
  }


  async function getValidToken() {
    if (isTokenValid()) return AUTH.token;
    if (!AUTH.refreshToken) return null;
    return refreshAccessToken();
  }

  /* ════════════════════════════════════
     SESSION RESTORE / LOGOUT
  ════════════════════════════════════ */
  function clearSession() {
    clearTimeout(refreshTimer);
    AUTH.token = null;
    AUTH.refreshToken = null;
    AUTH.expiresAt = null;
    sessionStorage.removeItem('sp_token');
    sessionStorage.removeItem('sp_refresh');
    sessionStorage.removeItem('sp_expires_at');
  }

  function logout() {
    Utils.log('Auth', 'Logout');
    clearSession();
  }

  async function restoreSession() {
    const loggedInFresh = await handleCallback();
    if (loggedInFresh) return true;

    AUTH.token        = sessionStorage.getItem('sp_token') || null;
    AUTH.refreshToken = sessionStorage.getItem('sp_refresh') || null;
    const savedExpires = sessionStorage.getItem('sp_expires_at');
    AUTH.expiresAt = savedExpires ? Number(savedExpires) : null;

    if (isTokenValid()) {
      Utils.log('Auth', 'Session restored from storage');
      scheduleTokenRefresh();
      return true;
    }

    if (AUTH.refreshToken) {
      Utils.log('Auth', AUTH.token ? 'Stored token expired — refreshing silently' : 'No cached token — refreshing from stored refresh token');
      const fresh = await refreshAccessToken();
      return !!fresh;
    }

    return false; 
  }

  /* ════════════════════════════════════
     EXPORT
  ════════════════════════════════════ */
  window.NebulaSpotify.Auth = {
    login, logout,
    handleCallback, restoreSession,
    getValidToken, isTokenValid,
    refreshNow: refreshAccessToken, 
    getToken:   () => AUTH.token,
    isLoggedIn: () => !!AUTH.token || !!AUTH.refreshToken,
    onReauthRequired
  };
})();