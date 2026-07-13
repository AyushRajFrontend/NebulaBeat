/* ══════════════════════════════════════════
   NEBULABEAT — COSMIC SYNC v3
   Real Socket.io Multiplayer — Rooms · Roles · Host Authority
   Falls back to BroadcastChannel (same device) for presence/particles/
   reactions only — roles, playback sync, and queue are Socket.io-only.
   ══════════════════════════════════════════ */
(function () {
  'use strict';

  const SERVER_URL = "https://nebulabeat-server-production.up.railway.app";
  
  function getOrCreatePeerId() {
    try {
      const stored = localStorage.getItem('nebula_peer_id');
      if (stored) return stored;
      const fresh = 'peer_' + Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6);
      localStorage.setItem('nebula_peer_id', fresh);
      return fresh;
    } catch (e) {
      return 'peer_' + Math.random().toString(36).slice(2, 8);
    }
  }

  const SYNC = {
    socket:   null,
    channel:  null,          // BroadcastChannel fallback
    roomCode: null,
    displayCode: null,
    peerId:   getOrCreatePeerId(),
    role:     'listener',    // 'host' | 'moderator' | 'listener'
    hostClientId: null,
    locked:   false,

    rtcPeers: new Map(),     // clientId -> RTCPeerConnection
    rtcState: new Map(),     // clientId -> {polite, makingOffer, ignoreOffer}
    pendingIce: new Map(),   // clientId -> queued ICE candidates
    remoteAudioEls: new Map(), // clientId -> <audio> element
    audioActivePeers: new Set(),
    quality: new Map(),      // clientId -> 'good' | 'ok' | 'poor' | 'pending'
    qualityInterval: null,
    receiving: false,        // true while applying a remote event — prevents re-emit (echo loop)

    peers:    new Map(),     // clientId -> {clientId, label, role, online, joinedAt}
    playback: { trackTitle: '', isPlaying: false, currentTime: 0, duration: 0, volume: 0.8, updatedAt: 0 },
    playbackTicker: null,
    queue:    [],
    typingPeers: new Map(),  // clientId -> label
    typingTimers: new Map(),

    enabled:  false,
    mode:     'none',        // 'socket' | 'broadcast' | 'none'
    hb:       null,
    cleanup:  null
  };

  /* ════════════════════════════════════
     SMALL UTILITIES
  ════════════════════════════════════ */

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
    done();
  }

  function copyToClipboard(text, btn) {
    if (!text || !btn) return;
    const original = btn.textContent;
    const done = () => { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = original, 1500); };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }


  function detectSharedRoomCode() {
    const qp = new URLSearchParams(location.search).get('room');
    if (qp) return qp;
    const m = location.pathname.match(/\/room\/([^/?#]+)/i);
    return m ? decodeURIComponent(m[1]) : null;
  }

  /* ════════════════════════════════════
     SOCKET.IO MODE
  ════════════════════════════════════ */
  function joinSocket(rawCode) {
    function connect() {
      SYNC.socket = io(SERVER_URL, {
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000
      });

      SYNC.socket.on('connect', () => {
        SYNC.socket.emit('join', { room: rawCode, label: getMyLabel(), clientId: SYNC.peerId });
        SYNC.mode = 'socket';
        updateBadge('LIVE');
        updateStatus(`Connecting to "${rawCode || 'a new room'}"…`);
      });

      SYNC.socket.on('room_state', (state) => {
        SYNC.roomCode     = state.code;
        SYNC.displayCode  = state.displayCode;
        SYNC.role         = state.you.role;
        SYNC.hostClientId = state.hostClientId;
        SYNC.locked       = state.locked;
        SYNC.playback     = state.playback;
        SYNC.queue        = state.queue || [];

        
        const currentIds = new Set(state.peers.map(p => p.clientId));
        [...SYNC.rtcPeers.keys()].forEach(id => { if (!currentIds.has(id)) closePeerConnection(id); });

        SYNC.peers.clear();
        state.peers.forEach(p => {
          SYNC.peers.set(p.clientId, p);
          if (!p.online) return;
          const existing = SYNC.rtcPeers.get(p.clientId);
          if (existing && (existing.connectionState === 'failed' || existing.connectionState === 'closed')) {
            closePeerConnection(p.clientId);
          }
          getPeerConnection(p.clientId); 
        });

        const codeInput = document.getElementById('syncRoomInput');
        if (codeInput) codeInput.value = state.displayCode;

        updateShareUI(state.displayCode);
        updatePeersUI();
        updateHostControlsUI();
        updateQueueUI();
        const activityEl = document.getElementById('syncActivity');
        if (activityEl) activityEl.innerHTML = '';
        state.activity.forEach(renderActivityEntry);
        applyRemotePlayback(state.playback);
        restartPlaybackTicker();
        startQualityPolling();

        updateStatus(`🌌 ${state.count} explorer${state.count !== 1 ? 's' : ''} in "${state.displayCode}"`);
      });

      SYNC.socket.on('room_error', ({ message }) => {
        updateStatus(`⚠ ${message}`);
        updateBadge('ERROR');
        updateSyncBtn(false);
        SYNC.enabled = false;
      });

      SYNC.socket.on('peer_join', (p) => {
        SYNC.peers.set(p.clientId, p);
        getPeerConnection(p.clientId);
        updatePeersUI();
        updateStatus(`🌌 ${onlineTotal()} explorer${onlineTotal() !== 1 ? 's' : ''} in "${SYNC.displayCode}"`);
      });

      SYNC.socket.on('peer_update', (p) => {
        SYNC.peers.set(p.clientId, { ...SYNC.peers.get(p.clientId), ...p });
        updatePeersUI();
      });

      SYNC.socket.on('peer_leave', ({ clientId, count }) => {
        SYNC.peers.delete(clientId);
        closePeerConnection(clientId);
        SYNC.quality.delete(clientId);
        updatePeersUI();
        updateStatus(`🌌 ${count} explorer${count !== 1 ? 's' : ''} in "${SYNC.displayCode}"`);
      });

      SYNC.socket.on('host_changed', ({ hostClientId, hostLabel, auto }) => {
        SYNC.hostClientId = hostClientId;
        if (hostClientId === SYNC.peerId) SYNC.role = 'host';
        else if (SYNC.role === 'host') SYNC.role = 'moderator'; // we were host, stepped down
        updatePeersUI();
        updateHostControlsUI();
        updateStatus(auto ? `👑 ${hostLabel} is now hosting (previous host disconnected)` : `👑 ${hostLabel} is now the host`);
      });

      SYNC.socket.on('lock_changed', ({ locked }) => {
        SYNC.locked = locked;
        updateHostControlsUI();
      });

      SYNC.socket.on('kicked', ({ by }) => {
        updateStatus(`⛔ You were removed from the room${by ? ' by ' + by : ''}.`);
        leaveRoom();
      });

      SYNC.socket.on('typing', ({ clientId, label, isTyping }) => {
        clearTimeout(SYNC.typingTimers.get(clientId));
        if (isTyping) {
          SYNC.typingPeers.set(clientId, label);
          SYNC.typingTimers.set(clientId, setTimeout(() => { SYNC.typingPeers.delete(clientId); updateTypingUI(); }, 4000));
        } else {
          SYNC.typingPeers.delete(clientId);
        }
        updateTypingUI();
      });

      SYNC.socket.on('queue_update', (queue) => { SYNC.queue = queue; updateQueueUI(); });
      SYNC.socket.on('activity', entry => renderActivityEntry(entry));

      SYNC.socket.on('playback_update', (data) => {
        SYNC.playback = data;
        applyRemotePlayback(data);
        restartPlaybackTicker();
      });
      SYNC.socket.on('volume_update', ({ volume }) => {
        SYNC.playback.volume = volume;
        applyRemoteVolume(volume);
      });

      SYNC.socket.on('webrtc-offer',  handleRtcOffer);
      SYNC.socket.on('webrtc-answer', handleRtcAnswer);
      SYNC.socket.on('webrtc-ice',    handleRtcIce);

      SYNC.socket.on('explode',   d => {
        SYNC.receiving = true;
        window.NebulaParticles?.explode(d.nx * innerWidth, d.ny * innerHeight);
        SYNC.receiving = false;
      });
      SYNC.socket.on('blackhole', d => {
        SYNC.receiving = true;
        window.NebulaParticles?.setBlackHole(d.nx * innerWidth, d.ny * innerHeight, d.active);
        SYNC.receiving = false;
      });
      SYNC.socket.on('beat',      d => {
        SYNC.receiving = true;
        window.NebulaParticles?.hitBeat(d.strength);
        SYNC.receiving = false;
      });
      SYNC.socket.on('theme',     d => applyRemoteTheme(d.theme));
      SYNC.socket.on('scene',     d => applyRemoteScene(d.scene));
      SYNC.socket.on('reaction',  d => receiveReaction(d));

      SYNC.socket.on("connect_error", (err) => {
        console.error("Socket Error:", err);
        updateStatus("Connection failed: " + err.message);
        updateBadge("ERROR");
      });

      SYNC.socket.on('disconnect', () => {
        if (!SYNC.enabled) return; 
        updateBadge('OFFLINE');
        updateStatus('Reconnecting…');
        stopQualityPolling();
      });
    }

    if (window.io) { connect(); return; }

    
    const script = document.createElement('script');
    script.src = SERVER_URL + '/socket.io/socket.io.js';
    script.onload  = connect;
    script.onerror = () => {
      updateStatus('⚠ Could not load Socket.io. Falling back to same-device sync.');
      joinBroadcast(SYNC.roomCode || 'default');
    };
    document.head.appendChild(script);
  }

  function onlineTotal() {
    let n = 1; // self
    SYNC.peers.forEach(p => { if (p.online !== false) n++; });
    return n;
  }

  /* ════════════════════════════════════
     BROADCASTCHANNEL FALLBACK MODE
     Works across tabs on the same device. Presence/particles/reactions
     only — roles, playback sync, and the queue need a real server and
     aren't duplicated here.
  ════════════════════════════════════ */
  function joinBroadcast(code) {
    SYNC.channel = new BroadcastChannel('nebulabeat_' + code);
    SYNC.mode    = 'broadcast';

    SYNC.channel.onmessage = (e) => handleBroadcast(e.data);
    broadcastMsg({ type: 'JOIN', label: getMyLabel() });

    SYNC.hb = setInterval(() => broadcastMsg({ type: 'HB', label: getMyLabel() }), 3000);
    SYNC.cleanup = setInterval(() => {
      const now = Date.now();
      let changed = false;
      SYNC.peers.forEach((info, id) => {
        if (now - info.lastSeen > 8000) { SYNC.peers.delete(id); changed = true; }
      });
      if (changed) updatePeersUI();
    }, 6000);

    updateBadge('LOCAL');
    updateStatus(`Same-device sync active (room: "${code}")`);
  }

  function handleBroadcast(msg) {
    if (!msg || msg.from === SYNC.peerId) return;
    const id = msg.from;

    switch (msg.type) {
      case 'JOIN':
      case 'HB':
        SYNC.peers.set(id, {
          clientId: id, lastSeen: Date.now(), label: msg.label || id,
          role: 'listener', online: true, joinedAt: SYNC.peers.get(id)?.joinedAt || Date.now()
        });
        updatePeersUI();
        if (msg.type === 'JOIN') broadcastMsg({ type: 'HB', label: getMyLabel() });
        break;
      case 'LEAVE':  SYNC.peers.delete(id); updatePeersUI(); break;
      case 'EXPLODE':
        SYNC.receiving = true;
        window.NebulaParticles?.explode(msg.nx * innerWidth, msg.ny * innerHeight);
        SYNC.receiving = false;
        break;
      case 'BLACKHOLE':
        SYNC.receiving = true;
        window.NebulaParticles?.setBlackHole(msg.nx * innerWidth, msg.ny * innerHeight, msg.active);
        SYNC.receiving = false;
        break;
      case 'BEAT':
        SYNC.receiving = true;
        window.NebulaParticles?.hitBeat(msg.strength);
        SYNC.receiving = false;
        break;
      case 'THEME':      applyRemoteTheme(msg.theme); break;
      case 'SCENE':      applyRemoteScene(msg.scene); break;
      case 'REACTION':   receiveReaction(msg); break;
    }
  }

  function broadcastMsg(payload) {
    SYNC.channel?.postMessage({ ...payload, from: SYNC.peerId });
  }

  /* ════════════════════════════════════
     EMIT — send to room
  ════════════════════════════════════ */
  function emit(event, data) {
    if (!SYNC.enabled) return;
    if (SYNC.mode === 'socket' && SYNC.socket?.connected) {
      SYNC.socket.emit(event, data);
    } else if (SYNC.mode === 'broadcast') {
      broadcastMsg({ type: event.toUpperCase(), ...data });
    }
  }

  /* ════════════════════════════════════
     WEBRTC AUDIO SHARING
  ════════════════════════════════════ */
  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
  ];

  function getLocalStream() {
    return window.NebulaAudio?.recordStream || null;
  }

  function attachLocalTracks(pc) {
    const stream = getLocalStream();
    if (!stream) return;
    const already = pc.getSenders().map(s => s.track);
    stream.getAudioTracks().forEach(track => {
      if (!already.includes(track)) pc.addTrack(track, stream);
    });
  }

  function getPeerConnection(peerId) {
    if (SYNC.rtcPeers.has(peerId)) return SYNC.rtcPeers.get(peerId);

    const polite = SYNC.peerId > peerId; // deterministic on both ends
    const state  = { polite, makingOffer: false, ignoreOffer: false };
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    SYNC.rtcPeers.set(peerId, pc);
    SYNC.rtcState.set(peerId, state);
    SYNC.pendingIce.set(peerId, []);

    pc.onicecandidate = (e) => {
      if (e.candidate) SYNC.socket?.emit('webrtc-ice', { to: peerId, candidate: e.candidate });
    };

    pc.ontrack = (e) => {
      let audioEl = SYNC.remoteAudioEls.get(peerId);
      if (!audioEl) {
        audioEl = new Audio();
        audioEl.autoplay = true;
        SYNC.remoteAudioEls.set(peerId, audioEl);
      }
      audioEl.srcObject = e.streams[0];
      const tryPlay = () => audioEl.play().catch(() => {
        const resume = () => { audioEl.play().catch(()=>{}); document.removeEventListener('click', resume); };
        document.addEventListener('click', resume, { once: true });
      });
      tryPlay();
      SYNC.audioActivePeers.add(peerId);
      updatePeersUI();
      e.track.onended = () => { SYNC.audioActivePeers.delete(peerId); updatePeersUI(); };
    };

    pc.onnegotiationneeded = async () => {
      try {
        state.makingOffer = true;
        const offer = await pc.createOffer();
        if (pc.signalingState !== 'stable') return;
        await pc.setLocalDescription(offer);
        SYNC.socket?.emit('webrtc-offer', { to: peerId, offer: pc.localDescription });
      } catch (err) {
        console.warn('NebulaSync: offer failed', err);
      } finally {
        state.makingOffer = false;
      }
    };


    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        try { pc.restartIce(); } catch (e) {}
      }
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        if (SYNC.audioActivePeers.delete(peerId)) updatePeersUI();
      }
    };

    attachLocalTracks(pc);
    return pc;
  }

  function closePeerConnection(peerId) {
    const pc = SYNC.rtcPeers.get(peerId);
    if (pc) { try { pc.close(); } catch (e) {} SYNC.rtcPeers.delete(peerId); }
    const audioEl = SYNC.remoteAudioEls.get(peerId);
    if (audioEl) { audioEl.pause(); audioEl.srcObject = null; SYNC.remoteAudioEls.delete(peerId); }
    SYNC.rtcState.delete(peerId);
    SYNC.pendingIce.delete(peerId);
    if (SYNC.audioActivePeers.delete(peerId)) updatePeersUI();
  }

  function closeAllPeerConnections() {
    [...SYNC.rtcPeers.keys()].forEach(closePeerConnection);
  }

  function flushPendingIce(peerId) {
    const pc = SYNC.rtcPeers.get(peerId);
    const q  = SYNC.pendingIce.get(peerId);
    if (!pc || !q || !q.length) return;
    q.forEach(c => pc.addIceCandidate(c).catch(() => {}));
    SYNC.pendingIce.set(peerId, []);
  }

  async function handleRtcOffer({ from, offer }) {
    const pc    = getPeerConnection(from);
    const state = SYNC.rtcState.get(from);
    const collision = state.makingOffer || pc.signalingState !== 'stable';
    state.ignoreOffer = !state.polite && collision;
    if (state.ignoreOffer) return;

    await pc.setRemoteDescription(offer);
    attachLocalTracks(pc);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    SYNC.socket?.emit('webrtc-answer', { to: from, answer: pc.localDescription });
    flushPendingIce(from);
  }

  async function handleRtcAnswer({ from, answer }) {
    const pc = SYNC.rtcPeers.get(from);
    if (!pc) return;
    await pc.setRemoteDescription(answer);
    flushPendingIce(from);
  }

  async function handleRtcIce({ from, candidate }) {
    if (!candidate) return;
    const pc = getPeerConnection(from);
    if (pc.remoteDescription) {
      try { await pc.addIceCandidate(candidate); } catch (e) {}
    } else {
      const q = SYNC.pendingIce.get(from) || [];
      q.push(candidate);
      SYNC.pendingIce.set(from, q);
    }
  }

  
  function shareAudioWithRoom() {
    if (!SYNC.enabled || SYNC.mode !== 'socket') return;
    SYNC.rtcPeers.forEach(pc => attachLocalTracks(pc));
    if (isPlaybackHost()) broadcastTrackChange();
  }
  window.addEventListener('nebula:audio-source-ready', shareAudioWithRoom);

  /* ════════════════════════════════════
     REMOTE APPLY HELPERS
  ════════════════════════════════════ */
    function applyRemoteTheme(theme) {
    if (!theme || !window.NebulaParticles) return;
    SYNC.receiving = true;
    window.NebulaParticles.setTheme(theme);
    SYNC.receiving = false;
    document.body.setAttribute('data-theme', theme);
    document.querySelectorAll('.theme-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.theme === theme));
  }

  function applyRemoteScene(scene) {
    if (!scene || !window.NebulaParticles) return;
    SYNC.receiving = true;
    window.NebulaParticles.setScene(scene);
    SYNC.receiving = false;
    document.querySelectorAll('.scene-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.scene === scene));
  }


  function applyRemotePlayback(data, tick) {
    if (SYNC.role === 'host' || !data) return;
    SYNC.receiving = true;
    try {
      window.NebulaUI?.applyRemotePlayback?.({
        isPlaying: data.isPlaying,
        currentTime: data.currentTime,
        duration: data.duration,
        trackTitle: data.trackTitle,
        tick: !!tick
      });
    } finally {
      SYNC.receiving = false;
    }
  }

  function applyRemoteVolume(volume) {
    if (SYNC.role === 'host') return;
    const volSlider = document.getElementById('volSlider');
    if (!volSlider) return;
    SYNC.receiving = true;
    volSlider.value = Math.round(volume * 100);
    volSlider.dispatchEvent(new Event('input')); 
    SYNC.receiving = false;
  }

  
  function restartPlaybackTicker() {
    clearInterval(SYNC.playbackTicker);
    SYNC.playbackTicker = null;
    if (SYNC.role === 'host' || !SYNC.playback.isPlaying) return;
    SYNC.playbackTicker = setInterval(() => {
      const elapsed = (Date.now() - SYNC.playback.updatedAt) / 1000;
      const estimated = SYNC.playback.duration
        ? Math.min(SYNC.playback.currentTime + elapsed, SYNC.playback.duration)
        : SYNC.playback.currentTime + elapsed;
      applyRemotePlayback({ ...SYNC.playback, currentTime: estimated }, true);
    }, 1000);
  }

  /* ════════════════════════════════════
     LIVE EMOJI REACTIONS
  ════════════════════════════════════ */
  function sendReaction(emoji) {
    receiveReaction({ emoji });
    emit('reaction', { emoji });
  }

  function receiveReaction({ emoji }) {
    spawnReactionFloat(emoji || '✨');
    const x = window.innerWidth  * (0.32 + Math.random() * 0.36);
    const y = window.innerHeight * (0.32 + Math.random() * 0.28);
    window.NebulaParticles?.burst(x, y);
  }

  function spawnReactionFloat(emoji) {
    const el = document.createElement('div');
    el.className = 'reaction-float';
    el.textContent = emoji;
    el.style.left = (28 + Math.random() * 44) + 'vw';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  /* ════════════════════════════════════
     NETWORK QUALITY — reuses the WebRTC mesh that
     already exists between every peer pair
  ════════════════════════════════════ */
  function startQualityPolling() {
    stopQualityPolling();
    if (SYNC.mode !== 'socket') return;
    SYNC.qualityInterval = setInterval(async () => {
      let changed = false;
      for (const [id, pc] of SYNC.rtcPeers) {
        let rtt = null;
        try {
          const stats = await pc.getStats();
          stats.forEach(r => {
            if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.currentRoundTripTime != null) {
              rtt = r.currentRoundTripTime;
            }
          });
        } catch (e) {}

        const level = rtt == null ? 'pending' : rtt < 0.15 ? 'good' : rtt < 0.4 ? 'ok' : 'poor';
        if (SYNC.quality.get(id) !== level) changed = true;
        SYNC.quality.set(id, level);
      }
      if (changed) updatePeersUI();
    }, 4000);
  }

  function stopQualityPolling() {
    clearInterval(SYNC.qualityInterval);
    SYNC.qualityInterval = null;
  }

  /* ════════════════════════════════════
     PLAYBACK + VOLUME SYNC (host → room)
  ════════════════════════════════════ */
  function isPlaybackHost() {
    return SYNC.enabled && SYNC.mode === 'socket' && SYNC.role === 'host';
  }

  function broadcastPlaybackState(action) {
    const audioEl = window.NebulaAudio?.el;
    SYNC.socket?.emit('playback_control', { action, currentTime: audioEl?.currentTime || 0 });
  }

  function broadcastTrackChange() {
    const audioEl = window.NebulaAudio?.el;
    const title = document.getElementById('playerTitle')?.textContent || '';
    SYNC.socket?.emit('playback_control', {
      action: 'track',
      trackTitle: title,
      duration: audioEl?.duration || 0,
      currentTime: 0,
      isPlaying: window.NebulaAudio?.isPlaying?.() || false
    });
  }

  function bindPlaybackHooks() {
    const audioEl = window.NebulaAudio?.el;
    if (audioEl) {
      audioEl.addEventListener('play',   () => { if (!SYNC.receiving && isPlaybackHost()) broadcastPlaybackState('play'); });
      audioEl.addEventListener('pause',  () => { if (!SYNC.receiving && isPlaybackHost()) broadcastPlaybackState('pause'); });
      audioEl.addEventListener('seeked', () => { if (!SYNC.receiving && isPlaybackHost()) broadcastPlaybackState('seek'); });
    }

    const volSlider = document.getElementById('volSlider');
    volSlider?.addEventListener('input', () => {
      if (SYNC.receiving || !isPlaybackHost()) return;
      const v = Number(volSlider.value) / 100;
      SYNC.socket?.emit('volume_control', { volume: v });
    });
  }

  /* ════════════════════════════════════
     TYPING INDICATOR — tied to the queue-suggestion
     input, since there's no chat box to attach it to
  ════════════════════════════════════ */
  function updateTypingUI() {
    const el = document.getElementById('syncTyping');
    if (!el) return;
    const names = [...SYNC.typingPeers.values()];
    if (!names.length) { el.textContent = ''; el.style.display = 'none'; return; }
    el.textContent = names.length === 1 ? `${names[0]} is typing…` : `${names.length} people are typing…`;
    el.style.display = 'block';
  }

  let typingDebounce = null;
    function bindQueueInput() {
    const input  = document.getElementById('syncQueueInput');
    const addBtn = document.getElementById('syncQueueAddBtn');
    if (!input) return;

    input.addEventListener('input', () => {
      if (!SYNC.enabled || SYNC.mode !== 'socket') return;
      SYNC.socket.emit('typing', { isTyping: true });
      clearTimeout(typingDebounce);
      typingDebounce = setTimeout(() => SYNC.socket?.emit('typing', { isTyping: false }), 2500);
    });

    const submit = () => {
      const val = input.value.trim();
      if (!val || !SYNC.enabled || SYNC.mode !== 'socket') return;
      SYNC.socket.emit('queue_add', { title: val });
      input.value = '';
      clearTimeout(typingDebounce);
      SYNC.socket.emit('typing', { isTyping: false });
    };
    addBtn?.addEventListener('click', submit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  }

  /* ════════════════════════════════════
     ACTIVITY FEED
  ════════════════════════════════════ */
  const ACTIVITY_ICONS = { join: '🌟', rejoin: '↩️', leave: '👋', kick: '🚫', lock: '🔒', host_transfer: '👑', role_change: '🛡️', queue_add: '🎵' };

  function activityText(entry) {
    const label = entry.label;
    switch (entry.type) {
      case 'join':          return `${label} joined the galaxy`;
      case 'rejoin':        return `${label} reconnected`;
      case 'leave':         return `${label} left`;
      case 'kick':          return `${label} was removed`;
      case 'lock':          return entry.meta?.locked ? `Room locked by ${label}` : `Room unlocked by ${label}`;
      case 'host_transfer': return entry.meta?.auto ? `${label} is now hosting` : `${label} is now the host`;
      case 'role_change':   return `${label} is now a ${entry.meta?.role}`;
      case 'queue_add':     return `${label} suggested "${entry.meta?.title || ''}"`;
      default:               return label;
    }
  }

  function renderActivityEntry(entry) {
    const el = document.getElementById('syncActivity');
    if (!el) return;
    const div = document.createElement('div');
    div.className = 'activity-item';
    div.textContent = `${ACTIVITY_ICONS[entry.type] || '•'} ${activityText(entry)}`; // textContent — inherently safe, no escaping needed
    el.prepend(div);
    while (el.children.length > 20) el.lastChild.remove();
  }

  /* ════════════════════════════════════
     SHARED QUEUE (foundation) — track name
     suggestions, not file transfer
  ════════════════════════════════════ */
  function updateQueueUI() {
    const el = document.getElementById('syncQueueList');
    if (!el) return;
    if (!SYNC.queue.length) {
      el.innerHTML = '<div class="queue-empty">No suggestions yet.</div>';
      return;
    }
    const canModerate = SYNC.role === 'host' || SYNC.role === 'moderator';
    el.innerHTML = SYNC.queue.map(q => {
      const mine = q.addedBy === SYNC.peerId;
      const removable = canModerate || mine;
      return `<div class="queue-item">
        <span class="queue-title">${escapeHtml(q.title)}</span>
        <span class="queue-by">— ${escapeHtml(q.addedByLabel)}</span>
        ${removable ? `<button class="queue-remove" data-id="${q.id}" title="Remove">✕</button>` : ''}
      </div>`;
    }).join('');
  }

  /* ════════════════════════════════════
     ROOM SHARE — link + QR code
  ════════════════════════════════════ */
  function updateShareUI(code) {
    const wrap = document.getElementById('syncShare');
    const link = document.getElementById('syncLinkInput');
    const qr   = document.getElementById('syncQrImg');
    if (!wrap || !link) return;
    const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(code)}`;
    link.value = url;
    if (qr) qr.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=8&data=${encodeURIComponent(url)}`;
    wrap.style.display = 'flex';
  }

  function hideShareUI() {
    const wrap = document.getElementById('syncShare');
    if (wrap) wrap.style.display = 'none';
  }

  /* ════════════════════════════════════
     HOST CONTROLS
  ════════════════════════════════════ */
  function updateHostControlsUI() {
    const bar = document.getElementById('syncHostControls');
    if (!bar) return;
    bar.style.display = SYNC.role === 'host' ? 'flex' : 'none';
    const lockBtn = document.getElementById('syncLockBtn');
    if (lockBtn) {
      lockBtn.textContent = SYNC.locked ? '🔒 Locked' : '🔓 Lock Room';
      lockBtn.classList.toggle('active', SYNC.locked);
    }
  }

  /* ════════════════════════════════════
     JOIN / LEAVE
  ════════════════════════════════════ */
  function joinRoom(code) {
    leaveRoom();
    const raw = (code || '').trim();
    SYNC.roomCode = raw.toLowerCase().replace(/\s+/g, '_') || null;
    SYNC.enabled  = true;
    SYNC.role     = 'listener'; 
    SYNC.peers.clear();
    updateSyncBtn(true);

    if (SERVER_URL) {
      joinSocket(raw); 
    } else {
      joinBroadcast(SYNC.roomCode || 'default');
    }
  }

  function leaveRoom() {
    stopQualityPolling();
    clearInterval(SYNC.playbackTicker);
    SYNC.playbackTicker = null;
    closeAllPeerConnections();

    if (SYNC.mode === 'socket' && SYNC.socket) {
      if (SYNC.socket.connected) SYNC.socket.emit('leave'); 
      SYNC.socket.disconnect();
      SYNC.socket = null;
    }
    if (SYNC.mode === 'broadcast' && SYNC.channel) {
      broadcastMsg({ type: 'LEAVE' });
      SYNC.channel.close();
      SYNC.channel = null;
    }

    clearInterval(SYNC.hb);
    clearInterval(SYNC.cleanup);
    SYNC.typingTimers.forEach(t => clearTimeout(t));
    SYNC.typingTimers.clear();
    SYNC.typingPeers.clear();
    SYNC.peers.clear();
    SYNC.quality.clear();
    SYNC.queue = [];

    SYNC.enabled      = false;
    SYNC.mode         = 'none';
    SYNC.roomCode     = null;
    SYNC.displayCode  = null;
    SYNC.role         = 'listener';
    SYNC.hostClientId = null;
    SYNC.locked       = false;

    updateSyncBtn(false);
    updateBadge('OFFLINE');
    updateStatus('Enter a room code to sync your galaxy.');
    updatePeersUI();
    updateHostControlsUI();
    updateQueueUI();
    updateTypingUI();
    const activityEl = document.getElementById('syncActivity');
    if (activityEl) activityEl.innerHTML = '';
    hideShareUI();
  }

  /* ════════════════════════════════════
     PATCH NebulaParticles to auto-emit
  ════════════════════════════════════ */
  function patchParticles() {
    const NP = window.NebulaParticles;
    if (!NP || NP._syncPatched) return;
    NP._syncPatched = true;

    const orig = {
          explode:     NP.explode.bind(NP),
      setBlackHole:NP.setBlackHole.bind(NP),
      hitBeat:     NP.hitBeat.bind(NP),
      setTheme:    NP.setTheme.bind(NP),
      setScene:    NP.setScene.bind(NP)
    };

    const applyRemote = (fn) => {
      SYNC.receiving = true;
      try { fn(); } finally { SYNC.receiving = false; }
    };

    NP.explode      = (x,y)        => { orig.explode(x,y);             if (!SYNC.receiving) emit('explode',   { nx: x/innerWidth, ny: y/innerHeight }); };
    NP.setBlackHole = (x,y,active) => { orig.setBlackHole(x,y,active); if (!SYNC.receiving) emit('blackhole', { nx: x/innerWidth, ny: y/innerHeight, active }); };
    NP.hitBeat      = (str)        => { orig.hitBeat(str);              if (!SYNC.receiving) emit('beat',      { strength: str }); };
    NP.setTheme     = (t)          => { orig.setTheme(t);               if (!SYNC.receiving) emit('theme',     { theme: t }); };
    NP.setScene     = (s)          => { orig.setScene(s);               if (!SYNC.receiving) emit('scene',     { scene: s }); };


    NP._applyRemote = applyRemote;
  }

  /* ════════════════════════════════════
     UI HELPERS
  ════════════════════════════════════ */
  function getMyLabel() {
    return 'Explorer ' + SYNC.peerId.slice(-4).toUpperCase();
  }

  function updateBadge(text) {
    const el = document.getElementById('syncBadge');
    if (!el) return;
    el.textContent = text;
    el.className = 'sync-badge' +
      (text === 'LIVE'  ? ' sync-live'  : '') +
      (text === 'LOCAL' ? ' sync-local' : '') +
      (text === 'ERROR' ? ' sync-error' : '');
  }

  function updateStatus(text) {
    const el = document.getElementById('syncStatus');
    if (el) el.textContent = text;
  }

  function updateSyncBtn(connected) {
    document.getElementById('syncBtn')?.classList.toggle('sync-active', connected);
  }

  function roleBadge(role) {
    if (role === 'host')      return '<span class="role-badge role-host" title="Host">👑</span>';
    if (role === 'moderator') return '<span class="role-badge role-mod" title="Moderator">🛡️</span>';
    return '';
  }

  function qualityDot(clientId) {
    const q = SYNC.quality.get(clientId) || 'pending';
    return `<span class="quality-dot quality-${q}" title="Connection: ${q}"></span>`;
  }

  function updatePeersUI() {
    const el = document.getElementById('syncPeers');
    if (!el) return;

    const myRole = SYNC.role;
    const isHost = myRole === 'host';
    const canModerate = isHost || myRole === 'moderator';

    let html = `<div class="sync-peers-title">In this room (${onlineTotal()}):</div>`;
    html += `<div class="sync-peer-item sync-peer-self">
                <span class="peer-presence online"></span>
                ${roleBadge(myRole)}
                <span class="peer-label">You (${escapeHtml(getMyLabel())})</span>
              </div>`;

    [...SYNC.peers.entries()]
      .sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0))
      .forEach(([id, info]) => {
        const live = SYNC.audioActivePeers.has(id) ? ' 🔊' : '';
        const away = info.online === false;
        const actions = [];

        if (isHost && info.role !== 'host') {
          actions.push(`<button class="peer-action" data-action="transfer" data-id="${id}" title="Make host">⇪</button>`);
          actions.push(info.role === 'moderator'
            ? `<button class="peer-action" data-action="demote" data-id="${id}" title="Remove moderator">▾</button>`
            : `<button class="peer-action" data-action="promote" data-id="${id}" title="Make moderator">▴</button>`);
        }
        if (canModerate && info.role !== 'host' && !(myRole === 'moderator' && info.role === 'moderator')) {
          actions.push(`<button class="peer-action peer-action-danger" data-action="kick" data-id="${id}" title="Remove from room">✕</button>`);
        }

        html += `<div class="sync-peer-item${away ? ' sync-peer-away' : ''}">
                    <span class="peer-presence ${away ? 'away' : 'online'}"></span>
                    ${roleBadge(info.role)}
                    ${!away ? qualityDot(id) : ''}
                    <span class="peer-label">${escapeHtml(info.label || 'Explorer')}${live}</span>
                    <span class="peer-actions">${actions.join('')}</span>
                  </div>`;
      });

    el.innerHTML = html;
  }

  /* ════════════════════════════════════
     BIND UI
  ════════════════════════════════════ */
  function bindUI() {
    const syncBtn   = document.getElementById('syncBtn');
    const syncPanel = document.getElementById('syncPanel');
    const syncClose = document.getElementById('syncClose');
    const joinBtn   = document.getElementById('syncJoinBtn');
    const input     = document.getElementById('syncRoomInput');
    const modeTag   = document.getElementById('syncModeTag');

    if (modeTag) modeTag.textContent = SERVER_URL ? '🌐 Socket.io' : '📡 Same-device';

    syncBtn?.addEventListener('click', () => syncPanel?.classList.toggle('open'));
    syncClose?.addEventListener('click', () => syncPanel?.classList.remove('open'));

    joinBtn?.addEventListener('click', () => {
      const raw = (input?.value || '').trim();
      const normalized = raw.toLowerCase().replace(/\s+/g, '_');
      if (SYNC.enabled && raw && SYNC.roomCode === normalized) {
        leaveRoom();
        joinBtn.textContent = 'Join / Create';
      } else {
        joinRoom(raw); 
        joinBtn.textContent = 'Leave Room';
      }
    });

    input?.addEventListener('keydown', e => { if (e.key === 'Enter') joinBtn?.click(); });

    /* ── Copy invite link / room code ── */
    const copyBtn      = document.getElementById('syncCopyBtn');
    const copyCodeBtn  = document.getElementById('syncCopyCodeBtn');
    const linkInput     = document.getElementById('syncLinkInput');
    copyBtn?.addEventListener('click', () => copyToClipboard(linkInput?.value, copyBtn));
    copyCodeBtn?.addEventListener('click', () => copyToClipboard(SYNC.displayCode || SYNC.roomCode, copyCodeBtn));

    /* ── Host controls ── */
    document.getElementById('syncLockBtn')?.addEventListener('click', () => {
      SYNC.socket?.emit('lock_room', { locked: !SYNC.locked });
    });

    document.getElementById('syncPeers')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.peer-action');
      if (!btn || !SYNC.socket) return;
      const id = btn.dataset.id;
      switch (btn.dataset.action) {
        case 'kick':     if (confirm('Remove this person from the room?')) SYNC.socket.emit('kick_peer', { targetClientId: id }); break;
        case 'transfer': if (confirm('Make this person the host? You will become a moderator.')) SYNC.socket.emit('transfer_host', { targetClientId: id }); break;
        case 'promote':  SYNC.socket.emit('set_role', { targetClientId: id, role: 'moderator' }); break;
        case 'demote':   SYNC.socket.emit('set_role', { targetClientId: id, role: 'listener' }); break;
      }
    });
    document.getElementById('syncQueueList')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.queue-remove');
      if (!btn || !SYNC.socket) return;
      SYNC.socket.emit('queue_remove', { queueId: btn.dataset.id });
    });
    bindQueueInput();

    /* ── Reaction buttons ── */
    document.querySelectorAll('.reaction-btn').forEach(btn => {
      btn.addEventListener('click', () => sendReaction(btn.dataset.emoji));
    });

    const sharedRoom = detectSharedRoomCode();
    if (sharedRoom) {
      if (input) input.value = sharedRoom;
      syncPanel?.classList.add('open');
      joinRoom(sharedRoom);
      if (joinBtn) joinBtn.textContent = 'Leave Room';
    }

    setTimeout(patchParticles, 300);
    setTimeout(bindPlaybackHooks, 300);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindUI);
  } else {
    bindUI();
  }

  window.addEventListener('beforeunload', () => { if (SYNC.enabled) leaveRoom(); });

  window.NebulaSync = {
    join: joinRoom, leave: leaveRoom,
    isEnabled:   () => SYNC.enabled,
    getRoomCode: () => SYNC.displayCode || SYNC.roomCode,
    getMode:     () => SYNC.mode,
    getRole:     () => SYNC.role,
    getQueue:    () => SYNC.queue.slice(),
    sendReaction
  };
})();