/* ══════════════════════════════════════════
   NEBULABEAT — AUDIO ENGINE
   Web Audio API · FFT · Beat detection
   ══════════════════════════════════════════ */
(function () {
  'use strict';

  const A = {
    ctx: null,
    analyser: null,
    freq: null,
    timeData: null,
    source: null,        // current source node (media element or mic)
    audioEl: null,       // HTMLAudioElement for file/demo
    mode: 'idle',        // 'file' | 'mic' | 'demo' | 'idle'
    running: false,

    
  // recording audio stream
  recordDestination: null,

    // beat detection
    bassHistory: [],
    lastBeat: 0,

    // smoothed bands
    sBass: 0, sMid: 0, sTreble: 0, sLevel: 0
  };

  function ensureCtx() {
    if (!A.ctx) {
      A.ctx = new (window.AudioContext || window.webkitAudioContext)();
      A.analyser = A.ctx.createAnalyser();
      A.analyser.fftSize = 2048;
      A.analyser.smoothingTimeConstant = 0.82;
      A.freq = new Uint8Array(A.analyser.frequencyBinCount);
      A.timeData = new Uint8Array(A.analyser.frequencyBinCount);

      A.recordDestination =
      A.ctx.createMediaStreamDestination();
      
      A.analyser.connect(A.ctx.destination);
    }
    if (A.ctx.state === 'suspended') A.ctx.resume();
  }

  function disconnectSource() {
    if (A.source) {
      try { A.source.disconnect(); } catch (e) {}
      A.source = null;
    }
    if (A.micStream) {
      A.micStream.getTracks().forEach(t => t.stop());
      A.micStream = null;
    }
    if (A.audioEl) {
      A.audioEl.pause();
    }
  }

  // ── Analyse one frame ──
  function analyse() {
    if (!A.running) return;
    A.analyser.getByteFrequencyData(A.freq);

    const bins = A.freq.length;
    // frequency ranges (rough): bass 0-6%, mid 6-30%, treble 30-100%
    const bassEnd = Math.floor(bins * 0.06);
    const midEnd = Math.floor(bins * 0.30);

    let bass = 0, mid = 0, treble = 0;
    for (let i = 0; i < bassEnd; i++) bass += A.freq[i];
    for (let i = bassEnd; i < midEnd; i++) mid += A.freq[i];
    for (let i = midEnd; i < bins; i++) treble += A.freq[i];

    bass /= (bassEnd * 255) || 1;
    mid /= ((midEnd - bassEnd) * 255) || 1;
    treble /= ((bins - midEnd) * 255) || 1;
    const level = (bass + mid + treble) / 3;

    // smoothing
    A.sBass += (bass - A.sBass) * 0.35;
    A.sMid += (mid - A.sMid) * 0.35;
    A.sTreble += (treble - A.sTreble) * 0.35;
    A.sLevel += (level - A.sLevel) * 0.3;

    // push to visualizer
    if (window.NebulaParticles) {
      window.NebulaParticles.update({
        bass: A.sBass, mid: A.sMid, treble: A.sTreble, level: A.sLevel
      });
    }

    // ── AI Genre Theme Detector ──
    A.genreFrames = (A.genreFrames || 0) + 1;
    if (A.genreFrames % 90 === 0 && window.NebulaGenreAI) { // every ~1.5s
      window.NebulaGenreAI.analyse(A.sBass, A.sMid, A.sTreble);
    }

    // ── Beat detection (energy vs rolling average) ──
    A.bassHistory.push(bass);
    if (A.bassHistory.length > 43) A.bassHistory.shift();
    const avg = A.bassHistory.reduce((s, v) => s + v, 0) / A.bassHistory.length;
    const now = performance.now();
    if (bass > avg * 1.35 && bass > 0.18 && now - A.lastBeat > 220) {
      A.lastBeat = now;
      const strength = Math.min(1.4, 0.7 + (bass - avg));
      if (window.NebulaParticles) window.NebulaParticles.hitBeat(strength);
      flashBeat();
      pulseMiniBars(A.sBass, A.sMid, A.sTreble);
    } else {
      pulseMiniBars(A.sBass, A.sMid, A.sTreble);
    }

    requestAnimationFrame(analyse);
  }

  // ── Beat flash element ──
  const flashEl = document.getElementById('beatFlash');
  let flashTimer = null;
  function flashBeat() {
    if (!flashEl) return;
    flashEl.classList.add('on');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => flashEl.classList.remove('on'), 70);
  }

  // ── Mini bars in player ──
  const miniBars = document.getElementById('miniBars');
  const miniSpans = miniBars ? miniBars.querySelectorAll('span') : [];
  function pulseMiniBars(b, m, t) {
    if (!miniSpans.length) return;
    const vals = [b, (b + m) / 2, m, (m + t) / 2, t];
    for (let i = 0; i < miniSpans.length; i++) {
      const h = 4 + vals[i] * 22;
      miniSpans[i].style.height = h.toFixed(1) + 'px';
    }
  }

  // ── Start analysis loop ──
  function start() {
    if (!A.running) {
      A.running = true;
      requestAnimationFrame(analyse);
    }
  }
  function stop() {
    A.running = false;
  }

  // ════ Public API ════
  window.NebulaAudio = {
    get recordStream() {
  return A.recordDestination
    ? A.recordDestination.stream
    : null;
},
    get el() { return A.audioEl; },
    get mode() { return A.mode; },

    // Load an audio File object
    loadFile(file, onReady) {
      ensureCtx();
      disconnectSource();
      this._teardownEl();

      const url = URL.createObjectURL(file);
      const el = new Audio(url);
      el.crossOrigin = 'anonymous';
      A.audioEl = el;
      A.mode = 'file';

      el.addEventListener('loadedmetadata', () => {
        if (onReady) onReady(el);
      });
      el.addEventListener('ended', () => {
        if (window.NebulaUI) window.NebulaUI.onEnded();
      });

      A.source = A.ctx.createMediaElementSource(el);
      A.source.connect(A.analyser);
      A.source.connect(A.recordDestination);
      start();
      // Let CosmicSync know a shareable audio stream now exists
      window.dispatchEvent(new CustomEvent('nebula:audio-source-ready'));
      return el;
    },

    // Demo mode: synth tone + rhythm via oscillators
    startDemo() {
      ensureCtx();
      disconnectSource();
      this._teardownEl();
      A.mode = 'demo';

      const master = A.ctx.createGain();
      master.gain.value = 0.0001; // near-silent, but drives analyser
      master.connect(A.analyser);

      const demo = { nodes: [], stopped: false };

      // bass pulse
      const bassOsc = A.ctx.createOscillator();
      const bassGain = A.ctx.createGain();
      bassOsc.frequency.value = 55;
      bassOsc.type = 'sine';
      bassOsc.connect(bassGain); bassGain.connect(master);

      // mid pad
      const padOsc = A.ctx.createOscillator();
      const padGain = A.ctx.createGain();
      padOsc.frequency.value = 220; padOsc.type = 'sawtooth';
      padGain.gain.value = 0.3;
      padOsc.connect(padGain); padGain.connect(master);

      // treble shimmer
      const hiOsc = A.ctx.createOscillator();
      const hiGain = A.ctx.createGain();
      hiOsc.frequency.value = 1200; hiOsc.type = 'triangle';
      hiGain.gain.value = 0.15;
      hiOsc.connect(hiGain); hiGain.connect(master);

      bassOsc.start(); padOsc.start(); hiOsc.start();
      demo.nodes = [bassOsc, padOsc, hiOsc];

      // simulate a 120 BPM kick by ramping bass gain
      let beatCount = 0;
      demo.interval = setInterval(() => {
        if (demo.stopped) return;
        const t = A.ctx.currentTime;
        bassGain.gain.cancelScheduledValues(t);
        bassGain.gain.setValueAtTime(1.0, t);
        bassGain.gain.exponentialRampToValueAtTime(0.01, t + 0.18);
        // vary pad note for movement
        beatCount++;
        const notes = [220, 261, 293, 329];
        padOsc.frequency.setValueAtTime(notes[beatCount % notes.length], t);
        hiGain.gain.setValueAtTime(0.25, t);
        hiGain.gain.exponentialRampToValueAtTime(0.05, t + 0.3);
      }, 500); // 120 BPM

      A._demo = demo;
      start();
      return demo;
    },

    stopDemo() {
      if (A._demo) {
        A._demo.stopped = true;
        clearInterval(A._demo.interval);
        A._demo.nodes.forEach(n => { try { n.stop(); } catch (e) {} });
        A._demo = null;
      }
    },

    // Microphone input
    async startMic(onReady) {
  ensureCtx();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true
    });

    disconnectSource();

        A.micStream = stream;
        A.mode = 'mic';
        A.source = A.ctx.createMediaStreamSource(stream);
        A.source.connect(A.analyser);
        A.source.connect(A.recordDestination);
        // NOTE: do not connect mic to destination (avoid feedback)
        // temporarily disconnect analyser->destination for mic
        try { A.analyser.disconnect(A.ctx.destination); } catch (e) {}
        start();
        // Let CosmicSync know a shareable audio stream now exists
        window.dispatchEvent(new CustomEvent('nebula:audio-source-ready'));
        if (onReady) onReady();
      } catch (err) {
        console.error(err);
        // Show custom mic error modal instead of browser alert
        const modal = document.getElementById('micErrorModal');
        const desc  = document.getElementById('micErrorDesc');
        if (modal) {
          // Contextual message based on error type
          if (desc) {
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
              desc.textContent = 'You denied microphone access. Allow it in your browser settings so NebulaBeat can visualize your voice or instrument live.';
            } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
              desc.textContent = 'No microphone was found on this device. Plug in a mic or use a file instead.';
            } else if (err.name === 'NotReadableError') {
              desc.textContent = 'Your microphone is being used by another app. Close it and try again.';
            } else {
              desc.textContent = `Could not access microphone: ${err.message || err.name}`;
            }
          }
          modal.classList.remove('hidden');
          // Spawn mini stars in error modal
          if (window.spawnMicModalStars) window.spawnMicModalStars();

          // Retry button
          const retryBtn   = document.getElementById('micRetryBtn');
          const dismissBtn = document.getElementById('micDismissBtn');
          if (retryBtn) {
            retryBtn.onclick = () => {
              modal.classList.add('hidden');
              // Small delay then retry
              setTimeout(() => window.NebulaAudio && window.NebulaAudio.startMic(onReady), 300);
            };
          }
          if (dismissBtn) {
            dismissBtn.onclick = () => {
              modal.classList.add('hidden');
              // Open file picker
              const fi = document.getElementById('fileInput');
              if (fi) fi.click();
            };
          }
          // Click outside to dismiss
          modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };
        }
      }
    },

    // transport controls (file/demo)
    play() {
      ensureCtx();
      if (A.mode === 'file' && A.audioEl) return A.audioEl.play();
    },
    pause() {
      if (A.mode === 'file' && A.audioEl) A.audioEl.pause();
    },
    seek(ratio) {
      if (A.mode === 'file' && A.audioEl && A.audioEl.duration) {
        A.audioEl.currentTime = ratio * A.audioEl.duration;
      }
    },
    isPlaying() {
      return A.mode === 'file' && A.audioEl && !A.audioEl.paused;
    },

    _teardownEl() {
      if (A.audioEl) {
        A.audioEl.pause();
        if (A.audioEl.src) URL.revokeObjectURL(A.audioEl.src);
        A.audioEl = null;
      }
      this.stopDemo();
      // restore analyser->destination for playback modes
      try { A.analyser.connect(A.ctx.destination); } catch (e) {}
    }
  };
})();