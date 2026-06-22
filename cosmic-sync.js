/* ══════════════════════════════════════════
   NEBULABEAT — COSMIC SYNC v2
   Real Socket.io Multiplayer
   Falls back to BroadcastChannel (same device)
   ══════════════════════════════════════════ */
(function () {
  'use strict';

  const SERVER_URL = "https://nebulabeat-server-production.up.railway.app";

  const SYNC = {
    socket:   null,
    channel:  null,         // BroadcastChannel fallback
    roomCode: null,
    peerId:   'peer_' + Math.random().toString(36).slice(2, 8),

    rtcPeers: new Map(),     // peerId -> RTCPeerConnection
    rtcState: new Map(),     // peerId -> {polite, makingOffer, ignoreOffer}
    pendingIce: new Map(),   // peerId -> queued ICE candidates
    remoteAudioEls: new Map(), // peerId -> <audio> element
    audioActivePeers: new Set(),
    receiving: false,        // true while applying a remote event — prevents re-emit (echo loop)
    
    peers:    new Map(),
    enabled:  false,
    mode:     'none',       // 'socket' | 'broadcast' | 'none'
    hb:       null,
    cleanup:  null
  };

  /* ════════════════════════════════════
     SOCKET.IO MODE
  ════════════════════════════════════ */
  function joinSocket(code) {
    // Dynamically load Socket.io client if not already present
    function connect() {
      SYNC.socket = io(SERVER_URL, {
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000
});

      SYNC.socket.on('connect', () => {
        SYNC.socket.emit('join', { room: code, label: getMyLabel() });
        SYNC.mode = 'socket';
        updateBadge('LIVE');
        updateStatus(`Connected to room "${code}" ✦`);
      });

      SYNC.socket.on('room_state', ({ peers, count }) => {
        SYNC.peers.clear();
        peers.forEach(p => {
          SYNC.peers.set(p.id, { label: p.label });
          getPeerConnection(p.id); // I'm the new joiner — initiate to everyone already here
        });
        updatePeersUI();
        updateStatus(`🌌 ${count} explorer${count !== 1 ? 's' : ''} in "${code}"`);
      });

      SYNC.socket.on('peer_join', ({ id, label, count }) => {
        SYNC.peers.set(id, { label });
        getPeerConnection(id); // proactively ready in case we have audio to share
        updatePeersUI();
        updateStatus(`🌌 ${count} explorer${count !== 1 ? 's' : ''} in "${code}"`);
      });

      SYNC.socket.on('peer_leave', ({ id, count }) => {
        SYNC.peers.delete(id);
        closePeerConnection(id);
        updatePeersUI();
        updateStatus(`🌌 ${count} explorer${count !== 1 ? 's' : ''} in "${code}"`);
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
  updateStatus("Connection Failed: " + err.message);
  updateBadge("ERROR");
});

      SYNC.socket.on('disconnect', () => {
        // Without this, a reconnect reuses the now-dead RTCPeerConnections
        // (getPeerConnection sees the old map entry and never makes a fresh
        // one) — audio breaks permanently and dead connections pile up,
        // which is what was causing the growing visual lag too.
        closeAllPeerConnections();
        SYNC.peers.clear();
        updatePeersUI();
        updateBadge('OFFLINE');
        updateStatus('Disconnected from server.');
      });
    }

    if (window.io) { connect(); return; }

    // Load Socket.io client script
    const script = document.createElement('script');
    script.src = SERVER_URL + '/socket.io/socket.io.js';
    script.onload  = connect;
    script.onerror = () => {
      updateStatus('⚠ Could not load Socket.io. Falling back to same-device sync.');
      joinBroadcast(code);
    };
    document.head.appendChild(script);
  }

  /* ════════════════════════════════════
     BROADCASTCHANNEL FALLBACK MODE
     Works across tabs on the same device
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
        SYNC.peers.set(id, { lastSeen: Date.now(), label: msg.label || id });
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
    // Free public TURN relay — needed when peers are on different networks
    // (e.g. one on WiFi, one on mobile data). STUN alone often can't punch
    // through carrier-grade NAT, which is extremely common on Indian mobile networks.
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

  // Called whenever local audio becomes (re)available — re-share with everyone already in the room
  function shareAudioWithRoom() {
    if (!SYNC.enabled || SYNC.mode !== 'socket') return;
    SYNC.rtcPeers.forEach(pc => attachLocalTracks(pc));
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

  /* ════════════════════════════════════
     LIVE EMOJI REACTIONS
  ════════════════════════════════════ */
  function sendReaction(emoji) {
    receiveReaction({ emoji }); // instant local feedback — emit() doesn't echo to self
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
     JOIN / LEAVE
  ════════════════════════════════════ */
  function joinRoom(code) {
    leaveRoom();
    SYNC.roomCode = code.trim().toLowerCase().replace(/\s+/g, '_');
    SYNC.enabled  = true;
    SYNC.peers.clear();
    updateSyncBtn(true);
    updateShareUI(SYNC.roomCode);

    if (SERVER_URL) {
      joinSocket(SYNC.roomCode);
    } else {
      joinBroadcast(SYNC.roomCode);
    }
  }

  function leaveRoom() {
    closeAllPeerConnections();
    if (SYNC.mode === 'socket' && SYNC.socket) {
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
    SYNC.peers.clear();
    SYNC.enabled  = false;
    SYNC.mode     = 'none';
    SYNC.roomCode = null;
    updateSyncBtn(false);
    updateBadge('OFFLINE');
    updateStatus('Enter a room code to sync your galaxy.');
    updatePeersUI();
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

    // Helper: apply a remote event without re-emitting it (breaks the echo loop)
    const applyRemote = (fn) => {
      SYNC.receiving = true;
      try { fn(); } finally { SYNC.receiving = false; }
    };

    NP.explode      = (x,y)        => { orig.explode(x,y);             if (!SYNC.receiving) emit('explode',   { nx: x/innerWidth, ny: y/innerHeight }); };
    NP.setBlackHole = (x,y,active) => { orig.setBlackHole(x,y,active); if (!SYNC.receiving) emit('blackhole', { nx: x/innerWidth, ny: y/innerHeight, active }); };
    NP.hitBeat      = (str)        => { orig.hitBeat(str);              if (!SYNC.receiving) emit('beat',      { strength: str }); };
    NP.setTheme     = (t)          => { orig.setTheme(t);               if (!SYNC.receiving) emit('theme',     { theme: t }); };
    NP.setScene     = (s)          => { orig.setScene(s);               if (!SYNC.receiving) emit('scene',     { scene: s }); };

    // Store applyRemote on NP so receive handlers can use it even before patchParticles runs
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

  function updatePeersUI() {
    const el = document.getElementById('syncPeers');
    if (!el) return;
    if (!SYNC.peers.size) { el.innerHTML = ''; return; }
    let html = '<div class="sync-peers-title">In this room:</div>';
    html += `<div class="sync-peer-item sync-peer-self">👾 You (${getMyLabel()})</div>`;
    SYNC.peers.forEach((info, id) => {
      const live = SYNC.audioActivePeers.has(id) ? ' 🔊' : '';
      html += `<div class="sync-peer-item">🌟 ${info.label || 'Explorer'}${live}</div>`;
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
      const code = input?.value.trim();
      if (!code) { updateStatus('⚠ Enter a room code.'); return; }
      if (SYNC.enabled && SYNC.roomCode === code.toLowerCase().replace(/\s+/g,'_')) {
        leaveRoom();
        joinBtn.textContent = 'Join / Create';
      } else {
        joinRoom(code);
        joinBtn.textContent = 'Leave Room';
      }
    });

    input?.addEventListener('keydown', e => { if (e.key === 'Enter') joinBtn?.click(); });

    /* ── Copy invite link ── */
    const copyBtn  = document.getElementById('syncCopyBtn');
    const linkInput= document.getElementById('syncLinkInput');
    copyBtn?.addEventListener('click', () => {
      if (!linkInput?.value) return;
      const done = () => { copyBtn.textContent = 'Copied!'; setTimeout(() => copyBtn.textContent = 'Copy', 1500); };
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(linkInput.value).then(done).catch(() => {
          linkInput.select(); document.execCommand('copy'); done();
        });
      } else {
        linkInput.select(); document.execCommand('copy'); done();
      }
    });

    /* ── Reaction buttons ── */
    document.querySelectorAll('.reaction-btn').forEach(btn => {
      btn.addEventListener('click', () => sendReaction(btn.dataset.emoji));
    });

    /* ── Auto-join from a shared invite link (?room=code) ── */
    const sharedRoom = new URLSearchParams(location.search).get('room');
    if (sharedRoom) {
      input.value = sharedRoom;
      syncPanel?.classList.add('open');
      joinRoom(sharedRoom);
      if (joinBtn) joinBtn.textContent = 'Leave Room';
    }

    setTimeout(patchParticles, 300);
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
    getRoomCode: () => SYNC.roomCode,
    getMode:     () => SYNC.mode,
    sendReaction
  };
})();