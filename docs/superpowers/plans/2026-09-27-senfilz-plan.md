# SenFilz Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task.

**Goal:** Build a standalone peer-to-peer file transfer tool (SenFilz) with a WebRTC frontend and a Node.js WebSocket signaling server.

**Architecture:** Static frontend (index.html + assets/) handles all WebRTC logic and UI state; a minimal Node.js WS server relays only SDP/ICE — never file data; TURN via Metered.ca as fallback for restrictive networks.

**Tech Stack:** Vanilla JS (no build step), WebRTC RTCDataChannel, ws@8 (Node.js), qrcodejs (CDN), Inter (Google Fonts)

**Spec:** `docs/superpowers/specs/2026-09-27-senfilz-design.md`

## Global Constraints
- No frameworks, no build step — plain HTML/CSS/JS
- All design tokens match spec §4 exactly (accent `#6366f1`, bg-base `#08090d`, etc.)
- Error message copy must match spec §5.4 verbatim
- TURN credentials are placeholders: `METERED_USERNAME` / `METERED_CREDENTIAL`
- WS server URL placeholder: `wss://YOUR_SIGNALING_SERVER`
- Chunk size: 64 KB (`64 * 1024`)
- Rate limit: 5 creates per 60 s per IP
- Code expiry: 10 minutes, single-use
- File size warning threshold: 2 GB (`2 * 1024 * 1024 * 1024`)

## File Map
- Create: `assets/style.css` — full design system
- Create: `assets/app.js` — utilities + state machines + WebRTC
- Create: `index.html` — main tool page
- Create: `terms.html` — Terms of Service
- Create: `privacy.html` — Privacy Policy
- Create: `signaling/package.json`
- Create: `signaling/server.js` — WS signaling server

---

### Task 1: assets/style.css — Design System

**Files:** Create `assets/style.css`

- [ ] Write CSS reset, tokens (dark + light), base body/layout styles, nav, glass-card, buttons, upload-zone, progress bars, badges, steps, FAQ accordion, result/warning/info boxes, toast, footer, animations, responsive breakpoints, accessibility rules — all matching spec §4.
- [ ] Add two new components: `.code-display` (large mono pill with copy button) and `.code-input` (6-cell flex row of single-char inputs).
- [ ] Open `index.html` (empty) locally in browser and verify tokens resolve (no red in DevTools computed styles).

---

### Task 2: signaling/server.js

**Files:** Create `signaling/package.json`, `signaling/server.js`

- [ ] Write `package.json`:
```json
{
  "name": "senfilz-signaling",
  "version": "1.0.0",
  "main": "server.js",
  "dependencies": { "ws": "^8.0.0" }
}
```

- [ ] Write `server.js` — full implementation:
```js
'use strict';
const { WebSocketServer } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8080;
const CODE_TTL = 10 * 60 * 1000;      // 10 min
const RATE_LIMIT = 5;
const RATE_WINDOW = 60 * 1000;        // 60 s

// Map<code, { senderWs, receiverWs, offer, createdAt, used }>
const sessions = new Map();
// Map<ip, { count, windowStart }>
const rateLimits = new Map();

function generateCode() {
  let code;
  do { code = String(Math.floor(100000 + Math.random() * 900000)); }
  while (sessions.has(code));
  return code;
}

function checkRate(ip) {
  const now = Date.now();
  const rec = rateLimits.get(ip) || { count: 0, windowStart: now };
  if (now - rec.windowStart > RATE_WINDOW) { rec.count = 0; rec.windowStart = now; }
  rec.count++;
  rateLimits.set(ip, rec);
  return rec.count <= RATE_LIMIT;
}

function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function err(ws, message) { send(ws, { type: 'error', message }); }

// Cleanup expired/used sessions every 60 s
setInterval(() => {
  const now = Date.now();
  for (const [code, s] of sessions) {
    if (s.used || now - s.createdAt > CODE_TTL) sessions.delete(code);
  }
}, 60_000);

const server = http.createServer((req, res) => {
  res.writeHead(200); res.end('SenFilz signaling OK');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim()
           || req.socket.remoteAddress || 'unknown';
  let assignedCode = null;

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'create': {
        if (!checkRate(ip)) {
          err(ws, 'Too many sessions. Try again in a minute.');
          return ws.close();
        }
        const code = generateCode();
        sessions.set(code, {
          senderWs: ws, receiverWs: null,
          offer: null, createdAt: Date.now(), used: false
        });
        assignedCode = code;
        send(ws, { type: 'code', code });
        break;
      }
      case 'offer': {
        const s = sessions.get(msg.code);
        if (!s || s.used || Date.now() - s.createdAt > CODE_TTL) return;
        s.offer = msg.offer;
        break;
      }
      case 'join': {
        const s = sessions.get(msg.code);
        if (!s || s.used || Date.now() - s.createdAt > CODE_TTL) {
          return err(ws, 'That code is invalid or has already been used. Codes expire after 10 minutes and can only be used once.');
        }
        s.used = true;
        s.receiverWs = ws;
        assignedCode = msg.code;
        send(ws, { type: 'offer', offer: s.offer });
        send(s.senderWs, { type: 'receiver-joined' });
        break;
      }
      case 'answer': {
        const s = sessions.get(msg.code);
        if (!s) return;
        send(s.senderWs, { type: 'answer', answer: msg.answer });
        break;
      }
      case 'ice': {
        const s = sessions.get(msg.code);
        if (!s) return;
        const target = ws === s.senderWs ? s.receiverWs : s.senderWs;
        send(target, { type: 'ice', candidate: msg.candidate });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!assignedCode) return;
    const s = sessions.get(assignedCode);
    if (!s) return;
    // Notify the other peer if mid-session
    if (ws === s.senderWs && s.receiverWs) {
      send(s.receiverWs, { type: 'peer-disconnected' });
    } else if (ws === s.receiverWs && s.senderWs) {
      send(s.senderWs, { type: 'peer-disconnected' });
    }
    sessions.delete(assignedCode);
  });
});

server.listen(PORT, () => console.log(`SenFilz signaling on :${PORT}`));
```

- [ ] `cd signaling && npm install`
- [ ] `node server.js` — verify "SenFilz signaling on :8080" in console
- [ ] Open second terminal: `curl http://localhost:8080` — verify "SenFilz signaling OK"
- [ ] Test rate limit manually with wscat or Node REPL: send 6 `create` messages in <60 s from same IP — 6th should return error and close.
- [ ] Kill server. Commit: `git add signaling/ && git commit -m "feat: add WS signaling server"`

---

### Task 3: assets/app.js — Utilities + Theme + Shared UI

**Files:** Create `assets/app.js`

- [ ] Write utility functions and classes:
```js
'use strict';

// ── Config (update before deploy) ──────────────────────────────────────────
const WS_URL = 'wss://YOUR_SIGNALING_SERVER';
const TURN_USERNAME   = 'METERED_USERNAME';
const TURN_CREDENTIAL = 'METERED_CREDENTIAL';
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'turn:relay.metered.ca:80',              username: TURN_USERNAME, credential: TURN_CREDENTIAL },
  { urls: 'turn:relay.metered.ca:443',             username: TURN_USERNAME, credential: TURN_CREDENTIAL },
  { urls: 'turn:relay.metered.ca:443?transport=tcp', username: TURN_USERNAME, credential: TURN_CREDENTIAL },
];

const CHUNK_SIZE    = 64 * 1024;
const SIZE_WARN     = 2 * 1024 * 1024 * 1024;   // 2 GB
const CODE_TTL_MS   = 10 * 60 * 1000;
const CONNECT_TIMEOUT = 30_000;

// ── Helpers ────────────────────────────────────────────────────────────────
function formatBytes(bytes, decimals = 1) {
  if (!bytes) return '0 B';
  const k = 1024, sizes = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

function formatSpeed(bytesPerSec) {
  return formatBytes(bytesPerSec) + '/s';
}

// ── Theme ──────────────────────────────────────────────────────────────────
const Theme = {
  init() {
    const saved  = localStorage.getItem('sf-theme');
    const system = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    this.apply(saved || system);
  },
  apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('sf-theme', theme);
    document.querySelectorAll('.theme-toggle').forEach(btn => {
      btn.innerHTML    = theme === 'dark' ? Icons.sun() : Icons.moon();
      btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    });
  },
  toggle() {
    this.apply(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
  }
};

// ── Toaster ────────────────────────────────────────────────────────────────
const Toaster = {
  _c: null,
  _container() {
    if (!this._c) {
      this._c = Object.assign(document.createElement('div'), { className: 'toast-container' });
      this._c.setAttribute('aria-live', 'polite');
      document.body.appendChild(this._c);
    }
    return this._c;
  },
  _show(msg, type, dur) {
    const t = Object.assign(document.createElement('div'), { className: `toast toast--${type}`, textContent: msg });
    t.setAttribute('role', 'status');
    this._container().appendChild(t);
    const dismiss = () => { t.classList.add('dismissing'); t.addEventListener('animationend', () => t.remove(), { once: true }); };
    const timer = setTimeout(dismiss, dur);
    t.addEventListener('click', () => { clearTimeout(timer); dismiss(); });
  },
  success(m, d=4000) { this._show(m,'success',d); },
  error(m,   d=6000) { this._show(m,'error',  d); },
  info(m,    d=4000) { this._show(m,'info',   d); }
};

// ── Downloader ─────────────────────────────────────────────────────────────
const Downloader = {
  download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = Object.assign(document.createElement('a'), { href: url, download: filename, style: 'display:none' });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
};

// ── Icons ──────────────────────────────────────────────────────────────────
const Icons = {
  sun:      () => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,
  moon:     () => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
  upload:   () => `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  copy:     () => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  check:    () => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`,
  warning:  () => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;margin-top:1px"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  file:     () => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`,
  x:        () => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
};
```

- [ ] Verify in browser console: `formatBytes(1536)` → `"1.5 KB"`, `formatBytes(2 * 1024 * 1024 * 1024)` → `"2 GB"`
- [ ] Commit: `git commit -m "feat: add app.js utilities and config"`

---

### Task 4: assets/app.js — Sender State Machine

**Files:** Append to `assets/app.js`

- [ ] Append sender logic:
```js
// ── Sender ─────────────────────────────────────────────────────────────────
class Sender {
  constructor(panel) {
    this.panel      = panel;
    this.files      = [];
    this.ws         = null;
    this.pc         = null;
    this.channel    = null;
    this.code       = null;
    this.timeoutId  = null;
    this.countdownId= null;
    this.codeCreatedAt = null;
    this._state     = 'idle';
    this._bindDrop();
  }

  setState(s) {
    this._state = s;
    this.panel.dataset.state = s;
  }

  _bindDrop() {
    const zone  = this.panel.querySelector('.upload-zone');
    const input = zone.querySelector('input[type="file"]');
    input.setAttribute('multiple', '');
    input.addEventListener('change', e => { this._addFiles(Array.from(e.target.files)); e.target.value = ''; });
    zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', e => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over'); });
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag-over'); this._addFiles(Array.from(e.dataTransfer.files)); });
  }

  _addFiles(newFiles) {
    this.files.push(...newFiles);
    this._renderFileList();
    this.panel.querySelector('.sender-send-btn').hidden = this.files.length === 0;
  }

  _removeFile(idx) {
    this.files.splice(idx, 1);
    this._renderFileList();
    this.panel.querySelector('.sender-send-btn').hidden = this.files.length === 0;
  }

  _renderFileList() {
    const list = this.panel.querySelector('.file-list');
    const warnBox = this.panel.querySelector('.size-warning');
    const totalEl = this.panel.querySelector('.file-list-total');
    list.innerHTML = '';
    let totalSize = 0, hasLarge = false;
    this.files.forEach((f, i) => {
      totalSize += f.size;
      if (f.size > SIZE_WARN) hasLarge = true;
      const item = document.createElement('div');
      item.className = 'file-list-item';
      item.innerHTML = `<span class="file-list-icon">${Icons.file()}</span>
        <span class="file-list-name" title="${f.name}">${f.name}</span>
        <span class="file-list-size">${formatBytes(f.size)}</span>
        <button class="file-list-remove btn btn-ghost btn-sm" aria-label="Remove ${f.name}">${Icons.x()}</button>`;
      item.querySelector('.file-list-remove').addEventListener('click', () => this._removeFile(i));
      list.appendChild(item);
    });
    warnBox.hidden = !hasLarge;
    totalEl.textContent = this.files.length > 0
      ? `${this.files.length} file${this.files.length > 1 ? 's' : ''} · ${formatBytes(totalSize)}`
      : '';
  }

  async start() {
    if (this.files.length === 0) return;
    this.setState('waiting');
    this.ws = new WebSocket(WS_URL);

    this.ws.onopen  = () => this.ws.send(JSON.stringify({ type: 'create' }));
    this.ws.onerror = () => this._showError('timeout');
    this.ws.onmessage = async e => {
      const msg = JSON.parse(e.data);
      switch (msg.type) {
        case 'code':
          this.code = msg.code;
          this.codeCreatedAt = Date.now();
          this._showCode(msg.code);
          await this._setupPeer();
          break;
        case 'receiver-joined':
          this.setState('connecting');
          this._startTimeout();
          break;
        case 'answer':
          await this.pc.setRemoteDescription(msg.answer);
          break;
        case 'ice':
          if (msg.candidate) await this.pc.addIceCandidate(msg.candidate);
          break;
        case 'peer-disconnected':
          if (this._state === 'transferring') this._showError('interrupted-sender');
          break;
        case 'error':
          this._showError('timeout');
          break;
      }
    };
  }

  async _setupPeer() {
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.channel = this.pc.createDataChannel('senfilz', { ordered: true });

    this.channel.onopen = () => {
      clearTimeout(this.timeoutId);
      this.setState('transferring');
      this._sendFiles();
    };

    this.pc.onicecandidate = e => {
      if (e.candidate) this.ws.send(JSON.stringify({ type: 'ice', code: this.code, candidate: e.candidate }));
    };

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.ws.send(JSON.stringify({ type: 'offer', code: this.code, offer }));
  }

  _showCode(code) {
    const display = this.panel.querySelector('.code-display-value');
    display.textContent = code;
    // QR
    const qrEl = this.panel.querySelector('#sender-qr');
    qrEl.innerHTML = '';
    new QRCode(qrEl, { text: `${location.origin}/?code=${code}`, width: 160, height: 160, colorDark: '#6366f1', colorLight: 'transparent' });
    // Countdown
    this._startCountdown();
  }

  _startCountdown() {
    const el = this.panel.querySelector('.code-countdown');
    const tick = () => {
      const remaining = CODE_TTL_MS - (Date.now() - this.codeCreatedAt);
      if (remaining <= 0) { el.textContent = 'Code expired'; return; }
      const m = Math.floor(remaining / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      el.textContent = `Expires in ${m}:${String(s).padStart(2,'0')}`;
    };
    tick();
    this.countdownId = setInterval(tick, 1000);
  }

  _startTimeout() {
    this.timeoutId = setTimeout(() => {
      this._showError('timeout');
    }, CONNECT_TIMEOUT);
  }

  async _sendFiles() {
    const totalBytes = this.files.reduce((a, f) => a + f.size, 0);
    const progOverall = this.panel.querySelector('.progress-overall');
    const progFile    = this.panel.querySelector('.progress-file');
    const fileLabel   = this.panel.querySelector('.transfer-label');
    let totalSent = 0;
    const startTime = Date.now();

    // Session-level meta
    this.channel.send(JSON.stringify({ type: 'session-meta', totalFiles: this.files.length, totalBytes }));

    for (let i = 0; i < this.files.length; i++) {
      const file = this.files[i];
      fileLabel.textContent = `Sending ${i + 1} of ${this.files.length} — ${file.name}`;

      // Per-file meta
      this.channel.send(JSON.stringify({ type: 'meta', index: i, total: this.files.length, name: file.name, size: file.size, mimeType: file.type }));

      let offset = 0;
      await new Promise(resolve => {
        const sendChunk = () => {
          if (offset >= file.size) {
            this.channel.send(JSON.stringify({ type: 'file-done', index: i }));
            resolve();
            return;
          }
          const slice = file.slice(offset, offset + CHUNK_SIZE);
          const reader = new FileReader();
          reader.onload = ev => {
            const buf = ev.target.result;
            this.channel.send(buf);
            offset    += buf.byteLength;
            totalSent += buf.byteLength;

            const filePct    = Math.round(offset / file.size * 100);
            const overallPct = Math.round(totalSent / totalBytes * 100);
            const speed      = formatSpeed((totalSent / (Date.now() - startTime)) * 1000);

            progFile.querySelector('.progress-fill').style.width    = filePct + '%';
            progOverall.querySelector('.progress-fill').style.width = overallPct + '%';
            progOverall.querySelector('.progress-pct').textContent  = overallPct + '% · ' + speed;

            if (this.channel.bufferedAmount < CHUNK_SIZE * 4) sendChunk();
            else this.channel.onbufferedamountlow = sendChunk;
          };
          reader.readAsArrayBuffer(slice);
        };
        sendChunk();
      });
    }

    this.channel.send(JSON.stringify({ type: 'all-done' }));
    clearInterval(this.countdownId);
    this.setState('done');
  }

  _showError(kind) {
    clearTimeout(this.timeoutId);
    clearInterval(this.countdownId);
    this.pc?.close();
    this.ws?.close();
    this.panel.querySelector('.error-msg').textContent =
      kind === 'timeout'
        ? 'Could not establish a direct connection. This sometimes happens on restrictive networks (corporate VPNs, firewalls). Try a different network or ask the sender to retry.'
        : 'An unexpected error occurred. Please try again.';
    this.setState('error');
  }

  cancel() {
    clearTimeout(this.timeoutId);
    clearInterval(this.countdownId);
    this.pc?.close();
    this.ws?.close();
    this.files = [];
    this.setState('idle');
    this.panel.querySelector('.file-list').innerHTML = '';
    this.panel.querySelector('.sender-send-btn').hidden = true;
  }
}
```

- [ ] Commit: `git commit -m "feat: sender state machine"`

---

### Task 5: assets/app.js — Receiver State Machine

**Files:** Append to `assets/app.js`

- [ ] Append receiver logic:
```js
// ── Receiver ───────────────────────────────────────────────────────────────
class Receiver {
  constructor(panel) {
    this.panel      = panel;
    this.ws         = null;
    this.pc         = null;
    this.code       = null;
    this.timeoutId  = null;
    this._state     = 'idle';
    this._chunks    = [];
    this._currentMeta = null;
    this._totalFiles  = 0;
    this._totalBytes  = 0;
    this._receivedBytes = 0;
    this._startTime   = null;
    this._bindCodeInput();
  }

  setState(s) { this._state = s; this.panel.dataset.state = s; }

  _bindCodeInput() {
    const cells = Array.from(this.panel.querySelectorAll('.code-input-cell'));
    cells.forEach((cell, i) => {
      cell.addEventListener('input', () => {
        cell.value = cell.value.replace(/\D/g, '').slice(-1);
        if (cell.value && i < cells.length - 1) cells[i + 1].focus();
        this._checkComplete(cells);
      });
      cell.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !cell.value && i > 0) cells[i - 1].focus();
      });
      cell.addEventListener('paste', e => {
        e.preventDefault();
        const digits = (e.clipboardData.getData('text') || '').replace(/\D/g,'').slice(0, 6);
        digits.split('').forEach((d, j) => { if (cells[j]) cells[j].value = d; });
        const next = cells[Math.min(digits.length, cells.length - 1)];
        if (next) next.focus();
        this._checkComplete(cells);
      });
    });
  }

  _checkComplete(cells) {
    const code = cells.map(c => c.value).join('');
    this.panel.querySelector('.receiver-connect-btn').disabled = code.length < 6;
  }

  getCode() {
    return Array.from(this.panel.querySelectorAll('.code-input-cell')).map(c => c.value).join('');
  }

  async connect() {
    const code = this.getCode();
    if (code.length < 6) return;
    this.code = code;
    this.setState('connecting');

    this.timeoutId = setTimeout(() => this._showError('timeout'), CONNECT_TIMEOUT);

    this.ws = new WebSocket(WS_URL);
    this.ws.onopen  = () => this.ws.send(JSON.stringify({ type: 'join', code }));
    this.ws.onerror = () => this._showError('timeout');
    this.ws.onmessage = async e => {
      const msg = JSON.parse(e.data);
      switch (msg.type) {
        case 'offer':
          await this._handleOffer(msg.offer);
          break;
        case 'ice':
          if (msg.candidate) await this.pc.addIceCandidate(msg.candidate);
          break;
        case 'peer-disconnected':
          if (this._state === 'receiving') this._showError('interrupted');
          break;
        case 'error':
          clearTimeout(this.timeoutId);
          this._showError('bad-code');
          break;
      }
    };
  }

  async _handleOffer(offer) {
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    await this.pc.setRemoteDescription(offer);

    this.pc.onicecandidate = e => {
      if (e.candidate) this.ws.send(JSON.stringify({ type: 'ice', code: this.code, candidate: e.candidate }));
    };

    this.pc.ondatachannel = e => {
      const ch = e.channel;
      ch.binaryType = 'arraybuffer';
      ch.onopen = () => { clearTimeout(this.timeoutId); this.setState('receiving'); this._startTime = Date.now(); };
      ch.onmessage = ev => this._onData(ev.data);
    };

    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.ws.send(JSON.stringify({ type: 'answer', code: this.code, answer }));
  }

  _onData(data) {
    // Control message (string) vs chunk (ArrayBuffer)
    if (typeof data === 'string') {
      const msg = JSON.parse(data);
      switch (msg.type) {
        case 'session-meta':
          this._totalFiles = msg.totalFiles;
          this._totalBytes = msg.totalBytes;
          break;
        case 'meta':
          this._currentMeta = msg;
          this._chunks = [];
          this._showReceivingFile(msg);
          break;
        case 'file-done':
          this._assembleAndDownload();
          break;
        case 'all-done':
          this.setState('done');
          break;
      }
      return;
    }
    // Binary chunk
    this._chunks.push(data);
    this._receivedBytes += data.byteLength;
    this._updateProgress();
  }

  _showReceivingFile(meta) {
    const label = this.panel.querySelector('.transfer-label');
    label.textContent = `Receiving ${meta.index + 1} of ${meta.total} — ${meta.name}`;
    // 2 GB warning
    this.panel.querySelector('.size-warning').hidden = meta.size <= SIZE_WARN;
    this.panel.querySelector('.progress-file .progress-fill').style.width = '0%';
  }

  _updateProgress() {
    if (!this._currentMeta) return;
    const fileBytesReceived = this._chunks.reduce((a, c) => a + c.byteLength, 0);
    const filePct    = Math.round(fileBytesReceived / this._currentMeta.size * 100);
    const overallPct = Math.round(this._receivedBytes / this._totalBytes * 100);
    const speed      = formatSpeed((this._receivedBytes / (Date.now() - this._startTime)) * 1000);

    this.panel.querySelector('.progress-file .progress-fill').style.width    = filePct + '%';
    this.panel.querySelector('.progress-overall .progress-fill').style.width = overallPct + '%';
    this.panel.querySelector('.progress-overall .progress-pct').textContent  = overallPct + '% · ' + speed;
  }

  _assembleAndDownload() {
    const blob = new Blob(this._chunks, { type: this._currentMeta.mimeType || 'application/octet-stream' });
    Downloader.download(blob, this._currentMeta.name);
    this._chunks = [];
  }

  _showError(kind) {
    clearTimeout(this.timeoutId);
    this.pc?.close();
    this.ws?.close();
    const msgs = {
      timeout:     'Could not establish a direct connection. This sometimes happens on restrictive networks (corporate VPNs, firewalls). Try a different network or ask the sender to retry.',
      interrupted: 'Transfer interrupted — the sender disconnected before the file finished.',
      'bad-code':  'That code is invalid or has already been used. Codes expire after 10 minutes and can only be used once.'
    };
    this.panel.querySelector('.error-msg').textContent = msgs[kind] || msgs.timeout;
    this.setState('error');
  }

  reset() {
    clearTimeout(this.timeoutId);
    this.pc?.close();
    this.ws?.close();
    this.panel.querySelectorAll('.code-input-cell').forEach(c => c.value = '');
    this.panel.querySelector('.receiver-connect-btn').disabled = true;
    this._chunks = []; this._receivedBytes = 0;
    this.setState('idle');
  }
}
```

- [ ] Commit: `git commit -m "feat: receiver state machine"`

---

### Task 6: App Init + URL Code Pre-fill

**Files:** Append to `assets/app.js`

- [ ] Append init logic:
```js
// ── Boot ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  Theme.init();
  document.querySelectorAll('.theme-toggle').forEach(btn =>
    btn.addEventListener('click', () => Theme.toggle())
  );

  const senderPanel   = document.getElementById('sender-panel');
  const receiverPanel = document.getElementById('receiver-panel');
  const tabSend       = document.getElementById('tab-send');
  const tabReceive    = document.getElementById('tab-receive');

  const sender   = new Sender(senderPanel);
  const receiver = new Receiver(receiverPanel);

  // Tab switching
  function showTab(which) {
    const isSend = which === 'send';
    senderPanel.hidden   = !isSend;
    receiverPanel.hidden = isSend;
    tabSend.classList.toggle('active', isSend);
    tabReceive.classList.toggle('active', !isSend);
  }
  tabSend.addEventListener('click',    () => showTab('send'));
  tabReceive.addEventListener('click', () => showTab('receive'));

  // Pre-fill code from URL ?code=XXXXXX
  const urlCode = new URLSearchParams(location.search).get('code');
  if (urlCode && /^\d{6}$/.test(urlCode)) {
    showTab('receive');
    const cells = receiverPanel.querySelectorAll('.code-input-cell');
    urlCode.split('').forEach((d, i) => { if (cells[i]) cells[i].value = d; });
    receiverPanel.querySelector('.receiver-connect-btn').disabled = false;
  } else {
    showTab('send');
  }

  // Wire sender buttons
  senderPanel.querySelector('.sender-send-btn')
    .addEventListener('click', () => sender.start());
  senderPanel.querySelector('.sender-cancel-btn')
    ?.addEventListener('click', () => sender.cancel());
  senderPanel.querySelector('.sender-new-btn')
    ?.addEventListener('click', () => sender.cancel());
  senderPanel.querySelector('.code-copy-btn')?.addEventListener('click', function() {
    navigator.clipboard.writeText(sender.code || '').then(() => {
      this.innerHTML = Icons.check() + ' Copied';
      setTimeout(() => { this.innerHTML = Icons.copy() + ' Copy'; }, 2000);
    });
  });

  // Wire receiver buttons
  receiverPanel.querySelector('.receiver-connect-btn')
    .addEventListener('click', () => receiver.connect());
  receiverPanel.querySelector('.receiver-reset-btn')
    ?.addEventListener('click', () => receiver.reset());

  // Scroll animations
  if ('IntersectionObserver' in window) {
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); } });
    }, { threshold: 0.08, rootMargin: '0px 0px -32px 0px' });
    document.querySelectorAll('.fade-in').forEach(el => obs.observe(el));
  } else {
    document.querySelectorAll('.fade-in').forEach(el => el.classList.add('visible'));
  }
});
```

- [ ] Commit: `git commit -m "feat: app boot, tab switching, URL code pre-fill"`

---

### Task 7: index.html

**Files:** Create `index.html`

- [ ] Write full page — nav, hero, tool panel (sender + receiver tabs), how-it-works, FAQ, footer — with all SEO meta tags, QR code CDN script, correct `data-state` attribute hooks for CSS visibility, aria labels. See spec §5, §8, §9, §10.
- [ ] Open in browser (with signaling server running). Test sender drop → code appears → QR renders → countdown ticks.
- [ ] Open second tab → paste code → connect → verify progress bars on both sides.
- [ ] Verify URL `?code=123456` pre-fills receiver tab.
- [ ] Verify 2 GB warning appears when a large file is added.
- [ ] Commit: `git commit -m "feat: index.html main tool page"`

---

### Task 8: terms.html + privacy.html

**Files:** Create `terms.html`, `privacy.html`

- [ ] Write `terms.html` — 5 sections per spec §7.1, same nav/footer as index.html, SEO meta tags.
- [ ] Write `privacy.html` — 6 sections per spec §7.2, explicit no-anonymous-claims statement, same nav/footer.
- [ ] Verify both pages render correctly in browser, links in footer of index.html point to them.
- [ ] Commit: `git commit -m "feat: terms and privacy pages"`
