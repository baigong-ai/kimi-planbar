// ==UserScript==
// @name         Kimi Code Web - Quota Badge
// @namespace    local.kimi-code
// @version      1.2
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

  function getToken() {
    try {
      const raw = localStorage.getItem(CRED_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      // {version:1, credential:"...", expiresAt:...}; tolerate a raw token too
      if (obj && typeof obj.credential === 'string') return obj.credential;
      return typeof raw === 'string' && raw.length > 10 ? raw : null;
    } catch {
      return null;
    }
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

  async function refresh() {
    const t = theme();
    badge.style.background = t.badgeBg;
    badge.style.color = t.badgeFg;
    badge.style.border = t.border;
    try {
      const tok = getToken(); // re-read every cycle: survives credential rotation
      if (!tok) throw new Error('no token');
      const r = await fetch('/api/v1/oauth/usage', {
        headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json' },
      });
      if (!r.ok) throw new Error(String(r.status));
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
    }
  }

  badge.addEventListener('click', refresh);
  refresh();
  setInterval(refresh, REFRESH_MS);
})();
