/* ══════════════════════════════════════════
   NEBULABEAT — PARTICLE ENGINE v3
   Galaxy · Ring · Planet · Aurora · Explosions
   Black Hole Gravity · Speed · Sensitivity
   ══════════════════════════════════════════ */
(function () {
  'use strict';

  const canvas = document.getElementById('canvas');
  const ctx    = canvas.getContext('2d');

  const THEMES = {
    // Deep cosmic: indigo → violet → cyan (nebula core feel)
    blue:  { c1:[99,102,241],   c2:[168,85,247],  c3:[34,211,238]  },
    // Solar prominence: deep crimson → magenta → gold
    red:   { c1:[220,38,127],   c2:[239,68,68],   c3:[251,191,36]  },
    // Aurora borealis: teal → emerald → electric lime
    green: { c1:[20,184,166],   c2:[52,211,153],  c3:[163,230,53]  }
  };

  const state = {
    scene:'galaxy', theme:'blue',
    w:0, h:0, cx:0, cy:0,
    dpr: Math.min(window.devicePixelRatio||1, 2),
    stars:[], starCount:2000, time:0,
    bass:0, mid:0, treble:0, level:0, beat:0,
    rotation:0,
    tiltX:0, tiltY:0,
    explosions:[],
    planetAngle:0,
    auroraOffset:0,
    // ── NEW ──
    speedMult:1,
    sensitivity:1,
    blackHole:{ x:0, y:0, active:false, strength:0, blasting:false }
  };

  /* ── Helpers ── */
  const rgb = (c,a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const lerp = (a,b,t) => [
    Math.round(a[0]+(b[0]-a[0])*t),
    Math.round(a[1]+(b[1]-a[1])*t),
    Math.round(a[2]+(b[2]-a[2])*t)
  ];
  function hexToRgb(hex) {
    const h = String(hex).replace('#','').trim();
    const full = h.length===3 ? h.split('').map(c=>c+c).join('') : h;
    const num = parseInt(full,16) || 0;
    return [(num>>16)&255, (num>>8)&255, num&255];
  }
  const bandVal = b => {
    const v = b===0 ? state.bass : b===1 ? state.mid : state.treble;
    return Math.min(2, v * state.sensitivity);
  };

  /* ── Resize ── */
  function resize() {
    state.w = window.innerWidth;
    state.h = window.innerHeight;
    state.cx = state.w / 2;
    // Visual center between header (80px) and player bar (110px)
    state.cy = 80 + (state.h - 80 - 110) / 2;
    canvas.width  = state.w * state.dpr;
    canvas.height = state.h * state.dpr;
    canvas.style.width  = state.w + 'px';
    canvas.style.height = state.h + 'px';
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  }
  window.addEventListener('resize', resize);

  /* ── Star builders ── */
  function buildGalaxy() {
    state.stars = [];
    const arms = 4, count = state.starCount;
    for (let i = 0; i < count; i++) {
      const t      = Math.random();
      const arm    = i % arms;
      const radius = Math.pow(t, 0.7) * Math.min(state.w, state.h) * 0.48;
      const aOff   = (arm / arms) * Math.PI * 2;
      const spiral = radius * 0.012;
      const angle  = aOff + spiral + (Math.random()-0.5) * 0.6;
      state.stars.push({
        radius, angle,
        baseSize: Math.random()*1.6+0.4, colorMix: Math.random(),
        twinkle:  Math.random()*Math.PI*2,
        speed:   (1-t)*0.0008+0.0002,
        band:     Math.floor(Math.random()*3),
        // Gravity offsets
        gx:0, gy:0, gvx:0, gvy:0
      });
    }
  }

  function buildRing() {
    state.stars = [];
    for (let i = 0; i < state.starCount; i++) {
      const ri    = Math.floor(Math.random()*3);
      const baseR = (0.18 + ri*0.11) * Math.min(state.w, state.h);
      const jit   = (Math.random()-0.5)*30;
      state.stars.push({
        radius: baseR+jit, baseRadius: baseR,
        angle:    Math.random()*Math.PI*2,
        baseSize: Math.random()*1.8+0.5, colorMix: ri/2,
        twinkle:  Math.random()*Math.PI*2,
        speed:   (0.0004+ri*0.0003)*(ri%2?-1:1),
        band:     ri,
        gx:0, gy:0, gvx:0, gvy:0
      });
    }
  }

  function rebuild() { state.scene==='ring' ? buildRing() : buildGalaxy(); }

  /* ════════════════════════════════════════
     GRAVITY — apply black hole pull to star
  ════════════════════════════════════════ */
  function applyGravity(s, baseX, baseY) {
    if (state.blackHole.active) {
      const dx   = state.blackHole.x - (baseX + s.gx);
      const dy   = state.blackHole.y - (baseY + s.gy);
      const dist = Math.sqrt(dx*dx + dy*dy) + 8;
      const force= Math.min(5, (state.blackHole.strength * 3000) / (dist * dist));
      s.gvx += (dx / dist) * force;
      s.gvy += (dy / dist) * force;
      s.gvx *= 0.94; s.gvy *= 0.94;
    } else {
      // Spring back to original position
      s.gvx *= 0.82; s.gvy *= 0.82;
      s.gx  *= 0.90; s.gy  *= 0.90;
    }
    s.gx += s.gvx;
    s.gy += s.gvy;
    // Safety clamp
    const MAX = 900;
    s.gx = Math.max(-MAX, Math.min(MAX, s.gx));
    s.gy = Math.max(-MAX, Math.min(MAX, s.gy));
  }

  /* ════════════════════════════════════════
     BLACK HOLE VISUAL
  ════════════════════════════════════════ */
  function drawBlackHole() {
    if (!state.blackHole.active && state.blackHole.strength < 0.05) return;
    const pal = THEMES[state.theme];
    const bx  = state.blackHole.x;
    const by  = state.blackHole.y;
    const str = Math.min(1, state.blackHole.strength);

    // Accretion glow
    const glow = ctx.createRadialGradient(bx, by, 10, bx, by, 90 * str + 30);
    glow.addColorStop(0,   rgb(pal.c1, 0.6 * str));
    glow.addColorStop(0.3, rgb(pal.c2, 0.25 * str));
    glow.addColorStop(1,  'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(bx, by, 90*str+30, 0, Math.PI*2); ctx.fill();

    // Event horizon (black core)
    const coreR = 10 + str * 12;
    ctx.beginPath(); ctx.arc(bx, by, coreR, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(0,0,0,0.97)'; ctx.fill();

    // Lensing ring
    ctx.beginPath(); ctx.arc(bx, by, coreR + 3, 0, Math.PI*2);
    ctx.strokeStyle = rgb(pal.c3, 0.9 * str);
    ctx.lineWidth = 2.5; ctx.stroke();

    // Rotating accretion streaks
    ctx.save(); ctx.translate(bx, by); ctx.rotate(state.time * 0.04);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const len = (20 + str * 30) * (0.6 + Math.sin(state.time*0.1+i)*0.4);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a)*(coreR+4), Math.sin(a)*(coreR+4));
      ctx.lineTo(Math.cos(a)*(coreR+4+len), Math.sin(a)*(coreR+4+len));
      ctx.strokeStyle = rgb(pal.c1, 0.3*str*(0.5+Math.sin(state.time*0.08+i)*0.5));
      ctx.lineWidth = 1.5; ctx.stroke();
    }
    ctx.restore();
  }

  /* ════════════════════════════════════════
     AURORA
  ════════════════════════════════════════ */
  function drawAurora() {
    const pal = THEMES[state.theme];
    state.auroraOffset += 0.007;
    const t = state.auroraOffset;
    const intensity = 0.07 + state.mid*0.1 + state.bass*0.05 + state.beat*0.04;

    for (let b = 0; b < 3; b++) {
      const waveH = 95 + Math.sin(t*0.65+b*1.9)*38 + state.mid*26;
      const grad  = ctx.createLinearGradient(0,0,0,waveH);
      grad.addColorStop(0,   rgb(pal.c1, intensity*(1-b*0.3)));
      grad.addColorStop(0.55,rgb(pal.c2, intensity*0.28*(1-b*0.3)));
      grad.addColorStop(1,  'rgba(0,0,0,0)');
      ctx.beginPath(); ctx.moveTo(0,0);
      for (let x = 0; x <= state.w; x += 16) {
        const y = Math.sin(x*0.007 + t*(1+b*0.4)) * 18 + waveH*0.5;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(state.w, 0); ctx.closePath();
      ctx.fillStyle = grad; ctx.fill();
    }
    const bGrad = ctx.createLinearGradient(0, state.h, 0, state.h-65);
    bGrad.addColorStop(0, rgb(pal.c1, intensity*0.45));
    bGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bGrad; ctx.fillRect(0, state.h-65, state.w, 65);
  }

  /* ════════════════════════════════════════
     PLANET
  ════════════════════════════════════════ */
  function drawPlanet() {
    const pal = THEMES[state.theme];
    state.planetAngle += 0.004;
    const pa = state.planetAngle;
    const px = state.w*0.84, py = state.h*0.19;
    const r  = 46 + state.bass*10 + state.beat*5;

    const atm = ctx.createRadialGradient(px,py,r*0.7,px,py,r*2.8);
    atm.addColorStop(0, rgb(pal.c1, 0.12+state.bass*0.1));
    atm.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=atm; ctx.beginPath(); ctx.arc(px,py,r*2.8,0,Math.PI*2); ctx.fill();

    ctx.save(); ctx.translate(px,py); ctx.rotate(pa*0.25); ctx.scale(1,0.28);
    ctx.beginPath(); ctx.arc(0,0,r*2.1,Math.PI,Math.PI*2);
    ctx.strokeStyle=rgb(pal.c2,0.18); ctx.lineWidth=9; ctx.stroke();
    ctx.restore();

    const body=ctx.createRadialGradient(px-r*0.3,py-r*0.3,r*0.05,px,py,r);
    body.addColorStop(0,'rgba(255,255,255,0.92)');
    body.addColorStop(0.3,rgb(pal.c1,0.78));
    body.addColorStop(0.72,rgb(pal.c2,0.36));
    body.addColorStop(1,'rgba(4,5,15,0.9)');
    ctx.beginPath(); ctx.arc(px,py,r,0,Math.PI*2); ctx.fillStyle=body; ctx.fill();

    ctx.save(); ctx.beginPath(); ctx.arc(px,py,r,0,Math.PI*2); ctx.clip();
    for (let b=0;b<4;b++) {
      ctx.fillStyle=rgb(pal.c1,0.06+b*0.01);
      ctx.fillRect(px-r, py-r*0.55+b*r*0.35, r*2, r*0.13);
    }
    ctx.restore();

    ctx.save(); ctx.translate(px,py); ctx.rotate(pa*0.25); ctx.scale(1,0.28);
    ctx.beginPath(); ctx.arc(0,0,r*2.1,0,Math.PI);
    ctx.strokeStyle=rgb(pal.c2,0.23); ctx.lineWidth=9; ctx.stroke();
    ctx.restore();

    const mx=px+Math.cos(pa*2.2)*(r*2.0), my=py+Math.sin(pa*2.2)*(r*0.5);
    const moon=ctx.createRadialGradient(mx-2,my-2,0.5,mx,my,7);
    moon.addColorStop(0,'rgba(255,255,255,0.95)');
    moon.addColorStop(1,rgb(pal.c1,0.1));
    ctx.beginPath(); ctx.arc(mx,my,7,0,Math.PI*2); ctx.fillStyle=moon; ctx.fill();
  }

  /* ════════════════════════════════════════
     EXPLOSIONS
  ════════════════════════════════════════ */
  function spawnExplosion(x, y) {
    const pal=THEMES[state.theme];
    for (let i=0;i<80;i++) {
      const angle=Math.random()*Math.PI*2, speed=Math.random()*12+3;
      state.explosions.push({
        x,y, vx:Math.cos(angle)*speed, vy:Math.sin(angle)*speed,
        size:Math.random()*3.5+1.2, alpha:1,
        decay:0.013+Math.random()*0.011,
        c1:pal.c1, c2:pal.c2
      });
    }
  }

  function updateAndDrawExplosions() {
    if (!state.explosions.length) return;
    ctx.globalCompositeOperation='lighter';
    for (let i=state.explosions.length-1;i>=0;i--) {
      const p=state.explosions[i];
      p.x+=p.vx; p.y+=p.vy;
      p.vx*=0.93; p.vy*=0.93; p.vy+=0.06;
      p.alpha-=p.decay; p.size*=0.986;
      if (p.alpha<=0.02){ state.explosions.splice(i,1); continue; }
      ctx.beginPath(); ctx.arc(p.x,p.y,p.size,0,Math.PI*2);
      ctx.fillStyle=rgb(p.c1,p.alpha); ctx.fill();
      ctx.beginPath(); ctx.arc(p.x,p.y,p.size*2.2,0,Math.PI*2);
      ctx.fillStyle=rgb(p.c2,p.alpha*0.22); ctx.fill();
    }
    ctx.globalCompositeOperation='source-over';
  }

  /* ════════════════════════════════════════
     GALAXY DRAW
  ════════════════════════════════════════ */
  function drawGalaxy() {
    const pal = THEMES[state.theme];
    state.rotation += (0.0012 + state.level*0.004) * state.speedMult;

    const tCx = state.cx + state.tiltX*85;
    const tCy = state.cy + state.tiltY*65;

    // Central glow
    const coreR = 60 + state.bass*140 + state.beat*60;
    const g = ctx.createRadialGradient(tCx,tCy,0,tCx,tCy,coreR);
    g.addColorStop(0, rgb(pal.c2, 0.5+state.beat*0.4));
    g.addColorStop(0.4, rgb(pal.c1, 0.18));
    g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=g; ctx.fillRect(0,0,state.w,state.h);

    // Black hole strength ramp
    if (state.blackHole.active) {
      state.blackHole.strength = Math.min(1.5, state.blackHole.strength + 0.015);
    } else {
      state.blackHole.strength *= 0.88;
    }

    ctx.globalCompositeOperation='lighter';
    for (let i=0;i<state.stars.length;i++) {
      const s = state.stars[i];
      const a = s.angle + state.rotation + s.speed * state.time * state.speedMult;
      const amp = bandVal(s.band);
      const r = s.radius * (1 + amp*0.18 + state.beat*0.05);

      const baseX = tCx + Math.cos(a)*r;
      const baseY = tCy + Math.sin(a)*r*0.62;
      applyGravity(s, baseX, baseY);
      const x = baseX + s.gx;
      const y = baseY + s.gy;

      const tw = 0.6 + Math.sin(state.time*0.05+s.twinkle)*0.4;
      const size = s.baseSize * (1 + amp*1.4 + state.beat*0.6) * tw;
      const col  = lerp(lerp(pal.c1,pal.c2,s.colorMix),pal.c3,amp*0.6);
      const alpha= Math.min(1, 0.4+amp*0.6+state.beat*0.3) * tw;

      ctx.fillStyle=`rgba(${col[0]},${col[1]},${col[2]},${alpha})`;
      ctx.beginPath(); ctx.arc(x,y,Math.max(0.2,size),0,Math.PI*2); ctx.fill();
    }
    ctx.globalCompositeOperation='source-over';

    drawBlackHole();
    drawPlanet();
    updateAndDrawExplosions();
  }

  /* ════════════════════════════════════════
     RING DRAW
  ════════════════════════════════════════ */
  function drawRing() {
    const pal = THEMES[state.theme];
    const tCx = state.cx + state.tiltX*85;
    const tCy = state.cy + state.tiltY*65;

    const coreR = 120 + state.level*160 + state.beat*80;
    const g = ctx.createRadialGradient(tCx,tCy,0,tCx,tCy,coreR);
    g.addColorStop(0, rgb(pal.c3, 0.12+state.beat*0.25));
    g.addColorStop(0.5, rgb(pal.c2, 0.06));
    g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=g; ctx.fillRect(0,0,state.w,state.h);

    if (state.blackHole.active) {
      state.blackHole.strength = Math.min(1.5, state.blackHole.strength + 0.015);
    } else {
      state.blackHole.strength *= 0.88;
    }

    ctx.globalCompositeOperation='lighter';
    for (let i=0;i<state.stars.length;i++) {
      const s=state.stars[i];
      const amp=bandVal(s.band);
      s.angle += s.speed*(1+state.level*2)*state.speedMult;
      const r=s.baseRadius*(1+amp*0.35+state.beat*0.12)+Math.sin(state.time*0.04+s.twinkle)*6;
      const baseX=tCx+Math.cos(s.angle)*r;
      const baseY=tCy+Math.sin(s.angle)*r;
      applyGravity(s,baseX,baseY);
      const x=baseX+s.gx, y=baseY+s.gy;
      const tw=0.6+Math.sin(state.time*0.06+s.twinkle)*0.4;
      const size=s.baseSize*(1+amp*1.6+state.beat*0.8)*tw;
      const col=lerp(lerp(pal.c1,pal.c2,s.colorMix),pal.c3,amp*0.7);
      const alpha=Math.min(1, 0.45+amp*0.55+state.beat*0.3)*tw;
      ctx.fillStyle=`rgba(${col[0]},${col[1]},${col[2]},${alpha})`;
      ctx.beginPath(); ctx.arc(x,y,Math.max(0.2,size),0,Math.PI*2); ctx.fill();
    }
    ctx.globalCompositeOperation='source-over';
    drawBlackHole();
    drawPlanet();
    updateAndDrawExplosions();
  }

  /* ── FPS display ── */
  const fpsEl  = document.getElementById('fpsDisplay');
  const starEl = document.getElementById('starDisplay');
  let lastFps=performance.now(), frames=0;

  /* ── Main loop ── */
  function loop(now) {
    state.time++;
    ctx.fillStyle='rgba(4,5,15,0.28)';
    ctx.fillRect(0,0,state.w,state.h);
    drawAurora();
    state.scene==='ring' ? drawRing() : drawGalaxy();
    state.beat *= 0.90;

    frames++;
    if (now-lastFps>=1000) {
      if (fpsEl) fpsEl.textContent = Math.round((frames*1000)/(now-lastFps))+' FPS';
      frames=0; lastFps=now;
    }
    requestAnimationFrame(loop);
  }

  /* ════════════════════════════════════════
     PUBLIC API
  ════════════════════════════════════════ */
  window.NebulaParticles = {
    init() {
      resize(); rebuild();
      if (starEl) starEl.textContent = state.starCount+' ✦';
      requestAnimationFrame(loop);
    },
    setScene(s)  { state.scene=s; rebuild(); },
    setTheme(t)  { if(THEMES[t]) state.theme=t; },
    setStarCount(n){ state.starCount=n; rebuild(); if(starEl) starEl.textContent=n+' ✦'; },
    update(data) { state.bass=data.bass; state.mid=data.mid; state.treble=data.treble; state.level=data.level; },
    hitBeat(str) {
      state.beat = Math.min(1.4, str||1);
      // Bass drop while black hole active → BLAST stars free!
      if (state.blackHole.active && state.beat > 0.7) {
        state.blackHole.blasting = true;
        // Give every star explosive outward velocity from black hole
        for (const s of state.stars) {
          const dist = Math.sqrt(s.gx*s.gx+s.gy*s.gy)+1;
          s.gvx = (s.gx/dist)*22 + (Math.random()-0.5)*8;
          s.gvy = (s.gy/dist)*22 + (Math.random()-0.5)*8;
        }
        state.blackHole.active = false;
        setTimeout(()=>{ state.blackHole.blasting=false; }, 200);
      }
    },
    idle()       { state.bass=0.05+Math.sin(state.time*0.02)*0.04; state.mid=0.05; state.treble=0.04; state.level=0.05; },
    explode(x,y) { spawnExplosion(x,y); },
    setTilt(x,y) { state.tiltX=x; state.tiltY=y; },
    // ── NEW ──
    setBlackHole(x, y, active) {
      state.blackHole.x = x;
      state.blackHole.y = y;
      state.blackHole.active = active;
      if (!active) state.blackHole.blasting = false;
    },
    setSpeedMult(v)   { state.speedMult   = Math.max(0.2, Math.min(4, v)); },
    setSensitivity(v) { state.sensitivity = Math.max(0.2, Math.min(3, v)); },
    // ── beat level (for highlight-clip auto-capture) ──
    getBeatLevel() { return state.beat; },
    // ── unbroadcast burst, used for chat reactions etc. (CosmicSync only wraps `explode`) ──
    burst(x,y) { spawnExplosion(x,y); },
    // ── custom theme creator: pick 2 colors, 3rd accent is auto-derived ──
    setCustomTheme(hex1, hex2) {
      const c1 = hexToRgb(hex1), c2 = hexToRgb(hex2);
      const mid = lerp(c1, c2, 0.5);
      const c3 = mid.map(v => Math.min(255, Math.round(v*0.4 + 255*0.6)));
      THEMES.custom = { c1, c2, c3 };
      state.theme = 'custom';
    },
  };

  if (document.readyState==='loading') {
    document.addEventListener('DOMContentLoaded', ()=>window.NebulaParticles.init());
  } else {
    window.NebulaParticles.init();
  }
})();