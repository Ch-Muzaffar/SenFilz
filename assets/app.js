'use strict';

/* ============================================================
   SenFilz — App Logic
   app.js | senfilz.com
   ============================================================ */

// ── Config (update before deploy) ─────────────────────────────────────────────
const WS_URL          = 'wss://senfilz.up.railway.app/';
const TURN_USERNAME   = 'de7ab377b3405aad1e5e44c4';
const TURN_CREDENTIAL = 'OUfcZ/F2q6bzpqxp';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  {
    urls:       'turn:senfilz.metered.live:80',
    username:   TURN_USERNAME,
    credential: TURN_CREDENTIAL,
  },
  {
    urls:       'turn:senfilz.metered.live:443',
    username:   TURN_USERNAME,
    credential: TURN_CREDENTIAL,
  },
  {
    urls:       'turn:senfilz.metered.live:443?transport=tcp',
    username:   TURN_USERNAME,
    credential: TURN_CREDENTIAL,
  },
];

const CHUNK_SIZE      = 64 * 1024;              // 64 KB per chunk
const SIZE_WARN       = 2 * 1024 * 1024 * 1024; // 2 GB warning threshold
const CODE_TTL_MS     = 10 * 60 * 1000;         // 10 minutes
const CONNECT_TIMEOUT = 30_000;                  // 30 second connection timeout

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

function formatSpeed(bytesPerSec) {
  return formatBytes(Math.max(0, bytesPerSec)) + '/s';
}

function _formatTime(secsLeft) {
  if (secsLeft == null || secsLeft <= 0) return '';
  if (secsLeft >= 3600) return `${Math.floor(secsLeft / 3600)}h ${Math.floor((secsLeft % 3600) / 60)}m`;
  if (secsLeft >= 60)   return `${Math.floor(secsLeft / 60)}m ${secsLeft % 60}s`;
  return `${secsLeft}s`;
}

// ── Transfer History ──────────────────────────────────────────────────────────

const HISTORY_KEY = 'senfilz-history';
const HISTORY_MAX = 20;

function historyAdd(entry) {
  const items = historyGet();
  items.unshift({
    direction: entry.direction,
    files:     entry.files,
    totalSize: entry.files.reduce((s, f) => s + (f.size || 0), 0),
    status:    entry.status,
    ts:        Date.now(),
  });
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_MAX))); } catch {}
  historyRender();
}

function historyGet() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}

function historyRender() {
  const section = document.getElementById('history-section');
  const list    = document.getElementById('history-list');
  if (!section || !list) return;
  const items = historyGet();
  if (items.length === 0) { section.hidden = true; return; }
  section.hidden = false;
  list.innerHTML = items.map(item => {
    const firstName = item.files[0]?.name || 'file';
    const label     = item.files.length > 1
      ? `${item.files.length} files · ${formatBytes(item.totalSize)}`
      : `${firstName} · ${formatBytes(item.totalSize)}`;
    const dir  = item.direction === 'sent' ? 'Sent' : 'Received';
    const time = new Date(item.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const cls  = item.status === 'success' ? '' : 'history-item--fail';
    const title = item.files.map(f => f.name).join(', ');
    return `<div class="history-item ${cls}" title="${title}">
      <span class="history-dir">${dir}</span>
      <span class="history-name">${label}</span>
      <span class="history-time">${time}</span>
    </div>`;
  }).join('');
}

// ── Theme ─────────────────────────────────────────────────────────────────────

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
      btn.innerHTML = theme === 'dark' ? Icons.sun() : Icons.moon();
      btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    });
  },
  toggle() {
    const current = document.documentElement.getAttribute('data-theme');
    this.apply(current === 'light' ? 'dark' : 'light');
  },
};

// ── Toaster ───────────────────────────────────────────────────────────────────

const Toaster = {
  _container: null,
  _getContainer() {
    if (!this._container) {
      this._container = document.createElement('div');
      this._container.className = 'toast-container';
      this._container.setAttribute('aria-live', 'polite');
      this._container.setAttribute('aria-atomic', 'false');
      document.body.appendChild(this._container);
    }
    return this._container;
  },
  _show(message, type, duration) {
    const t = document.createElement('div');
    t.className = `toast toast--${type}`;
    t.setAttribute('role', 'status');
    t.textContent = message;
    this._getContainer().appendChild(t);
    const dismiss = () => {
      if (!t.isConnected) return;
      t.classList.add('dismissing');
      t.addEventListener('animationend', () => t.remove(), { once: true });
    };
    const timer = setTimeout(dismiss, duration);
    t.addEventListener('click', () => { clearTimeout(timer); dismiss(); });
  },
  success(msg, dur = 4000) { this._show(msg, 'success', dur); },
  error(msg,   dur = 6000) { this._show(msg, 'error',   dur); },
  info(msg,    dur = 4000) { this._show(msg, 'info',    dur); },
};

// ── Downloader ────────────────────────────────────────────────────────────────

const Downloader = {
  download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  },
};

// ── Icons ─────────────────────────────────────────────────────────────────────

const Icons = {
  sun: () => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,
  moon: () => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
  upload: () => `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  copy: () => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  check: () => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`,
  warning: () => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;margin-top:1px"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  file: () => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`,
  x: () => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  link: () => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  download: () => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
};

// ── Sender ────────────────────────────────────────────────────────────────────

class Sender {
  constructor(panel) {
    this.panel         = panel;
    this.files         = [];
    this.ws            = null;
    this.pc            = null;
    this.channel       = null;
    this.code          = null;
    this.timeoutId     = null;
    this.countdownId   = null;
    this.codeCreatedAt = null;
    this._qualityTimer = null;
    this._state        = 'idle';
    this._bindDrop();
    this._bindCopyBtn();
  }

  setState(s) {
    this._state = s;
    this.panel.dataset.state = s;
  }

  _bindDrop() {
    const zone  = this.panel.querySelector('.upload-zone');
    const input = zone.querySelector('input[type="file"]');
    input.setAttribute('multiple', '');

    input.addEventListener('change', e => {
      this._addFiles(Array.from(e.target.files));
      e.target.value = '';
    });

    zone.addEventListener('dragover', e => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', e => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      this._addFiles(Array.from(e.dataTransfer.files));
    });
  }

  _bindCopyBtn() {
    const btn = this.panel.querySelector('.code-copy-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (!this.code) return;
      navigator.clipboard.writeText(this.code).then(() => {
        btn.innerHTML = Icons.check() + ' Copied';
        setTimeout(() => { btn.innerHTML = Icons.copy() + ' Copy code'; }, 2000);
      });
    });
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
    const list    = this.panel.querySelector('.file-list');
    const warnBox = this.panel.querySelector('.warning-box');
    const totalEl = this.panel.querySelector('.file-list-total');
    list.innerHTML = '';

    let totalSize = 0;
    let hasLarge  = false;

    this.files.forEach((f, i) => {
      totalSize += f.size;
      if (f.size > SIZE_WARN) hasLarge = true;

      const item = document.createElement('div');
      item.className = 'file-list-item';
      item.innerHTML = `
        <span class="file-list-icon">${Icons.file()}</span>
        <span class="file-list-name" title="${f.name}">${f.name}</span>
        <span class="file-list-size">${formatBytes(f.size)}</span>
        <button class="file-list-remove btn btn-ghost btn-sm" aria-label="Remove ${f.name}">${Icons.x()}</button>
      `;
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
    this.ws.onerror = () => this._showError('timeout');
    this.ws.onopen  = () => this.ws.send(JSON.stringify({ type: 'create' }));

    this.ws.onmessage = async e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }

      switch (msg.type) {
        case 'code':
          this.code          = msg.code;
          this.codeCreatedAt = Date.now();
          this._showCode(msg.code);
          await this._setupPeer();
          break;

        case 'receiver-joined':
          this.setState('connecting');
          this._startTimeout();
          break;

        case 'answer':
          await this.pc.setRemoteDescription(new RTCSessionDescription(msg.answer));
          break;

        case 'ice':
          try {
            if (msg.candidate) await this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
          } catch { /* ignore late candidates */ }
          break;

        case 'peer-disconnected':
          // Receiver disconnected — only relevant mid-transfer on receiver side
          break;

        case 'error':
          this._showError('timeout');
          break;
      }
    };
  }

  async _setupPeer() {
    this.pc      = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.channel = this.pc.createDataChannel('senfilz', { ordered: true });

    this.channel.onopen = () => {
      clearTimeout(this.timeoutId);
      this.setState('transferring');
      this._startQualityPolling();
      this._sendFiles();
    };

    this.channel.onerror = () => this._showError('timeout');

    this.pc.onicecandidate = e => {
      if (e.candidate) {
        this.ws.send(JSON.stringify({ type: 'ice', code: this.code, candidate: e.candidate }));
      }
    };

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.ws.send(JSON.stringify({ type: 'offer', code: this.code, offer: this.pc.localDescription }));
  }

  _showCode(code) {
    this.panel.querySelector('.code-display-value').textContent = code;

    const qrUrl = `${location.origin}${location.pathname}?code=${code}`;

    // Copy-link button
    const linkBtn = this.panel.querySelector('.code-link-btn');
    if (linkBtn) {
      linkBtn.onclick = () => {
        navigator.clipboard.writeText(qrUrl).then(() => {
          linkBtn.innerHTML = Icons.check() + ' Copied';
          setTimeout(() => { linkBtn.innerHTML = Icons.link() + ' Copy link'; }, 2000);
        });
      };
    }

    // QR code — receiver can scan to auto-fill the code
    const qrEl = this.panel.querySelector('#sender-qr');
    qrEl.innerHTML = '';
    /* global QRCode */
    new QRCode(qrEl, {
      text:       qrUrl,
      width:      160,
      height:     160,
      colorDark:  '#6366f1',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M,
    });

    // QR download button
    const dlBtn = this.panel.querySelector('.qr-download-btn');
    if (dlBtn) {
      dlBtn.hidden = false;
      dlBtn.onclick = () => {
        const canvas = qrEl.querySelector('canvas');
        if (!canvas) return;
        const a = document.createElement('a');
        a.download = `senfilz-${code}.png`;
        a.href = canvas.toDataURL('image/png');
        a.click();
      };
    }

    this._startCountdown();
  }

  _startCountdown() {
    const el = this.panel.querySelector('.code-countdown');
    const tick = () => {
      const remaining = CODE_TTL_MS - (Date.now() - this.codeCreatedAt);
      if (remaining <= 0) { el.textContent = 'Code expired'; return; }
      const m = Math.floor(remaining / 60_000);
      const s = Math.floor((remaining % 60_000) / 1000);
      el.textContent = `Expires in ${m}:${String(s).padStart(2, '0')}`;
    };
    tick();
    this.countdownId = setInterval(tick, 1000);
  }

  _startTimeout() {
    this.timeoutId = setTimeout(() => this._showError('timeout'), CONNECT_TIMEOUT);
  }

  async _sendFiles() {
    const totalBytes  = this.files.reduce((sum, f) => sum + f.size, 0);
    const progFile    = this.panel.querySelector('.progress-file');
    const progOverall = this.panel.querySelector('.progress-overall');
    const fileLabel   = this.panel.querySelector('.transfer-label');
    const fillFile    = progFile.querySelector('.progress-fill');
    const fillOverall = progOverall.querySelector('.progress-fill');
    const pctLabel    = progOverall.querySelector('.progress-pct');

    fillFile.className    = 'progress-fill processing';
    fillOverall.className = 'progress-fill processing';

    let totalSent = 0;
    const startTime = Date.now();

    // Announce session totals to receiver
    this.channel.send(JSON.stringify({
      type: 'session-meta',
      totalFiles: this.files.length,
      totalBytes,
    }));

    for (let i = 0; i < this.files.length; i++) {
      const file = this.files[i];
      fileLabel.textContent = `Sending ${i + 1} of ${this.files.length} — ${file.name}`;

      // Compute SHA-256 for integrity check (files ≤ 200 MB only to avoid double-buffering)
      let sha256 = null;
      if (file.size <= 200 * 1024 * 1024 && crypto?.subtle) {
        try {
          const buf  = await file.arrayBuffer();
          const hash = await crypto.subtle.digest('SHA-256', buf);
          sha256 = Array.from(new Uint8Array(hash))
            .map(b => b.toString(16).padStart(2, '0')).join('');
        } catch { /* skip if crypto unavailable */ }
      }

      // Per-file metadata
      this.channel.send(JSON.stringify({
        type:     'meta',
        index:    i,
        total:    this.files.length,
        name:     file.name,
        size:     file.size,
        mimeType: file.type || 'application/octet-stream',
        sha256,
      }));

      // Chunked send
      await new Promise((resolve, reject) => {
        let offset = 0;

        const sendChunk = () => {
          if (offset >= file.size) {
            this.channel.send(JSON.stringify({ type: 'file-done', index: i }));
            resolve();
            return;
          }

          const slice  = file.slice(offset, offset + CHUNK_SIZE);
          const reader = new FileReader();

          reader.onerror = () => reject(new Error('FileReader error'));
          reader.onload  = ev => {
            const buf = ev.target.result;
            this.channel.send(buf);
            offset    += buf.byteLength;
            totalSent += buf.byteLength;

            const filePct     = Math.min(100, Math.round((offset / file.size) * 100));
            const overallPct  = Math.min(100, Math.round((totalSent / totalBytes) * 100));
            const elapsed     = (Date.now() - startTime) || 1;
            const bytesPerSec = (totalSent / elapsed) * 1000;
            const remBytes    = totalBytes - totalSent;
            const secsLeft    = bytesPerSec > 512 ? Math.ceil(remBytes / bytesPerSec) : null;
            const timeStr     = _formatTime(secsLeft);

            fillFile.style.width    = filePct + '%';
            fillOverall.style.width = overallPct + '%';
            pctLabel.textContent    =
              `${overallPct}% · ${formatSpeed(bytesPerSec)}${timeStr ? ' · ' + timeStr + ' left' : ''}`;

            // Backpressure: wait for buffer to drain before sending next chunk
            if (this.channel.bufferedAmount < CHUNK_SIZE * 4) {
              sendChunk();
            } else {
              this.channel.bufferedAmountLowThreshold = CHUNK_SIZE;
              this.channel.onbufferedamountlow = () => {
                this.channel.onbufferedamountlow = null;
                sendChunk();
              };
            }
          };
          reader.readAsArrayBuffer(slice);
        };

        sendChunk();
      });
    }

    // Signal all done
    this.channel.send(JSON.stringify({ type: 'all-done' }));

    this._stopQualityPolling();
    fillFile.className    = 'progress-fill done';
    fillOverall.className = 'progress-fill done';
    fillOverall.style.width = '100%';
    pctLabel.textContent  = '100%';

    clearInterval(this.countdownId);
    const countLabel = this.files.length > 1 ? `${this.files.length} files` : this.files[0].name;
    this.panel.querySelector('.done-label').textContent = `${countLabel} sent successfully.`;
    historyAdd({ direction: 'sent', files: this.files.map(f => ({ name: f.name, size: f.size })), status: 'success' });
    this.setState('done');
  }

  _showError(kind) {
    clearTimeout(this.timeoutId);
    clearInterval(this.countdownId);
    this._stopQualityPolling();
    try { this.pc?.close(); } catch { /* ignore */ }
    try { this.ws?.close(); } catch { /* ignore */ }

    if (this.files.length) {
      historyAdd({ direction: 'sent', files: this.files.map(f => ({ name: f.name, size: f.size })), status: 'error' });
    }

    this.panel.querySelector('.error-msg').textContent =
      'Could not establish a direct connection. This sometimes happens on restrictive networks (corporate VPNs, firewalls). Try a different network or ask the sender to retry.';
    this.setState('error');
  }

  cancel() {
    clearTimeout(this.timeoutId);
    clearInterval(this.countdownId);
    this._stopQualityPolling();
    try { this.pc?.close(); } catch { /* ignore */ }
    try { this.ws?.close(); } catch { /* ignore */ }
    this.files = [];
    this._renderFileList();
    this.panel.querySelector('.sender-send-btn').hidden = true;
    this.panel.querySelector('.code-display-value').textContent = '';
    const dlBtn = this.panel.querySelector('.qr-download-btn');
    if (dlBtn) dlBtn.hidden = true;
    this.setState('idle');
  }

  _startQualityPolling() {
    const el  = this.panel.querySelector('.quality-indicator');
    const lbl = el?.querySelector('.quality-label');
    const poll = async () => {
      if (!this.pc || !el) return;
      try {
        const stats = await this.pc.getStats();
        let rtt = null;
        stats.forEach(r => {
          if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.currentRoundTripTime != null) {
            rtt = r.currentRoundTripTime * 1000;
          }
        });
        if (rtt !== null) {
          const lvl = rtt < 50 ? 'excellent' : rtt < 150 ? 'good' : rtt < 300 ? 'fair' : 'poor';
          el.dataset.quality = lvl;
          el.title = `${lvl[0].toUpperCase() + lvl.slice(1)} (${Math.round(rtt)} ms RTT)`;
          if (lbl) lbl.textContent = lvl[0].toUpperCase() + lvl.slice(1);
          el.hidden = false;
        }
      } catch { /* getStats may fail; ignore */ }
      this._qualityTimer = setTimeout(poll, 3000);
    };
    poll();
  }

  _stopQualityPolling() {
    clearTimeout(this._qualityTimer);
    this._qualityTimer = null;
    const el = this.panel.querySelector('.quality-indicator');
    if (el) el.hidden = true;
  }
}

// ── Receiver ──────────────────────────────────────────────────────────────────

class Receiver {
  constructor(panel) {
    this.panel          = panel;
    this.ws             = null;
    this.pc             = null;
    this.code           = null;
    this.timeoutId      = null;
    this._chunks        = [];
    this._currentMeta   = null;
    this._totalFiles    = 0;
    this._totalBytes    = 0;
    this._receivedBytes = 0;
    this._startTime     = null;
    this._doneCount     = 0;
    this._qualityTimer  = null;
    this._state         = 'idle';
    this._bindCodeInput();
  }

  setState(s) {
    this._state = s;
    this.panel.dataset.state = s;
  }

  _bindCodeInput() {
    const cells = Array.from(this.panel.querySelectorAll('.code-input-cell'));
    const connectBtn = this.panel.querySelector('.receiver-connect-btn');

    cells.forEach((cell, i) => {
      cell.addEventListener('input', () => {
        // Allow only uppercase alphanumeric (A-Z, 0-9)
        cell.value = cell.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-1);
        if (cell.value && i < cells.length - 1) cells[i + 1].focus();
        connectBtn.disabled = this._getCode(cells).length < 6;
      });

      cell.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !cell.value && i > 0) {
          cells[i - 1].focus();
        }
      });

      cell.addEventListener('paste', e => {
        e.preventDefault();
        const chars = (e.clipboardData.getData('text') || '')
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '')
          .slice(0, 6);
        chars.split('').forEach((d, j) => { if (cells[j]) cells[j].value = d; });
        const next = cells[Math.min(chars.length, cells.length - 1)];
        if (next) next.focus();
        connectBtn.disabled = this._getCode(cells).length < 6;
      });
    });
  }

  _getCode(cells) {
    return Array.from(cells || this.panel.querySelectorAll('.code-input-cell'))
      .map(c => c.value)
      .join('');
  }

  prefillCode(code) {
    const cells = Array.from(this.panel.querySelectorAll('.code-input-cell'));
    const upper = code.toUpperCase();
    upper.split('').forEach((d, i) => { if (cells[i]) cells[i].value = d; });
    this.panel.querySelector('.receiver-connect-btn').disabled = upper.length < 6;
  }

  async connect() {
    const code = this._getCode();
    if (code.length < 6) return;
    this.code = code;
    this.setState('connecting');

    this.timeoutId = setTimeout(() => this._showError('timeout'), CONNECT_TIMEOUT);

    this.ws = new WebSocket(WS_URL);
    this.ws.onerror = () => this._showError('timeout');
    this.ws.onopen  = () => this.ws.send(JSON.stringify({ type: 'join', code }));

    this.ws.onmessage = async e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }

      switch (msg.type) {
        case 'offer':
          await this._handleOffer(msg.offer);
          break;

        case 'ice':
          try {
            if (msg.candidate) await this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
          } catch { /* ignore late candidates */ }
          break;

        case 'peer-disconnected':
          if (this._state === 'receiving') {
            this._showError('interrupted');
          }
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

    this.pc.onicecandidate = e => {
      if (e.candidate) {
        this.ws.send(JSON.stringify({ type: 'ice', code: this.code, candidate: e.candidate }));
      }
    };

    this.pc.ondatachannel = e => {
      const ch = e.channel;
      ch.binaryType = 'arraybuffer';

      ch.onopen = () => {
        clearTimeout(this.timeoutId);
        this._startTime = Date.now();
        this.setState('receiving');
        this._startQualityPolling();
      };

      ch.onmessage = ev => this._onData(ev.data);
      ch.onerror   = () => this._showError('timeout');
    };

    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.ws.send(JSON.stringify({ type: 'answer', code: this.code, answer: this.pc.localDescription }));
  }

  _onData(data) {
    // String = control message; ArrayBuffer = file chunk
    if (typeof data === 'string') {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }

      switch (msg.type) {
        case 'session-meta':
          this._totalFiles = msg.totalFiles;
          this._totalBytes = msg.totalBytes;
          break;

        case 'meta':
          this._currentMeta = msg;
          this._chunks      = [];
          this._showReceivingFile(msg);
          break;

        case 'file-done':
          this._assembleAndDownload();
          this._doneCount++;
          break;

        case 'all-done':
          this._finishAll();
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

    // 2 GB warning shown on receiver side too
    this.panel.querySelector('.warning-box').hidden = meta.size <= SIZE_WARN;

    const fillFile = this.panel.querySelector('.progress-file .progress-fill');
    fillFile.className  = 'progress-fill processing';
    fillFile.style.width = '0%';
  }

  async _assembleAndDownload() {
    if (!this._currentMeta) return;

    let blob;
    if (this._currentMeta.sha256 && crypto?.subtle) {
      // Concatenate chunks once for both hash and Blob
      const totalLen = this._chunks.reduce((s, c) => s + c.byteLength, 0);
      const combined = new Uint8Array(totalLen);
      let off = 0;
      for (const chunk of this._chunks) { combined.set(new Uint8Array(chunk), off); off += chunk.byteLength; }
      blob = new Blob([combined], { type: this._currentMeta.mimeType || 'application/octet-stream' });
      this._chunks = [];
      try {
        const hash     = await crypto.subtle.digest('SHA-256', combined.buffer);
        const received = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
        this._showIntegrityResult(received === this._currentMeta.sha256);
      } catch { /* skip if crypto unavailable */ }
    } else {
      blob = new Blob(this._chunks, { type: this._currentMeta.mimeType || 'application/octet-stream' });
      this._chunks = [];
    }

    Downloader.download(blob, this._currentMeta.name);
  }

  _showIntegrityResult(ok) {
    const el = this.panel.querySelector('.integrity-result');
    if (!el) return;
    el.hidden = false;
    el.className = `integrity-result ${ok ? 'integrity-ok' : 'integrity-fail'}`;
    el.innerHTML = ok
      ? `${Icons.check()} File integrity verified`
      : `${Icons.warning()} Integrity check failed — file may be corrupted`;
  }

  _updateProgress() {
    if (!this._currentMeta) return;

    const fileBytesReceived = this._chunks.reduce((s, c) => s + c.byteLength, 0);
    const filePct    = Math.min(100, Math.round((fileBytesReceived / this._currentMeta.size) * 100));
    const overallPct = this._totalBytes > 0
      ? Math.min(100, Math.round((this._receivedBytes / this._totalBytes) * 100))
      : filePct;
    const elapsed     = (Date.now() - this._startTime) || 1;
    const bytesPerSec = (this._receivedBytes / elapsed) * 1000;
    const remBytes    = this._totalBytes > 0 ? this._totalBytes - this._receivedBytes : 0;
    const secsLeft    = bytesPerSec > 512 && remBytes > 0 ? Math.ceil(remBytes / bytesPerSec) : null;
    const timeStr     = _formatTime(secsLeft);

    this.panel.querySelector('.progress-file .progress-fill').style.width    = filePct + '%';
    this.panel.querySelector('.progress-overall .progress-fill').style.width = overallPct + '%';
    this.panel.querySelector('.progress-overall .progress-pct').textContent  =
      `${overallPct}% · ${formatSpeed(bytesPerSec)}${timeStr ? ' · ' + timeStr + ' left' : ''}`;
  }

  _finishAll() {
    const fillFile    = this.panel.querySelector('.progress-file .progress-fill');
    const fillOverall = this.panel.querySelector('.progress-overall .progress-fill');
    fillFile.className    = 'progress-fill done';
    fillOverall.className = 'progress-fill done';
    fillOverall.style.width = '100%';
    this.panel.querySelector('.progress-overall .progress-pct').textContent = '100%';

    this._stopQualityPolling();

    const label = this._totalFiles > 1
      ? `${this._totalFiles} files downloaded.`
      : `${this._currentMeta?.name || 'File'} downloaded.`;
    this.panel.querySelector('.done-label').textContent = label;

    historyAdd({
      direction: 'received',
      files: this._currentMeta ? [{ name: this._currentMeta.name, size: this._currentMeta.size }] : [],
      status: 'success',
    });

    this.setState('done');
  }

  _showError(kind) {
    clearTimeout(this.timeoutId);
    this._stopQualityPolling();
    try { this.pc?.close(); } catch { /* ignore */ }
    try { this.ws?.close(); } catch { /* ignore */ }

    const msgs = {
      timeout:
        'Could not establish a direct connection. This sometimes happens on restrictive networks (corporate VPNs, firewalls). Try a different network or ask the sender to retry.',
      interrupted:
        'Transfer interrupted — the sender disconnected before the file finished.',
      'bad-code':
        'That code is invalid or has already been used. Codes expire after 10 minutes and can only be used once.',
    };
    this.panel.querySelector('.error-msg').textContent = msgs[kind] || msgs.timeout;
    this.setState('error');
  }

  reset() {
    clearTimeout(this.timeoutId);
    this._stopQualityPolling();
    try { this.pc?.close(); } catch { /* ignore */ }
    try { this.ws?.close(); } catch { /* ignore */ }

    this.panel.querySelectorAll('.code-input-cell').forEach(c => c.value = '');
    this.panel.querySelector('.receiver-connect-btn').disabled = true;
    const intEl = this.panel.querySelector('.integrity-result');
    if (intEl) intEl.hidden = true;
    this._chunks        = [];
    this._receivedBytes = 0;
    this._doneCount     = 0;
    this._currentMeta   = null;
    this.setState('idle');
  }

  _startQualityPolling() {
    const el  = this.panel.querySelector('.quality-indicator');
    const lbl = el?.querySelector('.quality-label');
    const poll = async () => {
      if (!this.pc || !el) return;
      try {
        const stats = await this.pc.getStats();
        let rtt = null;
        stats.forEach(r => {
          if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.currentRoundTripTime != null) {
            rtt = r.currentRoundTripTime * 1000;
          }
        });
        if (rtt !== null) {
          const lvl = rtt < 50 ? 'excellent' : rtt < 150 ? 'good' : rtt < 300 ? 'fair' : 'poor';
          el.dataset.quality = lvl;
          el.title = `${lvl[0].toUpperCase() + lvl.slice(1)} (${Math.round(rtt)} ms RTT)`;
          if (lbl) lbl.textContent = lvl[0].toUpperCase() + lvl.slice(1);
          el.hidden = false;
        }
      } catch { /* getStats may fail; ignore */ }
      this._qualityTimer = setTimeout(poll, 3000);
    };
    poll();
  }

  _stopQualityPolling() {
    clearTimeout(this._qualityTimer);
    this._qualityTimer = null;
    const el = this.panel.querySelector('.quality-indicator');
    if (el) el.hidden = true;
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  Theme.init();
  document.querySelectorAll('.theme-toggle').forEach(btn =>
    btn.addEventListener('click', () => Theme.toggle())
  );

  // Mobile nav toggle
  const mobileToggle = document.querySelector('.nav-mobile-toggle');
  const mobileMenu   = document.querySelector('.nav-mobile-menu');
  if (mobileToggle && mobileMenu) {
    mobileToggle.addEventListener('click', () => {
      const isOpen = mobileMenu.classList.toggle('open');
      mobileToggle.classList.toggle('open', isOpen);
      mobileToggle.setAttribute('aria-expanded', String(isOpen));
      document.body.style.overflow = isOpen ? 'hidden' : '';
    });
    mobileMenu.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        mobileMenu.classList.remove('open');
        mobileToggle.classList.remove('open');
        mobileToggle.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      });
    });
  }

  const senderPanel   = document.getElementById('sender-panel');
  const receiverPanel = document.getElementById('receiver-panel');
  const tabSend       = document.getElementById('tab-send');
  const tabReceive    = document.getElementById('tab-receive');

  // ── Tab switching ──────────────────────────────────────────────────────────
  function showTab(which) {
    const isSend = which === 'send';
    senderPanel.hidden   = !isSend;
    receiverPanel.hidden = isSend;
    tabSend.classList.toggle('active', isSend);
    tabReceive.classList.toggle('active', !isSend);
    tabSend.setAttribute('aria-selected', String(isSend));
    tabReceive.setAttribute('aria-selected', String(!isSend));
  }

  tabSend.addEventListener('click',    () => showTab('send'));
  tabReceive.addEventListener('click', () => showTab('receive'));

  // Construct Sender/Receiver after tab listeners are registered so a
  // constructor failure doesn't prevent tab switching from working.
  let sender, receiver;
  try { sender = new Sender(senderPanel); } catch (e) { console.error('Sender init failed:', e); }
  try { receiver = new Receiver(receiverPanel); } catch (e) { console.error('Receiver init failed:', e); }

  // ── Upload zone explicit click forwarding (belt-and-suspenders) ────────────
  const uploadZone = senderPanel.querySelector('.upload-zone');
  const fileInput  = uploadZone && uploadZone.querySelector('input[type="file"]');
  if (uploadZone && fileInput) {
    uploadZone.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
    });
  }

  // ── Pre-fill code from URL ─────────────────────────────────────────────────
  const urlCode = new URLSearchParams(location.search).get('code');
  if (urlCode && /^[A-Z0-9]{6}$/i.test(urlCode)) {
    showTab('receive');
    if (receiver) receiver.prefillCode(urlCode.toUpperCase());
  } else {
    showTab('send');
  }

  // ── Sender button wiring ───────────────────────────────────────────────────
  senderPanel.querySelector('.sender-send-btn')
    ?.addEventListener('click', () => sender?.start());

  // querySelectorAll so EVERY button with this class gets the listener,
  // including the "Try again" button in state-error (Bug #1 fix)
  senderPanel.querySelectorAll('.sender-cancel-btn').forEach(btn =>
    btn.addEventListener('click', () => sender?.cancel())
  );

  senderPanel.querySelector('.sender-new-btn')
    ?.addEventListener('click', () => sender?.cancel());

  // ── Receiver button wiring ─────────────────────────────────────────────────
  receiverPanel.querySelector('.receiver-connect-btn')
    ?.addEventListener('click', () => receiver?.connect());

  // querySelectorAll so both "Try again" (state-error) and "Receive another"
  // (state-done) buttons are wired
  receiverPanel.querySelectorAll('.receiver-reset-btn').forEach(btn =>
    btn.addEventListener('click', () => receiver?.reset())
  );

  // ── History ────────────────────────────────────────────────────────────────
  historyRender();
  document.getElementById('history-clear-btn')
    ?.addEventListener('click', () => {
      try { localStorage.removeItem(HISTORY_KEY); } catch {}
      historyRender();
    });

  // ── Scroll animations ──────────────────────────────────────────────────────
  const fadeEls = document.querySelectorAll('.fade-in');
  if ('IntersectionObserver' in window) {
    const obs = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0, rootMargin: '0px' });
    fadeEls.forEach(el => obs.observe(el));
  } else {
    fadeEls.forEach(el => el.classList.add('visible'));
  }
});
