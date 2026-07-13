/* ══════════════════════════════════════════
   NEBULABEAT — SPOTIFY API WRAPPER
   ══════════════════════════════════════════ */
(function () {
  'use strict';

  window.NebulaSpotify = window.NebulaSpotify || {};
  const Utils = window.NebulaSpotify.Utils;

  const BASE = 'https://api.spotify.com/v1';
  const DEFAULT_TIMEOUT = 10000;

  function hasContentType(headers) {
    return !!headers && Object.keys(headers).some(k => k.toLowerCase() === 'content-type');
  }

  function classifyError(status, retryAfterHeader) {
    if (status === 401) return { type: 'auth',       message: 'Authentication expired' };
    if (status === 403) return { type: 'client',     message: 'Forbidden — Premium may be required, or a scope is missing' };
    if (status === 404) return { type: 'client',     message: 'Not found' };
    if (status === 429) return { type: 'rate_limit', message: 'Rate limited by Spotify', retryAfter: Number(retryAfterHeader) || 1 };
    if (status >= 500)  return { type: 'server',     message: 'Spotify server error' };
    if (status >= 400)  return { type: 'client',     message: 'Request rejected' };
    return { type: 'unknown', message: 'Unexpected response' };
  }

  /* ════════════════════════════════════
     CORE REQUEST
     Every result resolves to { ok, status, data, error } — never throws —
     so no call site needs its own try/catch.
  ════════════════════════════════════ */
  async function request(path, options) {
    options = options || {};
    const Auth = window.NebulaSpotify.Auth;

    const token = await Auth.getValidToken();
    if (!token) {
      Utils.warn('API', 'No valid token — request skipped: ' + path);
      return { ok: false, status: 0, data: null, error: { type: 'auth', message: 'Not authenticated' } };
    }
    return doRequest(path, options, token, false);
  }

  async function doRequest(path, options, token, isRetry) {
    const Auth = window.NebulaSpotify.Auth;
    const url  = /^https?:\/\//.test(path) ? path : BASE + path;
    const headers = Object.assign(
      { Authorization: 'Bearer ' + token },
      (options.body && !hasContentType(options.headers)) ? { 'Content-Type': 'application/json' } : {},
      options.headers || {}
    );

    let res;
    try {
      res = await Utils.fetchWithTimeout(url, { ...options, headers }, options.timeoutMs || DEFAULT_TIMEOUT);
    } catch (err) {
      const type = err.isTimeout ? 'timeout' : 'network';
      Utils.error('API', `${type} error on ${path}`, err.message);
      return { ok: false, status: 0, data: null, error: { type, message: err.message } };
    }

    
    if (res.status === 401 && !isRetry) {
      Utils.warn('API', 'Got 401 — forcing token refresh and retrying once: ' + path);
      const fresh = await Auth.refreshNow();
      if (fresh) return doRequest(path, options, fresh, true);
    }

    let data = null;
    if (res.status !== 204) {
      try { data = await res.json(); } catch (e) {}
    }

    if (res.ok) return { ok: true, status: res.status, data, error: null };

    const error = classifyError(res.status, res.headers.get('Retry-After'));
    Utils.error('API', `${res.status} on ${path}`, error.message);
    return { ok: false, status: res.status, data, error };
  }

  /* ════════════════════════════════════
     CONVENIENCE METHODS
  ════════════════════════════════════ */
  function get(path, options)  { return request(path, { ...options, method: 'GET' }); }
  function put(path, body, options) {
    return request(path, { ...options, method: 'PUT', body: body != null ? JSON.stringify(body) : undefined });
  }
  function post(path, body, options) {
    return request(path, { ...options, method: 'POST', body: body != null ? JSON.stringify(body) : undefined });
  }

  /* ════════════════════════════════════
     REACHABILITY
  ════════════════════════════════════ */
  async function ping() {
    try {
      await Utils.fetchWithTimeout(BASE + '/me', {}, 5000);
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ════════════════════════════════════
     EXPORT
  ════════════════════════════════════ */
  window.NebulaSpotify.API = { request, get, put, post, ping };
})();