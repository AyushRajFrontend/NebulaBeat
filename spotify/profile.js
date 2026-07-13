/* ══════════════════════════════════════════
   NEBULABEAT — SPOTIFY PROFILE DASHBOARD
   ══════════════════════════════════════════ */
(function () {
  'use strict';

  window.NebulaSpotify = window.NebulaSpotify || {};
  const Utils = window.NebulaSpotify.Utils;

  const STATE = {
    loaded: false,
    profile: null,
    topGenres: [],
    topArtist: null,
    topTrack: null,
    recentActivity: null
  };

  let el = {};

  /* ════════════════════════════════════
     FORMATTING HELPERS
  ════════════════════════════════════ */
  function formatCount(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1000)    return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
  }
  function formatProduct(product) {
    if (product === 'premium') return 'Premium';
    if (product === 'free')    return 'Free';
    if (product === 'open')    return 'Free (Open)';
    return product || 'Unknown';
  }
  function formatRelativeTime(isoString) {
    const mins = Math.floor((Date.now() - new Date(isoString).getTime()) / 60000);
    if (mins < 1)  return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    const days = Math.floor(hours / 24);
    if (days < 7) return days + 'd ago';
    return new Date(isoString).toLocaleDateString();
  }

  /* ════════════════════════════════════
     RENDER — PROFILE BASICS
  ════════════════════════════════════ */
  function renderProfile() {
    const p = STATE.profile;
    const hasImage = p.images && p.images.length > 0;

    if (el.image) {
      el.image.style.display = hasImage ? 'block' : 'none';
      if (hasImage) el.image.src = p.images[0].url;
    }
    if (el.imageFallback) {
      el.imageFallback.style.display = hasImage ? 'none' : 'flex';
      el.imageFallback.textContent = (p.display_name || '?').charAt(0).toUpperCase();
    }
    if (el.name)         el.name.textContent = p.display_name || 'Spotify User';
    if (el.followers)    el.followers.textContent = formatCount(p.followers?.total || 0) + ' followers';
    if (el.country)      el.country.textContent = p.country || '—';
    if (el.subscription) el.subscription.textContent = formatProduct(p.product);
    if (el.premiumBadge) el.premiumBadge.style.display = p.product === 'premium' ? 'inline-flex' : 'none';
    if (el.profileLink)  el.profileLink.href = p.external_urls?.spotify || '#';
  }

  function renderLoading() {
    if (el.name) el.name.textContent = 'Loading…';
  }
  function renderError() {
    if (el.name) el.name.textContent = 'Couldn\'t load your profile.';
    Utils.toast('Couldn\'t load your Spotify profile.', 'warning');
  }

  /* ════════════════════════════════════
     RENDER — LISTENING STATS / RECENT ACTIVITY
  ════════════════════════════════════ */
  function renderStats() {
    if (el.topGenres) {
      el.topGenres.innerHTML = STATE.topGenres.length
        ? STATE.topGenres.map(g => `<span class="spprof-genre-chip">${Utils.escapeHtml(g)}</span>`).join('')
        : '<span class="spprof-stat-empty">Not enough listening history yet.</span>';
    }
    if (el.topArtist) el.topArtist.textContent = STATE.topArtist ? STATE.topArtist.name : '—';
    if (el.topTrack)  el.topTrack.textContent  = STATE.topTrack
      ? STATE.topTrack.name + ' — ' + STATE.topTrack.artists.map(a => a.name).join(', ')
      : '—';
  }

  function renderRecentActivity() {
    if (!el.recentActivity) return;
    const a = STATE.recentActivity;
    el.recentActivity.innerHTML = a
      ? `Last played <strong>${Utils.escapeHtml(a.track.name)}</strong> — ${formatRelativeTime(a.playedAt)}`
      : 'No recent activity.';
  }

  /* ════════════════════════════════════
     FETCH — basics first, stats/activity as progressive enhancements
  ════════════════════════════════════ */
  async function loadProfile() {
    if (STATE.loaded) return;
    renderLoading();

    const API = window.NebulaSpotify.API;
    const r = await API.get('/me');
    if (!r.ok) {
      Utils.error('Profile', 'Failed to load profile', r.error);
      renderError();
      return;
    }
    STATE.profile = r.data;
    STATE.loaded = true;
    renderProfile();

    loadListeningStats();
    loadRecentActivity();
  }

  async function loadListeningStats() {
    const API = window.NebulaSpotify.API;
    const [artistsRes, trackRes] = await Promise.all([
      API.get('/me/top/artists?limit=15&time_range=short_term'),
      API.get('/me/top/tracks?limit=1&time_range=short_term')
    ]);

    if (artistsRes.ok) {
      const artists = artistsRes.data?.items || [];
      const genreCounts = {};
      artists.forEach(a => (a.genres || []).forEach(g => { genreCounts[g] = (genreCounts[g] || 0) + 1; }));
      STATE.topGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g]) => g);
      STATE.topArtist = artists[0] || null;
    } else {
      Utils.warn('Profile', 'Top artists fetch failed', artistsRes.error);
    }

    if (trackRes.ok && trackRes.data?.items?.[0]) {
      STATE.topTrack = trackRes.data.items[0];
    }

    renderStats();
  }

  async function loadRecentActivity() {
    const API = window.NebulaSpotify.API;
    const r = await API.get('/me/player/recently-played?limit=1');
    if (r.ok && r.data?.items?.length) {
      const item = r.data.items[0];
      STATE.recentActivity = { track: item.track, playedAt: item.played_at };
    }
    renderRecentActivity();
  }

  /* ════════════════════════════════════
     INIT
  ════════════════════════════════════ */
  function init() {
    el = {
      image:         document.getElementById('spProfileImage'),
      imageFallback: document.getElementById('spProfileImageFallback'),
      name:          document.getElementById('spProfileName'),
      followers:     document.getElementById('spProfileFollowers'),
      country:       document.getElementById('spProfileCountry'),
      subscription:  document.getElementById('spProfileSubscription'),
      premiumBadge:  document.getElementById('spProfilePremiumBadge'),
      profileLink:   document.getElementById('spProfileLink'),
      topGenres:       document.getElementById('spProfileTopGenres'),
      topArtist:       document.getElementById('spProfileTopArtist'),
      topTrack:        document.getElementById('spProfileTopTrack'),
      recentActivity:  document.getElementById('spProfileRecentActivity')
    };
    window.NebulaSpotify.Utils.registerPanel('profile', 'spProfileSection', loadProfile);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.NebulaSpotify.Profile = {
    refresh: () => { STATE.loaded = false; loadProfile(); },
    getProfile: () => STATE.profile
  };
})();
