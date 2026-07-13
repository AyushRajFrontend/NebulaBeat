/* ══════════════════════════════════════════
   NEBULABEAT — SPOTIFY CONNECTION MONITOR
   Player construction · every SDK error listener · state machine ·
   backoff reconnect · offline detection
   ══════════════════════════════════════════ */
(function () {
  'use strict';

  window.NebulaSpotify = window.NebulaSpotify || {};
  const Utils = window.NebulaSpotify.Utils;

  const MAX_RECONNECT_ATTEMPTS = 5;

  let player   = null;
  let deviceId = null;
  let suppressReconnect = false;

  let currentState    = 'CONNECTING'; // CONNECTED | CONNECTING | RECONNECTING | OFFLINE | ERROR
  let stateListeners   = [];
  let reconnectAttempt = 0;
  let reconnectTimer   = null;
  let reconnectToastId = null;

  /* ════════════════════════════════════
     STATE MACHINE
  ════════════════════════════════════ */
  function setState(state) {
    if (currentState === state) return;
    currentState = state;
    Utils.log('Connection', `State → ${state}`);
    updateBadge(state);
    stateListeners.forEach(cb => { try { cb(state); } catch (e) {} });
  }

  function onStateChange(cb) { stateListeners.push(cb); }
  function getState() { return currentState; }

  function updateBadge(state) {
    const badge = document.getElementById('spBadge');
    if (!badge) return;
    badge.textContent = state;
    const cls = { CONNECTED: 'sp-connected', CONNECTING: 'sp-connecting', RECONNECTING: 'sp-reconnecting', ERROR: 'sp-error' };
    badge.className = 'sp-badge' + (cls[state] ? ' ' + cls[state] : '');
  }

  /* ════════════════════════════════════
     RECONNECT — exponential backoff, stops after MAX_RECONNECT_ATTEMPTS
  ════════════════════════════════════ */
  function scheduleReconnect() {
    if (!navigator.onLine) {
      setState('OFFLINE');
      return;
    }
    if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      setState('ERROR');
      Utils.dismissToast(reconnectToastId);
      Utils.toast('Couldn\'t reconnect to Spotify. Try refreshing the page.', 'error');
      return;
    }

    setState('RECONNECTING');
    const delay = Utils.backoffDelay(reconnectAttempt);
    Utils.log('Connection', `Reconnect attempt ${reconnectAttempt + 1} in ${delay}ms`);
    Utils.dismissToast(reconnectToastId);
    reconnectToastId = Utils.toast(`Reconnecting to Spotify… (attempt ${reconnectAttempt + 1})`, 'loading', { id: 'sp-reconnect-' + Date.now() });

    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(async () => {
      reconnectAttempt++;
      const ok = await tryConnect();
      if (ok) {
        reconnectAttempt = 0;
        Utils.dismissToast(reconnectToastId);
      } else {
        scheduleReconnect();
      }
    }, delay);
  }

  async function tryConnect() {
    if (!player) return false;
    try {
      return !!(await player.connect());
    } catch (e) {
      Utils.error('Connection', 'player.connect() threw', e);
      return false;
    }
  }

  function reconnect() { 
    reconnectAttempt = 0;
    scheduleReconnect();
  }

  function disconnect() {
    clearTimeout(reconnectTimer);
    reconnectAttempt = 0;
    suppressReconnect = true;
    if (player) { try { player.disconnect(); } catch (e) {} }
    deviceId = null;
    setState('OFFLINE');
  }

  /* ════════════════════════════════════
     OFFLINE DETECTION
  ════════════════════════════════════ */
  function handleOffline() {
    Utils.warn('Connection', 'Browser reports offline');
    clearTimeout(reconnectTimer);
    setState('OFFLINE');
  }
  function handleOnline() {
    Utils.log('Connection', 'Browser back online');
    if (currentState === 'OFFLINE') { reconnectAttempt = 0; scheduleReconnect(); }
  }
  window.addEventListener('offline', handleOffline);
  window.addEventListener('online', handleOnline);

  /* ════════════════════════════════════
     PLAYER CONSTRUCTION + EVERY SDK ERROR TYPE
  ════════════════════════════════════ */
  function initPlayer() {
    if (player) return player; 
    setState('CONNECTING');

    player = new Spotify.Player({
      name: 'NebulaBeat',
      getOAuthToken: async (cb) => {
        const token = await window.NebulaSpotify.Auth.getValidToken();
        cb(token || '');
      },
      volume: 0.7
    });

    player.addListener('ready', ({ device_id }) => {
      deviceId = device_id;
      reconnectAttempt = 0;
      Utils.dismissToast(reconnectToastId);
      Utils.log('Connection', 'SDK connected', device_id);
      setState('CONNECTED');
    });

    player.addListener('not_ready', ({ device_id }) => {
      Utils.warn('Connection', 'Device went not-ready', device_id);
      if (device_id !== deviceId) return;
      if (suppressReconnect) return;    
      if (currentState === 'OFFLINE') return;
      Utils.toast('Lost connection to this device — reconnecting…', 'warning');
      scheduleReconnect();
    });

    player.addListener('initialization_error', ({ message }) => {
      Utils.error('Connection', 'Initialization error', message);
      Utils.toast('Spotify player failed to start. Try reloading the page.', 'error');
      setState('ERROR'); 
    });

    player.addListener('authentication_error', ({ message }) => {
      Utils.error('Connection', 'Authentication error', message);
      Utils.toast('Spotify session issue — refreshing…', 'warning');
      
      window.NebulaSpotify.Auth.refreshNow();
    });

    player.addListener('account_error', ({ message }) => {
      Utils.error('Connection', 'Account error', message);
      Utils.toast('Spotify Premium is required for in-app playback.', 'error');
      setState('ERROR');
    });

    player.addListener('playback_error', ({ message }) => {
      
      Utils.error('Connection', 'Playback error', message);
      Utils.toast('That track couldn\'t be played.', 'warning');
    });

    player.connect();
    return player;
  }

  window.onSpotifyWebPlaybackSDKReady = function () {
    Utils.log('Connection', 'SDK script loaded');
    initPlayer();
  };

  /* ════════════════════════════════════
     DIAGNOSTICS
  ════════════════════════════════════ */
  async function getDiagnostics() {
    const Auth = window.NebulaSpotify.Auth;
    const apiReachable = await window.NebulaSpotify.API.ping();
    return {
      state: currentState,
      sdkConnected:      currentState === 'CONNECTED',
      apiReachable,
      internetAvailable: navigator.onLine,
      deviceActive:      !!deviceId,
      authValid:         Auth.isTokenValid()
    };
  }


  window.NebulaSpotify.Auth.onReauthRequired(() => {
    Utils.error('Connection', 'Refresh token invalid — full re-login required');
    Utils.toast('Your Spotify session expired. Please reconnect.', 'error', { duration: 6000 });
    setState('ERROR');
  });

  /* ════════════════════════════════════
     EXPORT
  ════════════════════════════════════ */
  window.NebulaSpotify.Connection = {
    initPlayer,
    getPlayer:   () => player,
    getDeviceId: () => deviceId,
    getState, onStateChange,
    reconnect, disconnect,
    getDiagnostics
  };
})();