// ==UserScript==
// @name         Kimi Code Web - Quota Badge
// @namespace    local.kimi-code
// @version      1.4
// @description  Show Kimi For Coding plan quota (5h / week) as a floating badge on the Kimi Code web UI
// @match        http://127.0.0.1/*
// @match        http://localhost/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const CRED_KEY = 'kimi-web.server-credential';
  const REFRESH_MS = 60_000;

  // v0.32 note: the server now requires its own bearer token (printed at
  // startup as a #token= URL) on every REST route — the old OAuth credential
  // is rejected with 401. After the web UI logs in, the new credential lands
  // in this same localStorage key, so reading it here still works.
  function readCred(store) {
    try {
      const raw = store.getItem(CRED_KEY);
      if (!raw) return null;
      try {
        const obj = JSON.parse(raw);
        // {version:1, credential:"...", expiresAt:<ms epoch>}
        if (obj && typeof obj.credential === 'string') {
          // Respect expiresAt: the web UI treats an expired credential as
          // absent; sending it anyway just earns a 401.
          if (typeof obj.expiresAt === 'number' && obj.expiresAt <= Date.now()) return null;
          return obj.credential;
        }
      } catch { /* not JSON — legacy raw token */ }
      return raw.length > 10 ? raw : null;
    } catch {
      return null;
    }
  }

  function getToken() {
    return readCred(localStorage) || readCred(sessionStorage);
  }

  // The other credential, if any, after `seen` was rejected with 401/403.
  function altToken(seen) {
    for (const store of [localStorage, sessionStorage]) {
      const t = readCred(store);
      if (t && t !== seen) return t;
    }
    return null;
  }

  async function fetchUsage(tok) {
    return fetch('/api/v1/oauth/usage', {
      headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json' },
    });
  }

  const token = getToken();
  if (!token) return; // not a Kimi Code web UI page — stay out of the way
  // Note: refresh() re-reads the token from localStorage on every cycle so
  // credential rotation doesn't strand the badge until a page reload.

  // Two palettes: the badge must stay readable on both dark and light pages.
  // The old single dark palette washed out on light pages (a 55%-black pill
  // over a white page reads as mid-grey, killing the light text's contrast).
  const DARK = {
    badgeBg: 'rgba(0,0,0,.55)', badgeFg: '#ccc', border: '1px solid rgba(255,255,255,.08)',
    red: '#e5534b', yellow: '#d4a72c', green: '#57ab5a', sep: '#666', err: '#888',
  };
  const LIGHT = {
    badgeBg: 'rgba(255,255,255,.78)', badgeFg: '#24292f', border: '1px solid rgba(0,0,0,.12)',
    red: '#cf222e', yellow: '#9a6700', green: '#1a7f37', sep: '#8c959f', err: '#57606a',
  };

  // Detect the page's own theme from the computed body background rather than
  // trusting the OS preference; re-evaluated every refresh so toggles apply.
  function theme() {
    try {
      const m = getComputedStyle(document.body).backgroundColor
        .match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
      if (m && (m[4] === undefined || parseFloat(m[4]) >= 0.5)) {
        const lum = (0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3]) / 255;
        return lum > 0.6 ? LIGHT : DARK;
      }
    } catch { /* fall through to OS preference */ }
    return matchMedia('(prefers-color-scheme: light)').matches ? LIGHT : DARK;
  }

  function color(pct, t) {
    return pct >= 85 ? t.red : pct >= 60 ? t.yellow : t.green;
  }

  function fmtReset(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return sameDay ? hm : `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${hm}`;
  }

  const badge = document.createElement('div');
  badge.title = 'Kimi For Coding quota (click to refresh)';
  badge.style.cssText = [
    'position:fixed', 'top:8px', 'right:12px', 'z-index:99999',
    'font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace',
    'padding:2px 10px', 'border-radius:999px', 'cursor:pointer',
    'background:rgba(0,0,0,.55)', 'color:#ccc', 'backdrop-filter:blur(4px)',
    'user-select:none', 'white-space:nowrap',
  ].join(';');
  badge.textContent = 'quota …';
  document.documentElement.appendChild(badge);

  // --- Placement: stay clear of the chat header's own buttons -------------
  // The badge is a fixed overlay; the header's right-side button cluster
  // (Files panel button on patched UIs, git/PR pills on stock) sits exactly
  // where a naive `right:12px` badge lands, and the badge covered it. Anchor
  // the badge just LEFT of that cluster instead, recomputed as the UI changes.
  // `top`/`right` in the cssText above are the fallback when no header exists.
  const DEFAULT_RIGHT = 12;
  function placeBadge() {
    const header = document.querySelector('header.chat-header');
    const spacer = header && header.querySelector('.ch-spacer');
    const firstBtn = spacer && spacer.nextElementSibling;
    if (firstBtn) {
      badge.style.right = `${Math.max(DEFAULT_RIGHT, innerWidth - firstBtn.getBoundingClientRect().left + 8)}px`;
      const hr = header.getBoundingClientRect();
      badge.style.top = `${hr.top + (hr.height - badge.offsetHeight) / 2}px`;
    } else {
      badge.style.right = `${DEFAULT_RIGHT}px`;
      badge.style.top = '8px';
    }
  }
  // Header buttons mount/unmount reactively (git/PR pills, Files button) and
  // the header itself is swapped on SPA navigation, so watch the whole tree;
  // the rAF guard keeps this to one rect read per frame even while streaming.
  let placeScheduled = false;
  function schedulePlace() {
    if (placeScheduled) return;
    placeScheduled = true;
    requestAnimationFrame(() => { placeScheduled = false; placeBadge(); });
  }
  new MutationObserver(schedulePlace).observe(document.body, { childList: true, subtree: true });
  addEventListener('resize', schedulePlace);
  placeBadge();

  async function refresh() {
    const t = theme();
    badge.style.background = t.badgeBg;
    badge.style.color = t.badgeFg;
    badge.style.border = t.border;
    try {
      let tok = getToken(); // re-read every cycle: survives credential rotation
      if (!tok) throw new Error('no token');
      let r = await fetchUsage(tok);
      // v0.32: a stale credential (e.g. the pre-0.32 OAuth token) earns a 401.
      // Try the credential from the other storage before giving up.
      if (r.status === 401 || r.status === 403) {
        const alt = altToken(tok);
        if (alt) {
          tok = alt;
          r = await fetchUsage(tok);
        }
      }
      if (!r.ok) throw new Error(String(r.status));
      badge.title = 'Kimi For Coding quota (click to refresh)';
      const { data } = await r.json();
      if (!data || data.kind !== 'ok') throw new Error('no data');

      // Build DOM nodes instead of innerHTML: API values stay text, never markup.
      const frag = document.createDocumentFragment();
      let count = 0;
      const add = (txt, p) => {
        if (count > 0) {
          const sep = document.createElement('span');
          sep.style.color = t.sep;
          sep.textContent = ' · ';
          frag.appendChild(sep);
        }
        count += 1;
        const s = document.createElement('span');
        s.style.color = color(p, t);
        s.textContent = txt;
        frag.appendChild(s);
      };
      const five = (data.limits || []).find(
        (l) => l.window && l.window.unit === 'hour' && l.window.duration === 5
      ) || (data.limits || [])[0];
      if (five && five.limit) {
        const p = (five.used / five.limit) * 100;
        add(`5h ${p.toFixed(0)}% (rst ${fmtReset(five.reset_at)})`, p);
      }
      const w = data.summary;
      if (w && w.limit) {
        const p = (w.used / w.limit) * 100;
        add(`week ${p.toFixed(0)}% (rst ${fmtReset(w.reset_at)})`, p);
      }
      if (count > 0) badge.replaceChildren(frag);
      else badge.textContent = 'quota n/a';
    } catch {
      badge.textContent = 'quota ?';
      badge.style.color = t.err;
      // Actionable hint: after a Kimi Code upgrade the stored credential may
      // be stale; re-opening the web UI from the CLI's #token= URL fixes it.
      badge.title = 'quota fetch failed — if you just upgraded Kimi Code, re-open the web UI from the #token= URL the CLI printed, then click here';
    }
  }

  badge.addEventListener('click', refresh);
  refresh();
  setInterval(refresh, REFRESH_MS);
})();
