/* ══════════════════════════════════════════
   NEBULABEAT — LOADING SCREEN & ONBOARDING TOUR
   ══════════════════════════════════════════ */
(function () {
  'use strict';

  const TOUR_KEY = 'nebulabeat_tour_seen_v1';

  /* ════════════════════════════════════
     LOADING SCREEN
  ════════════════════════════════════ */
  function initLoadingScreen() {
    const screen = document.getElementById('loadingScreen');
    const fill   = document.getElementById('loadingBarFill');
    if (!screen) { maybeStartTour(); return; }

    const minDelay    = new Promise(res => setTimeout(res, 900));
    const fontsReady   = (document.fonts && document.fonts.ready) ? document.fonts.ready.catch(() => {}) : Promise.resolve();

    // Honest-ish progress tick (not tied to real bytes, just keeps it feeling alive)
    let pct = 0;
    const tick = setInterval(() => {
      pct = Math.min(92, pct + Math.random() * 18);
      if (fill) fill.style.width = pct + '%';
    }, 140);

    Promise.all([minDelay, fontsReady]).then(() => {
      clearInterval(tick);
      if (fill) fill.style.width = '100%';
      setTimeout(() => {
        screen.classList.add('fade-out');
        setTimeout(() => {
          screen.remove();
          maybeStartTour();
        }, 650);
      }, 200);
    });
  }

  /* ════════════════════════════════════
     ONBOARDING TOUR
  ════════════════════════════════════ */
  const STEPS = [
    { target: null,             title: 'Welcome to NebulaBeat 🌌', desc: 'A galaxy that dances to your music. Quick look around?' },
    { target: '#uploadZone',    title: 'Drop your music',          desc: 'Drag a song in, or tap to choose one from your device.' },
    { target: '#micBtn',        title: 'Or go live 🎤',            desc: "No file handy? Use your mic — sing, talk, play an instrument." },
    { target: '.theme-switcher',title: 'Pick a vibe',              desc: 'Switch color themes anytime, or tap 🎨 to mix your own.' },
    { target: '#settingsBtn',   title: 'Fine-tune it',             desc: 'Sensitivity, speed, scenes, AI genre detection — all in here.' },
    { target: null,             title: "You're all set ✨",        desc: "Once your music is playing, you'll also get recording 🎥 and Cosmic Sync 🌐 to jam live with friends." }
  ];

  let step = 0;

  function maybeStartTour() {
    let seen = null;
    try { seen = localStorage.getItem(TOUR_KEY); } catch (e) {}
    if (seen) return;
    startTour();
  }

  function startTour() {
    step = 0;
    document.getElementById('tourOverlay')?.classList.remove('hidden');
    renderStep();
  }

  function endTour() {
    try { localStorage.setItem(TOUR_KEY, '1'); } catch (e) {}
    document.getElementById('tourOverlay')?.classList.add('hidden');
  }

  function renderStep() {
    const s = STEPS[step];
    const overlay   = document.getElementById('tourOverlay');
    const spotlight = document.getElementById('tourSpotlight');
    const card      = document.getElementById('tourCard');
    const titleEl   = document.getElementById('tourTitle');
    const descEl    = document.getElementById('tourDesc');
    const dotsEl    = document.getElementById('tourDots');
    const backBtn   = document.getElementById('tourBackBtn');
    const nextBtn   = document.getElementById('tourNextBtn');
    if (!overlay || !spotlight || !card) return;

    titleEl.textContent = s.title;
    descEl.textContent  = s.desc;
    backBtn.disabled = step === 0;
    nextBtn.textContent = step === STEPS.length - 1 ? 'Finish' : 'Next';

    dotsEl.innerHTML = '';
    STEPS.forEach((_, i) => {
      const d = document.createElement('span');
      d.className = 'tour-dot' + (i === step ? ' active' : '');
      dotsEl.appendChild(d);
    });

    const targetEl = s.target ? document.querySelector(s.target) : null;
    const vw = window.innerWidth, vh = window.innerHeight;

    if (targetEl) {
      const r = targetEl.getBoundingClientRect();
      const pad = 10;
      spotlight.classList.remove('center');
      const left   = Math.max(4, r.left - pad);
      const top    = Math.max(4, r.top  - pad);
      const width  = Math.min(r.width  + pad * 2, vw - left - 4);
      const height = Math.min(r.height + pad * 2, vh - top  - 4);
      spotlight.style.left   = left + 'px';
      spotlight.style.top    = top + 'px';
      spotlight.style.width  = width + 'px';
      spotlight.style.height = height + 'px';
    } else {
      spotlight.classList.add('center');
      spotlight.style.left   = (vw / 2) + 'px';
      spotlight.style.top    = (vh / 2) + 'px';
      spotlight.style.width  = '2px';
      spotlight.style.height = '2px';
    }
    // Card is docked to the bottom via CSS (width:min(300px, 100vw-32px)) —
    // no per-step left/top math needed, so it can never run off-screen.
  }

  function next() {
    if (step >= STEPS.length - 1) { endTour(); return; }
    step++; renderStep();
  }
  function back() {
    if (step <= 0) return;
    step--; renderStep();
  }

  function bind() {
    document.getElementById('tourNextBtn')?.addEventListener('click', next);
    document.getElementById('tourBackBtn')?.addEventListener('click', back);
    document.getElementById('tourSkipBtn')?.addEventListener('click', endTour);
    document.getElementById('tourReplayBtn')?.addEventListener('click', () => {
      document.getElementById('settingsPanel')?.classList.remove('open');
      startTour();
    });
    window.addEventListener('resize', () => {
      if (!document.getElementById('tourOverlay')?.classList.contains('hidden')) renderStep();
    });

    initLoadingScreen();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  window.NebulaOnboarding = { start: startTour };
})();