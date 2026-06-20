/* ══════════════════════════════════════════
   NEBULABEAT — UI CONTROLLER v3
   Playlist · Gyro · Black Hole · Settings
   ══════════════════════════════════════════ */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);

  const uploadZone    = $('uploadZone');
  const player        = $('player');
  const fileInput     = $('fileInput');
  const fileInput2    = $('fileInput2');
  const micBtn        = $('micBtn');
  const micToggle     = $('micToggle');
  const demoBtn       = $('demoBtn');
  const playBtn       = $('playBtn');
  const playIcon      = $('playIcon');
  const pauseIcon     = $('pauseIcon');
  const playerDisc    = $('playerDisc');
  const playerTitle   = $('playerTitle');
  const playerMode    = $('playerMode');
  const progressTrack = $('progressTrack');
  const progressFill  = $('progressFill');
  const currentTimeEl = $('currentTime');
  const totalTimeEl   = $('totalTime');
  const canvas        = $('canvas');

  /* ════════════════════════════════════════
     PLAYLIST
  ════════════════════════════════════════ */
  const playlist = [];
  let currentIndex = -1;

  const fmtTime = s => {
    if (!isFinite(s)||s<0) s=0;
    const m=Math.floor(s/60), sec=Math.floor(s%60);
    return m+':'+(sec<10?'0':'')+sec;
  };

  function showPlayer() {
    uploadZone.classList.add('hidden');
    player.classList.remove('hidden');
  }

  function setPlayState(playing) {
    playIcon.style.display  = playing?'none':'';
    pauseIcon.style.display = playing?'':'none';
    playerDisc.classList.toggle('spinning', playing);
  }

  function renderPlaylist() {
    const list  = $('playlistItems');
    const count = $('playlistCount');
    if (!list) return;
    list.innerHTML='';
    playlist.forEach((track,i)=>{
      const item=document.createElement('div');
      item.className='pl-item'+(i===currentIndex?' pl-active':'');
      item.innerHTML=`<span class="pl-num">${i+1}</span><span class="pl-name">${track.name}</span><span class="pl-dur" id="plDur${i}">—</span>`;
      item.addEventListener('click',()=>loadTrackAt(i));
      list.appendChild(item);
    });
    if (count) count.textContent=playlist.length?`${playlist.length} track${playlist.length!==1?'s':''}`:'No tracks';
  }

  function loadTrackAt(index) {
    if (index<0||index>=playlist.length) return;
    currentIndex=index;
    const track=playlist[index];
    const el=window.NebulaAudio.loadFile(track.file,(audio)=>{
      totalTimeEl.textContent=fmtTime(audio.duration);
      const durEl=$('plDur'+index);
      if (durEl) durEl.textContent=fmtTime(audio.duration);
      audio.play().then(()=>setPlayState(true)).catch(()=>setPlayState(false));
    });
    playerTitle.textContent=track.name;
    playerMode.textContent=`${index+1} / ${playlist.length}`;
    playerDisc.textContent='🎵';
    showPlayer(); renderPlaylist();
    el.addEventListener('timeupdate',()=>{
      const ratio=el.currentTime/(el.duration||1);
      progressFill.style.width=(ratio*100)+'%';
      currentTimeEl.textContent=fmtTime(el.currentTime);
      if (el.duration&&totalTimeEl.textContent==='0:00')
        totalTimeEl.textContent=fmtTime(el.duration);
    });
    el.addEventListener('play', ()=>setPlayState(true));
    el.addEventListener('pause',()=>setPlayState(false));
  }

  const nextTrack=()=>{ if(playlist.length) loadTrackAt((currentIndex+1)%playlist.length); };
  const prevTrack=()=>{
    if (!playlist.length) return;
    const el=window.NebulaAudio.el;
    if (el&&el.currentTime>3){ el.currentTime=0; return; }
    loadTrackAt((currentIndex-1+playlist.length)%playlist.length);
  };

  function handleFile(file) {
    if (!file) return;
    if (!file.type.startsWith('audio/')&&!/\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(file.name)){
      alert('Please choose an audio file.'); return;
    }
    playlist.push({file,name:file.name.replace(/\.[^.]+$/,'')});
    loadTrackAt(playlist.length-1);
  }

  window._nbHandleFile  = handleFile;
  window._nbHandleFiles = files=>Array.from(files).forEach(handleFile);

  /* ── File inputs ── */
  fileInput.addEventListener('change', e=>handleFile(e.target.files[0]));
  fileInput2.addEventListener('change',e=>handleFile(e.target.files[0]));
  $('prevBtn').addEventListener('click',prevTrack);
  $('nextBtn').addEventListener('click',nextTrack);

  /* ── Demo ── */
  demoBtn.addEventListener('click',()=>{
    window.NebulaAudio.startDemo();
    playerTitle.textContent='Demo Signal'; playerMode.textContent='Demo Mode';
    totalTimeEl.textContent='∞'; currentTimeEl.textContent='0:00';
    progressFill.style.width='40%'; playerDisc.textContent='✨';
    showPlayer(); setPlayState(true);
  });

  /* ── Mic ── */
  function startMic(){
    window.NebulaAudio.startMic(()=>{
      playerTitle.textContent='Live Microphone'; playerMode.textContent='Mic Input';
      totalTimeEl.textContent='—'; currentTimeEl.textContent='LIVE';
      progressFill.style.width='100%'; playerDisc.textContent='🎤';
      showPlayer(); setPlayState(true);
    });
  }
  micBtn.addEventListener('click',startMic);
  micToggle.addEventListener('click',startMic);

  /* ── Play/Pause ── */
  playBtn.addEventListener('click',()=>{
    if (window.NebulaAudio.mode==='file'){
      if (window.NebulaAudio.isPlaying()){ window.NebulaAudio.pause(); setPlayState(false); }
      else { window.NebulaAudio.play(); setPlayState(true); }
    }
  });

  /* ── Seek ── */
  progressTrack.addEventListener('click',e=>{
    if (window.NebulaAudio.mode!=='file') return;
    const rect=progressTrack.getBoundingClientRect();
    window.NebulaAudio.seek(Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width)));
  });

  /* ── Keyboard ── */
  document.addEventListener('keydown',e=>{
    if (['INPUT','TEXTAREA'].includes(e.target.tagName)) return;
    if (e.code==='Space'){ e.preventDefault(); playBtn.click(); }
    if (e.key==='ArrowRight') nextTrack();
    if (e.key==='ArrowLeft')  prevTrack();
  });

  /* ── Playlist panel ── */
  const playlistPanel=$('playlistPanel');
  $('playlistBtn').addEventListener('click',()=>{ renderPlaylist(); playlistPanel.classList.toggle('open'); });
  $('plClose').addEventListener('click',()=>playlistPanel.classList.remove('open'));

  /* ── Scene & Theme ── */
  document.querySelectorAll('.scene-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.scene-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      window.NebulaParticles.setScene(btn.dataset.scene);
    });
  });
  document.querySelectorAll('.theme-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.theme-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      document.body.setAttribute('data-theme',btn.dataset.theme);
      window.NebulaParticles.setTheme(btn.dataset.theme);
    });
  });
  document.body.setAttribute('data-theme','blue');

  /* ── Drag & Drop ── */
  ['dragenter','dragover'].forEach(ev=>window.addEventListener(ev,e=>{e.preventDefault();document.body.classList.add('drag-over');}));
  ['dragleave','drop'].forEach(ev=>window.addEventListener(ev,e=>{
    e.preventDefault();
    if (ev==='dragleave'&&e.relatedTarget) return;
    document.body.classList.remove('drag-over');
  }));
  window.addEventListener('drop',e=>{ e.preventDefault(); if(e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });

  /* ════════════════════════════════════════
     BLACK HOLE — hold & drag interaction
     Short click (<180ms) = explosion
     Hold / drag = black hole gravity
  ════════════════════════════════════════ */
  let mouseDownTime = 0;
  let bhActive      = false;
  let bhDragged     = false;

  canvas.addEventListener('mousedown', e=>{
    if (e.target!==canvas) return;
    mouseDownTime = Date.now();
    bhDragged = false;
  });

  canvas.addEventListener('mousemove', e=>{
    if (!mouseDownTime) return;
    const held = Date.now() - mouseDownTime;
    if (held > 160 || bhDragged) {
      bhDragged = true; bhActive = true;
      window.NebulaParticles.setBlackHole(e.clientX, e.clientY, true);
    }
  });

  canvas.addEventListener('mouseup', e=>{
    const held = Date.now() - mouseDownTime;
    mouseDownTime = 0;
    if (!bhDragged && held < 180) {
      // Short click → explosion
      window.NebulaParticles.explode(e.clientX, e.clientY);
    }
    bhActive = false; bhDragged = false;
    window.NebulaParticles.setBlackHole(0, 0, false);
  });

  canvas.addEventListener('mouseleave', ()=>{
    mouseDownTime=0; bhActive=false; bhDragged=false;
    window.NebulaParticles.setBlackHole(0,0,false);
  });

  // Touch — hold & drag = black hole, tap = explosion
  let touchStart=0, touchBh=false;
  canvas.addEventListener('touchstart', e=>{
    touchStart=Date.now(); touchBh=false;
    // Start a timer — if still holding after 200ms, activate black hole
    const t=e.touches[0];
    setTimeout(()=>{
      if (Date.now()-touchStart>180) {
        touchBh=true;
        window.NebulaParticles.setBlackHole(t.clientX,t.clientY,true);
      }
    }, 180);
  },{passive:true});

  canvas.addEventListener('touchmove', e=>{
    if (!touchBh) return;
    window.NebulaParticles.setBlackHole(e.touches[0].clientX,e.touches[0].clientY,true);
  },{passive:true});

  canvas.addEventListener('touchend', e=>{
    const held=Date.now()-touchStart;
    window.NebulaParticles.setBlackHole(0,0,false);
    if (!touchBh && held<200){
      const t=e.changedTouches[0];
      window.NebulaParticles.explode(t.clientX,t.clientY);
    }
    touchBh=false; touchStart=0;
  },{passive:true});

  /* ════════════════════════════════════════
     SETTINGS PANEL
  ════════════════════════════════════════ */
  const settingsPanel = $('settingsPanel');
  const settingsBtn   = $('settingsBtn');

  settingsBtn.addEventListener('click',()=>settingsPanel.classList.toggle('open'));
  $('spClose').addEventListener('click',()=>settingsPanel.classList.remove('open'));

  // Star Count
  const starSlider = $('starCountSlider');
  const starVal    = $('starCountVal');
  starSlider.addEventListener('input',()=>{
    const n=parseInt(starSlider.value);
    starVal.textContent=n.toLocaleString();
    window.NebulaParticles.setStarCount(n);
  });

  // Speed
  const speedSlider = $('speedSlider');
  const speedVal    = $('speedVal');
  speedSlider.addEventListener('input',()=>{
    const v = parseInt(speedSlider.value)/10;
    speedVal.textContent = v.toFixed(1)+'×';
    window.NebulaParticles.setSpeedMult(v);
  });

  // Sensitivity
  const sensSlider = $('sensitivitySlider');
  const sensVal    = $('sensitivityVal');
  sensSlider.addEventListener('input',()=>{
    const v = parseInt(sensSlider.value)/10;
    sensVal.textContent = v.toFixed(1)+'×';
    window.NebulaParticles.setSensitivity(v);
  });

  /* ════════════════════════════════════════
     MOUSE TILT (desktop)
  ════════════════════════════════════════ */
  let gyroActive=false;
  document.addEventListener('mousemove',e=>{
    if (gyroActive||!window.NebulaParticles) return;
    const tx=(e.clientX/window.innerWidth-0.5)*0.9;
    const ty=(e.clientY/window.innerHeight-0.5)*0.7;
    window.NebulaParticles.setTilt(tx,ty);
  });

  /* ════════════════════════════════════════
     GYROSCOPE
  ════════════════════════════════════════ */
  function handleOrientation(e){
    if (!window.NebulaParticles) return;
    gyroActive=true;
    window.NebulaParticles.setTilt(
      Math.max(-0.7,Math.min(0.7,(e.gamma||0)/45)),
      Math.max(-0.5,Math.min(0.5,((e.beta||0)-45)/55))
    );
  }
  const gyroBtn=$('gyroBtn');
  if (gyroBtn){
    if (typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function'){
      gyroBtn.style.display='flex';
      gyroBtn.addEventListener('click',async()=>{
        const p=await DeviceOrientationEvent.requestPermission().catch(()=>'denied');
        if (p==='granted'){ window.addEventListener('deviceorientation',handleOrientation); gyroBtn.textContent='📡'; }
      });
    } else if (window.DeviceOrientationEvent){
      window.addEventListener('deviceorientation',handleOrientation);
      gyroBtn.style.display='flex';
    }
  }

  /* ── Idle motion ── */
  (function idleLoop(){
    if (window.NebulaAudio.mode==='idle'&&window.NebulaParticles) window.NebulaParticles.idle();
    requestAnimationFrame(idleLoop);
  })();

  window.NebulaUI={
    onEnded(){
      if (playlist.length>1&&currentIndex<playlist.length-1) nextTrack();
      else if (playlist.length>1) loadTrackAt(0);
      else { setPlayState(false); progressFill.style.width='100%'; }
    }
  };

  /* ── AI Genre Badge toggle ── */
  const aiGenreBadge = $('aiGenreBadge');
  if (aiGenreBadge) {
    aiGenreBadge.style.cursor = 'pointer';
    aiGenreBadge.title = 'Click to toggle AI Genre Detector';
    aiGenreBadge.addEventListener('click', () => {
      if (window.NebulaGenreAI) {
        const nowEnabled = !window.NebulaGenreAI.isEnabled();
        window.NebulaGenreAI.setEnabled(nowEnabled);
        const lbl = $('aiGenreLabel');
        if (lbl) lbl.textContent = nowEnabled ? 'AI' : 'AI OFF';
      }
    });
  }
})();