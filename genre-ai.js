/* ══════════════════════════════════════════
   NEBULABEAT — AI GENRE THEME DETECTOR
   Intelligent Audio Frequency Clustering
   for Dynamic Theme Adaptation
   ══════════════════════════════════════════ */
(function () {
  'use strict';

  const GENRE_CONFIG = {
    // Heavy bass (Hip-Hop / EDM) → Solar Flare Red, fast, high gravity
    bass_heavy: {
      theme:     'red',
      label:     'Hip-Hop / EDM',
      speedMult: 2.0,
      sensitivity: 1.8,
      badge:     '🔴 Hip-Hop / EDM'
    },
    // Treble/High-mids dominant (Classical / Acoustic) → Cosmic Aurora Green, slow, cyclic
    treble_heavy: {
      theme:     'green',
      label:     'Classical / Acoustic',
      speedMult: 0.6,
      sensitivity: 0.9,
      badge:     '🟢 Classical / Acoustic'
    },
    // Balanced mid energy (Pop / Rock / Default) → Nebula Blue, normal
    balanced: {
      theme:     'blue',
      label:     'Pop / Rock',
      speedMult: 1.0,
      sensitivity: 1.0,
      badge:     '🔵 Pop / Rock'
    }
  };

  const AI = {
    enabled: true,
    currentGenre: null,
    // Rolling window of band values for smoothing (last 6 samples ~9s)
    history: { bass: [], mid: [], treble: [] },
    windowSize: 6,
    // Lock genre for min 5s so it doesn't flicker
    lockFrames: 0,
    lockDuration: 200 // ~200 analyse calls at 1 per 1.5s = ~5min, lock for 3 cycles
  };

  function rollingAvg(arr) {
    if (!arr.length) return 0;
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  }

  function push(key, val) {
    AI.history[key].push(val);
    if (AI.history[key].length > AI.windowSize) AI.history[key].shift();
  }

  function classifyGenre(bass, mid, treble) {
    // Ratios relative to total signal
    const total = bass + mid + treble + 0.001;
    const bRatio = bass   / total;
    const mRatio = mid    / total;
    const tRatio = treble / total;

    // Thresholds (tuned by ear/experiment):
    // bass_heavy: bass is >40% of signal AND bass > 0.12 absolute
    if (bRatio > 0.40 && bass > 0.12) return 'bass_heavy';
    // treble_heavy: treble > 45% AND treble > mid
    if (tRatio > 0.45 && treble > mid) return 'treble_heavy';
    return 'balanced';
  }

  function applyGenre(genre) {
    if (genre === AI.currentGenre) return;
    AI.currentGenre = genre;
    const cfg = GENRE_CONFIG[genre];
    if (!cfg) return;

    // Update theme buttons + particles
    const btn = document.querySelector(`.theme-btn[data-theme="${cfg.theme}"]`);
    if (btn) {
      document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    }
    document.body.setAttribute('data-theme', cfg.theme);
    if (window.NebulaParticles) {
      window.NebulaParticles.setTheme(cfg.theme);
      window.NebulaParticles.setSpeedMult(cfg.speedMult);
      window.NebulaParticles.setSensitivity(cfg.sensitivity);
    }

    // Update settings sliders UI (speed: value=speedMult*10, sens: value=sens*10)
    const speedSlider = document.getElementById('speedSlider');
    const speedVal    = document.getElementById('speedVal');
    if (speedSlider && speedVal) {
      speedSlider.value = Math.round(cfg.speedMult * 10);
      speedVal.textContent = cfg.speedMult.toFixed(1) + '×';
    }
    const sensSlider = document.getElementById('sensitivitySlider');
    const sensVal    = document.getElementById('sensitivityVal');
    if (sensSlider && sensVal) {
      sensSlider.value = Math.round(cfg.sensitivity * 10);
      sensVal.textContent = cfg.sensitivity.toFixed(1) + '×';
    }

    // Update AI badge
    const badge = document.getElementById('aiGenreLabel');
    if (badge) badge.textContent = cfg.badge;

    // Flash notification
    showGenreToast(cfg.badge, cfg.theme);
  }

  /* ── Toast notification for genre switch ── */
  let toastTimer = null;
  function showGenreToast(text, theme) {
    let toast = document.getElementById('genreToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'genreToast';
      toast.className = 'genre-toast';
      document.body.appendChild(toast);
    }
    const colors = {
      red:   'rgba(248,113,113,0.18)',
      green: 'rgba(52,211,153,0.18)',
      blue:  'rgba(96,165,250,0.18)'
    };
    toast.style.background = colors[theme] || colors.blue;
    toast.innerHTML = `<span class="genre-toast-icon">🤖</span><span>${text} detected</span>`;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
  }

  /* ── Public API ── */
  window.NebulaGenreAI = {
    analyse(bass, mid, treble) {
      if (!AI.enabled) return;
      if (AI.lockFrames > 0) { AI.lockFrames--; return; }

      push('bass',   bass);
      push('mid',    mid);
      push('treble', treble);

      const avgBass   = rollingAvg(AI.history.bass);
      const avgMid    = rollingAvg(AI.history.mid);
      const avgTreble = rollingAvg(AI.history.treble);

      const genre = classifyGenre(avgBass, avgMid, avgTreble);

      if (genre !== AI.currentGenre) {
        AI.lockFrames = 4; // lock for ~4 more cycles before re-checking
        applyGenre(genre);
      }
    },

    setEnabled(v) {
      AI.enabled = !!v;
      const badge = document.getElementById('aiGenreBadge');
      if (badge) badge.classList.toggle('ai-off', !v);
      if (!v) {
        const lbl = document.getElementById('aiGenreLabel');
        if (lbl) lbl.textContent = 'AI OFF';
      }
    },

    isEnabled() { return AI.enabled; },
    getCurrentGenre() { return AI.currentGenre; }
  };

})();