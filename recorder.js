/* ══════════════════════════════════════════
   NEBULABEAT — COSMIC SESSION RECORDER
   Real-time Canvas Stream Serialization
   & Client-Side Video Encoding (.webm)
   ══════════════════════════════════════════ */
(function () {
  'use strict';

  const REC = {
    mediaRecorder: null,
    chunks:        [],
    isRecording:   false,
    startTime:     0,
    lastBlob:      null,
    lastBlobUrl:   null,
    lastMime:      'video/webm'
  };

  /* ── UI refs ── */
  function getBtn()   { return document.getElementById('recordBtn'); }
  function getToast() { return document.getElementById('recordToast'); }
  function getLabel() { return document.getElementById('recordToastLabel'); }

  function setRecordingUI(active) {
    const btn   = getBtn();
    const toast = getToast();
    if (btn) {
      btn.title = active ? 'Stop Recording' : 'Record Cosmic Session';
      btn.classList.toggle('rec-active', active);
      btn.textContent = active ? '⏹' : '⏺';
    }
    if (toast) toast.classList.toggle('hidden', !active);
  }

  /* ── Timer label ── */
  let timerInterval = null;
  function startTimer() {
    REC.startTime = Date.now();
    timerInterval = setInterval(() => {
      const el = getLabel();
      if (!el) return;
      const s  = Math.floor((Date.now() - REC.startTime) / 1000);
      const m  = Math.floor(s / 60);
      const ss = String(s % 60).padStart(2, '0');
      el.textContent = `Recording ${m}:${ss}`;
    }, 500);
  }
  function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  /* ── Duration helper ── */
  function getDurationLabel() {
    const s  = Math.floor((Date.now() - REC.startTime) / 1000);
    const m  = Math.floor(s / 60);
    const ss = String(s % 60).padStart(2, '0');
    return `${m}m ${ss}s`;
  }

  /* ── Start recording ── */
  async function startRecording() {
    if (REC.isRecording) return;

    const canvas = document.getElementById('canvas');
    if (!canvas) { showNbAlert('Canvas not found.'); return; }

    const canvasStream = canvas.captureStream(30);

    const streams = [canvasStream];

    if (
          window.NebulaAudio &&
          window.NebulaAudio.recordStream
       ) {
  streams.push(
    window.NebulaAudio.recordStream
  );
}

    // Combine tracks
    const combinedTracks = [];
    streams.forEach(s => s.getTracks().forEach(t => combinedTracks.push(t)));
    const combinedStream = new MediaStream(combinedTracks);

    const mimeTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ];
    const mime = mimeTypes.find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';
    REC.lastMime = mime;
    REC.chunks = [];

    try {
      REC.mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType: mime,
        videoBitsPerSecond: 4_000_000
      });
    } catch (e) {
      showNbAlert('Recording not supported in this browser. Try Chrome or Edge.');
      return;
    }

    REC.mediaRecorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) REC.chunks.push(e.data);
    };

    REC.mediaRecorder.onstop = () => {
      const blob = new Blob(REC.chunks, { type: mime });
      REC.lastBlob = blob;
      // Revoke previous URL if any
      if (REC.lastBlobUrl) URL.revokeObjectURL(REC.lastBlobUrl);
      REC.lastBlobUrl = URL.createObjectURL(blob);
      REC.chunks = [];
      showExportModal(blob, REC.lastBlobUrl, mime);
    };

    REC.mediaRecorder.start(200);
    REC.isRecording = true;
    setRecordingUI(true);
    startTimer();
  }

  /* ── Stop recording ── */
  function stopRecording() {
    if (!REC.isRecording || !REC.mediaRecorder) return;
    const durationLabel = getDurationLabel();
    REC._durationLabel = durationLabel;

    // Capture thumbnail snapshot from canvas right before stopping
    try {
      const canvas = document.getElementById('canvas');
      if (canvas) REC._thumbnail = canvas.toDataURL('image/jpeg', 0.82);
    } catch (e) { REC._thumbnail = null; }

    REC.mediaRecorder.stop();
    REC.mediaRecorder.stream.getTracks().forEach(t => t.stop());
    REC.isRecording = false;
    setRecordingUI(false);
    stopTimer();

    // Show "processing" briefly in toast
    const lbl = getLabel();
    const toast = getToast();
    if (lbl) lbl.textContent = '✦ Processing…';
    if (toast) {
      toast.classList.remove('hidden');
      setTimeout(() => toast.classList.add('hidden'), 1800);
    }
  }

  /* ── Export Modal ── */
  function showExportModal(blob, blobUrl, mime) {
    const modal    = document.getElementById('exportModal');
    const video    = document.getElementById('exportPreviewVideo');
    const overlay  = document.getElementById('exportPreviewOverlay');
    const playBtn  = document.getElementById('exportPlayBtn');
    const dlBtn    = document.getElementById('exportDownloadBtn');
    const closeBtn = document.getElementById('exportCloseBtn');
    const durEl    = document.getElementById('exportDuration');
    const resEl    = document.getElementById('exportResolution');
    const sizeEl   = document.getElementById('exportSize');

    if (!modal) return;
    if (
        window.NebulaAudio &&
        window.NebulaAudio.el
       ) {
        window.NebulaAudio.el.pause();
    }

    // Fill stats
    if (durEl)  durEl.textContent  = REC._durationLabel || '—';
    if (resEl)  resEl.textContent  = `${window.innerWidth}×${window.innerHeight}`;
    if (sizeEl) sizeEl.textContent = formatBytes(blob.size);

    // Setup video preview
    if (video) {
      video.src = blobUrl;
      video.load();
    }

    // Show thumbnail as preview overlay image
    const thumbImg = document.getElementById('exportThumb');
    if (thumbImg && REC._thumbnail) {
      thumbImg.src = REC._thumbnail;
      thumbImg.style.display = 'block';
    } else if (thumbImg) {
      thumbImg.style.display = 'none';
    }

    // Setup download button — programmatic so filename works on mobile too
    const ext  = mime.includes('mp4') ? 'mp4' : 'webm';
    const name = `NebulaBeat-CosmicSession.${ext}`;
    if (dlBtn) {
      // Clone to remove old listeners
      const fresh = dlBtn.cloneNode(true);
      dlBtn.parentNode.replaceChild(fresh, dlBtn);
      fresh.addEventListener('click', () => {
        const a = document.createElement('a');
        a.href     = blobUrl;
        a.download = name;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => a.remove(), 1000);
      });
    }

    // Preview button
    if (playBtn && overlay && video) {
     playBtn.onclick = () => {

       if (
          window.NebulaAudio &&
          window.NebulaAudio.el
       ) {
         window.NebulaAudio.el.pause();}

     overlay.style.opacity = '0';
     overlay.style.pointerEvents = 'none';
     video.muted = false;
     video.play();
    };
  }

    // Close button
    if (closeBtn) {
      closeBtn.onclick = () => {
        if (
            window.NebulaAudio &&
            window.NebulaAudio.el
        ) {
            window.NebulaAudio.el.play();
        }
            modal.classList.add('hidden');
            if (video) { video.pause(); video.src = ''; }
      };
    }

    // Click outside to close
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.classList.add('hidden');
        if (video) { video.pause(); video.src = ''; }
      }
    };

    // Show modal with animation
    modal.classList.remove('hidden');
    spawnModalStars('exportStars');
  }

  /* ── Tiny starfield inside modal canvas ── */
  function spawnModalStars(canvasId) {
    const c = document.getElementById(canvasId);
    if (!c) return;
    const ctx = c.getContext('2d');
    c.width  = c.offsetWidth;
    c.height = c.offsetHeight;
    const stars = Array.from({length: 60}, () => ({
      x: Math.random() * c.width,
      y: Math.random() * c.height,
      r: Math.random() * 1.2 + 0.3,
      a: Math.random(),
      da: (Math.random() - 0.5) * 0.012
    }));
    let frame;
    function draw() {
      if (!c.isConnected) { cancelAnimationFrame(frame); return; }
      ctx.clearRect(0, 0, c.width, c.height);
      stars.forEach(s => {
        s.a += s.da;
        if (s.a > 1 || s.a < 0) s.da *= -1;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(180,160,255,${Math.max(0, Math.min(1, s.a))})`;
        ctx.fill();
      });
      frame = requestAnimationFrame(draw);
    }
    draw();
  }

  /* ── Format bytes ── */
  function formatBytes(b) {
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / (1024 * 1024)).toFixed(1) + ' MB';
  }

  /* ── Generic alert replacement ── */
  function showNbAlert(msg) {
    console.warn('[NebulaBeat Recorder]', msg);
  }

  /* ── Button binding ── */
  function bindButton() {
    const btn = document.getElementById('recordBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (REC.isRecording) stopRecording();
      else startRecording();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindButton);
  } else {
    bindButton();
  }

  window.NebulaRecorder = {
    start: startRecording,
    stop:  stopRecording,
    isRecording: () => REC.isRecording
  };

})();