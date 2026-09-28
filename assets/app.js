'use strict';

/* ============================================================
   SenFilz — App Logic
   app.js | senfilz.com
   ============================================================ */

// ── Config (update before deploy) ─────────────────────────────────────────────
<<<<<<< HEAD
const WS_URL          = 'wss://YOUR_SIGNALING_SERVER';
=======
const WS_URL          = 'wss://senfilz.up.railway.app';
>>>>>>> 7b5cc8753fcc0d4833fbb19e375971b4a8558642
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

    // QR code — receiver can scan to auto-fill the code
    const qrEl = this.panel.querySelector('#sender-qr');
    qrEl.innerHTML = '';
    const qrUrl = `${location.origin}${location.pathname}?code=${code}`;
    /* global QRCode */
    new QRCode(qrEl, {
      text:       qrUrl,
      width:      160,
      height:     160,
      colorDark:  '#6366f1',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M,
    });

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

      // Per-file metadata
      this.channel.send(JSON.stringify({
        type:     'meta',
        index:    i,
        total:    this.files.length,
        name:     file.name,
        size:     file.size,
        mimeType: file.type || 'application/octet-stream',
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

            const filePct    = Math.min(100, Math.round((offset / file.size) * 100));
            const overallPct = Math.min(100, Math.round((totalSent / totalBytes) * 100));
            const elapsed    = (Date.now() - startTime) || 1;
            const speed      = formatSpeed((totalSent / elapsed) * 1000);

            fillFile.style.width    = filePct + '%';
            fillOverall.style.width = overallPct + '%';
            pctLabel.textContent    = `${overallPct}% · ${speed}`;

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

    fillFile.className    = 'progress-fill done';
    fillOverall.className = 'progress-fill done';
    fillOverall.style.width = '100%';
    pctLabel.textContent  = '100%';

    clearInterval(this.countdownId);
    const countLabel = this.files.length > 1 ? `${this.files.length} files` : this.files[0].name;
    this.panel.querySelector('.done-label').textContent = `${countLabel} sent successfully.`;
    this.setState('done');
  }

  _showError(kind) {
    clearTimeout(this.timeoutId);
    clearInterval(this.countdownId);
    try { this.pc?.close(); } catch { /* ignore */ }
    try { this.ws?.close(); } catch { /* ignore */ }

    this.panel.querySelector('.error-msg').textContent =
      'Could not establish a direct connection. This sometimes happens on restrictive networks (corporate VPNs, firewalls). Try a different network or ask the sender to retry.';
    this.setState('error');
  }

  cancel() {
    clearTimeout(this.timeoutId);
    clearInterval(this.countdownId);
    try { this.pc?.close(); } catch { /* ignore */ }
    try { this.ws?.close(); } catch { /* ignore */ }
    this.files = [];
    this._renderFileList();
    this.panel.querySelector('.sender-send-btn').hidden = true;
    this.panel.querySelector('.code-display-value').textContent = '';
    this.setState('idle');
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
        // Allow only digits
        cell.value = cell.value.replace(/\D/g, '').slice(-1);
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
        const digits = (e.clipboardData.getData('text') || '')
          .replace(/\D/g, '')
          .slice(0, 6);
        digits.split('').forEach((d, j) => { if (cells[j]) cells[j].value = d; });
        const next = cells[Math.min(digits.length, cells.length - 1)];
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
    code.split('').forEach((d, i) => { if (cells[i]) cells[i].value = d; });
    this.panel.querySelector('.receiver-connect-btn').disabled = code.length < 6;
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

  _updateProgress() {
    if (!this._currentMeta) return;

    const fileBytesReceived = this._chunks.reduce((s, c) => s + c.byteLength, 0);
    const filePct    = Math.min(100, Math.round((fileBytesReceived / this._currentMeta.size) * 100));
    const overallPct = this._totalBytes > 0
      ? Math.min(100, Math.round((this._receivedBytes / this._totalBytes) * 100))
      : filePct;
    const elapsed = (Date.now() - this._startTime) || 1;
    const speed   = formatSpeed((this._receivedBytes / elapsed) * 1000);

    this.panel.querySelector('.progress-file .progress-fill').style.width    = filePct + '%';
    this.panel.querySelector('.progress-overall .progress-fill').style.width = overallPct + '%';
    this.panel.querySelector('.progress-overall .progress-pct').textContent  = `${overallPct}% · ${speed}`;
  }

  _assembleAndDownload() {
    if (!this._currentMeta) return;
    const blob = new Blob(this._chunks, {
      type: this._currentMeta.mimeType || 'application/octet-stream',
    });
    Downloader.download(blob, this._currentMeta.name);
    this._chunks = [];
  }

  _finishAll() {
    const fillFile    = this.panel.querySelector('.progress-file .progress-fill');
    const fillOverall = this.panel.querySelector('.progress-overall .progress-fill');
    fillFile.className    = 'progress-fill done';
    fillOverall.className = 'progress-fill done';
    fillOverall.style.width = '100%';
    this.panel.querySelector('.progress-overall .progress-pct').textContent = '100%';

    const label = this._totalFiles > 1
      ? `${this._totalFiles} files downloaded.`
      : `${this._currentMeta?.name || 'File'} downloaded.`;
    this.panel.querySelector('.done-label').textContent = label;
    this.setState('done');
  }

  _showError(kind) {
    clearTimeout(this.timeoutId);
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
    try { this.pc?.close(); } catch { /* ignore */ }
    try { this.ws?.close(); } catch { /* ignore */ }

    this.panel.querySelectorAll('.code-input-cell').forEach(c => c.value = '');
    this.panel.querySelector('.receiver-connect-btn').disabled = true;
    this._chunks        = [];
    this._receivedBytes = 0;
    this._doneCount     = 0;
    this._currentMeta   = null;
    this.setState('idle');
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

  const sender   = new Sender(senderPanel);
  const receiver = new Receiver(receiverPanel);

  // ── Tab switching ──────────────────────────────────────────────────────────
  function showTab(which) {
    const isSend = which === 'send';
    senderPanel.hidden   = !isSend;
    receiverPanel.hidden = isSend;
    tabSend.classList.toggle('active', isSend);
    tabReceive.classList.toggle('active', !isSend);
  }

  tabSend.addEventListener('click',    () => showTab('send'));
  tabReceive.addEventListener('click', () => showTab('receive'));

  // ── Pre-fill code from URL ─────────────────────────────────────────────────
  const urlCode = new URLSearchParams(location.search).get('code');
  if (urlCode && /^\d{6}$/.test(urlCode)) {
    showTab('receive');
    receiver.prefillCode(urlCode);
  } else {
    showTab('send');
  }

  // ── Sender button wiring ───────────────────────────────────────────────────
  senderPanel.querySelector('.sender-send-btn')
    .addEventListener('click', () => sender.start());

  senderPanel.querySelector('.sender-cancel-btn')
    ?.addEventListener('click', () => sender.cancel());

  senderPanel.querySelector('.sender-new-btn')
    ?.addEventListener('click', () => sender.cancel());

  // ── Receiver button wiring ─────────────────────────────────────────────────
  receiverPanel.querySelector('.receiver-connect-btn')
    .addEventListener('click', () => receiver.connect());

  receiverPanel.querySelector('.receiver-reset-btn')
    ?.addEventListener('click', () => receiver.reset());

  // ── Scroll animations ──────────────────────────────────────────────────────
  if ('IntersectionObserver' in window) {
    const obs = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -32px 0px' });
    document.querySelectorAll('.fade-in').forEach(el => obs.observe(el));
  } else {
    document.querySelectorAll('.fade-in').forEach(el => el.classList.add('visible'));
  }
});
