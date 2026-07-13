/* ══════════════════════════════════════════
   NEBULABEAT — SPOTIFY PLAYBACK ACTIONS
   Play · pause · toggle · next · previous · seek · volume · mute ·
   shuffle · repeat — optimistic UI with revert-on-failure.
   ══════════════════════════════════════════ */
(function () {
  'use strict';

  window.NebulaSpotify = window.NebulaSpotify || {};
  const Utils = window.NebulaSpotify.Utils;

  const REPEAT_CYCLE = ['off', 'context', 'track'];

  const OPT = {
    isPlaying: false,
    shuffle: false,
    repeat: 'off',
    volume: 0.7,
    muted: false,
    volumeBeforeMute: 0.7,
    pending: { shuffle: false, repeat: false }
  };

  let listeners = [];
  function onChange(cb) { listeners.push(cb); }
  function emitChange() {
    const snapshot = { ...OPT, pending: { ...OPT.pending } };
    listeners.forEach(cb => { try { cb(snapshot); } catch (e) {} });
  }

  function getPlayer()   { return window.NebulaSpotify.Connection.getPlayer(); }
  function getDeviceId() { return window.NebulaSpotify.Connection.getDeviceId(); }

  function ensureReady() {
    if (window.NebulaSpotify.Connection.getState() !== 'CONNECTED') {
      Utils.toast('Spotify isn\'t connected.', 'warning');
      return false;
    }
    return true;
  }

  /* ════════════════════════════════════
     RECONCILE
  ════════════════════════════════════ */
  function syncFromState(sdkState) {
    if (!sdkState) return;
    OPT.isPlaying = !sdkState.paused;
    if (typeof sdkState.shuffle === 'boolean') OPT.shuffle = sdkState.shuffle;
    if (typeof sdkState.repeat_mode === 'number') OPT.repeat = REPEAT_CYCLE[sdkState.repeat_mode] || 'off';
    emitChange();
  }

  async function refreshVolume() {
    const player = getPlayer();
    if (!player) return;
    try {
      const v = await player.getVolume();
      OPT.volume = v;
      OPT.muted  = v === 0;
      emitChange();
    } catch (e) { /* not fatal — next real volume change will correct it */ }
  }
  window.NebulaSpotify.Connection?.onStateChange((state) => { if (state === 'CONNECTED') refreshVolume(); });

  /* ════════════════════════════════════
     PLAY / PAUSE / TOGGLE
  ════════════════════════════════════ */
  async function play() {
    if (!ensureReady()) return;
    const player = getPlayer();
    if (!player || OPT.isPlaying) return;
    OPT.isPlaying = true; emitChange();
    try {
      await player.resume();
      Utils.log('Playback', 'Play');
    } catch (err) {
      OPT.isPlaying = false; emitChange();
      Utils.error('Playback', 'Play failed', err);
      Utils.toast('Couldn\'t play.', 'warning');
    }
  }

  async function pause() {
    if (!ensureReady()) return;
    const player = getPlayer();
    if (!player || !OPT.isPlaying) return;
    OPT.isPlaying = false; emitChange();
    try {
      await player.pause();
      Utils.log('Playback', 'Pause');
    } catch (err) {
      OPT.isPlaying = true; emitChange();
      Utils.error('Playback', 'Pause failed', err);
      Utils.toast('Couldn\'t pause.', 'warning');
    }
  }

  async function togglePlay() {
    if (!ensureReady()) return;
    const player = getPlayer();
    if (!player) return;
    const wasPlaying = OPT.isPlaying;
    OPT.isPlaying = !wasPlaying; emitChange();
    try {
      await player.togglePlay();
      Utils.log('Playback', OPT.isPlaying ? 'Play' : 'Pause');
    } catch (err) {
      OPT.isPlaying = wasPlaying; emitChange();
      Utils.error('Playback', 'Toggle failed', err);
      Utils.toast('Couldn\'t toggle playback.', 'warning');
    }
  }

  /* ════════════════════════════════════
     NEXT / PREVIOUS
  ════════════════════════════════════ */
  async function next() {
    if (!ensureReady()) return;
    const player = getPlayer();
    if (!player) return;
    try { await player.nextTrack(); Utils.log('Playback', 'Next track'); }
    catch (err) {
      Utils.error('Playback', 'Next failed', err);
      Utils.toast('Couldn\'t skip to the next track.', 'warning');
    }
  }

  async function previous() {
    if (!ensureReady()) return;
    const player = getPlayer();
    if (!player) return;
    try { await player.previousTrack(); Utils.log('Playback', 'Previous track'); }
    catch (err) {
      Utils.error('Playback', 'Previous failed', err);
      Utils.toast('Couldn\'t go to the previous track.', 'warning');
    }
  }

  /* ════════════════════════════════════
     SEEK
  ════════════════════════════════════ */
  async function seek(ms) {
    if (!ensureReady()) return;
    const player = getPlayer();
    if (!player || !Number.isFinite(ms)) return;
    try { await player.seek(Math.max(0, Math.round(ms))); }
    catch (err) {
      Utils.error('Playback', 'Seek failed', err);
      Utils.toast('Couldn\'t seek.', 'warning');
    }
  }

  /* ════════════════════════════════════
     VOLUME / MUTE
  ════════════════════════════════════ */
  async function setVolume(v) {
    const player = getPlayer();
    const vol = Math.max(0, Math.min(1, Number(v)));
    if (!player || !Number.isFinite(vol)) return;
    OPT.volume = vol;
    OPT.muted  = vol === 0;
    emitChange();
    try { await player.setVolume(vol); }
    catch (err) {
      Utils.error('Playback', 'Set volume failed', err);
      Utils.toast('Couldn\'t change volume.', 'warning');
    }
  }

  async function toggleMute() {
    if (OPT.muted) {
      const restore = OPT.volumeBeforeMute > 0 ? OPT.volumeBeforeMute : 0.5;
      await setVolume(restore);
      OPT.muted = false;
    } else {
      OPT.volumeBeforeMute = OPT.volume > 0 ? OPT.volume : 0.5;
      await setVolume(0);
    }
    emitChange();
  }

  /* ════════════════════════════════════
     SHUFFLE / REPEAT
  ════════════════════════════════════ */
  async function applyRepeat(mode) {
    if (!ensureReady() || OPT.pending.repeat || !REPEAT_CYCLE.includes(mode)) return;
    const API = window.NebulaSpotify.API;
    const deviceId = getDeviceId();
    if (!deviceId) return;

    const prev = OPT.repeat;
    OPT.repeat = mode;
    OPT.pending.repeat = true;
    emitChange();

    const r = await API.put(`/me/player/repeat?state=${mode}&device_id=${deviceId}`, null);
    OPT.pending.repeat = false;
    if (!r.ok) {
      OPT.repeat = prev;
      Utils.error('Playback', 'Repeat change failed', r.error);
      Utils.toast('Couldn\'t change repeat mode.', 'warning');
    } else {
      Utils.log('Playback', 'Repeat → ' + mode);
    }
    emitChange();
  }
  function cycleRepeat() {
    return applyRepeat(REPEAT_CYCLE[(REPEAT_CYCLE.indexOf(OPT.repeat) + 1) % REPEAT_CYCLE.length]);
  }
  function setRepeat(mode) { return applyRepeat(mode); }

  async function toggleShuffle() {
    if (!ensureReady() || OPT.pending.shuffle) return;
    const API = window.NebulaSpotify.API;
    const deviceId = getDeviceId();
    if (!deviceId) return;

    const prev = OPT.shuffle;
    OPT.shuffle = !prev;
    OPT.pending.shuffle = true;
    emitChange();

    const r = await API.put(`/me/player/shuffle?state=${OPT.shuffle}&device_id=${deviceId}`, null);
    OPT.pending.shuffle = false;
    if (!r.ok) {
      OPT.shuffle = prev;
      Utils.error('Playback', 'Shuffle toggle failed', r.error);
      Utils.toast('Couldn\'t change shuffle.', 'warning');
    } else {
      Utils.log('Playback', 'Shuffle → ' + OPT.shuffle);
    }
    emitChange();
  }

  /* ════════════════════════════════════
     SELECTION → PLAYBACK — shared by search.js and library.js. A track
     plays directly; album/playlist/artist start contextual playback
  ════════════════════════════════════ */
  async function playSelection(type, item) {
    if (type === 'track') {
      window.NebulaSpotify.playTrack?.(item.uri);
      return;
    }
    if (!ensureReady()) return;
    const API = window.NebulaSpotify.API;
    const deviceId = getDeviceId();
    if (!deviceId) { Utils.toast('Spotify isn\'t connected yet.', 'warning'); return; }
    const r = await API.put(`/me/player/play?device_id=${deviceId}`, { context_uri: item.uri });
    if (!r.ok) {
      Utils.error('Playback', 'Context play failed', r.error);
      Utils.toast('Couldn\'t play that.', 'warning');
    }
  }

  /* ════════════════════════════════════
     EXPORT
  ════════════════════════════════════ */
  window.NebulaSpotify.Playback = {
    play, pause, togglePlay,
    next, previous,
    seek,
    setVolume, toggleMute,
    toggleShuffle, setRepeat, cycleRepeat,
    playSelection,
    syncFromState,
    getState: () => ({ ...OPT, pending: { ...OPT.pending } }),
    onChange
  };
})();