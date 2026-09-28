# SenFilz — Design Spec
_Browser-to-browser file transfer via WebRTC_
_Date: 2026-09-27_

---

## 1. Project Overview

**Name:** SenFilz  
**URL pattern:** senfilz.com (or subdomain) — placeholder, exact domain TBD  
**What it does:** Sender drops one or more files in the browser, receives a single-use 6-digit code and QR code. Receiver enters the code on the same page. The two browsers connect directly via WebRTC (RTCPeerConnection + RTCDataChannel). Files transfer peer-to-peer — no server ever sees file data.

**What it is not:** An anonymous or untraceable tool. Files transfer directly between two browsers; standard network metadata (IP addresses) is visible to both peers as part of WebRTC's normal operation.

---

## 2. Goals

1. Zero-storage file transfer — server relays only connection metadata, never file chunks.
2. Frictionless UX — sender gets a code in one step; receiver enters it in one step.
3. Visual consistency — matches SenFilz's own design system, adapted from LiteFile's established token set.
4. Honest privacy posture — no false "anonymous" claims; short, plain-language legal pages included.

---

## 3. File Structure

```
Muzaffar1/                   ← project root
├── index.html               ← main Send / Receive tool page
├── terms.html               ← Terms of Service
├── privacy.html             ← Privacy Policy
├── assets/
│   ├── style.css            ← standalone design system CSS (not shared with LiteFile)
│   └── app.js               ← WebRTC + UI state machine
└── signaling/
    ├── server.js            ← Node.js WebSocket signaling server
    └── package.json         ← { "dependencies": { "ws": "^8" } }
```

---

## 4. Design System

Standalone CSS in `assets/style.css`. Visually identical to LiteFile's tokens but self-contained — no dependency on the LiteFile repo.

**Tokens (dark default / light via `[data-theme="light"]`):**
- Background: `#08090d` / `#f4f6f9`
- Surface: `#0f1117` / `#ffffff`
- Elevated: `#161b27` / `#f0f2f6`
- Accent: `#6366f1` (dark), `#4f46e5` (light)
- Text primary/secondary/muted
- Success `#10b981`, Error `#ef4444`, Warning `#f59e0b`
- Font: Inter (Google Fonts)

**Components reused:** glass cards, buttons (primary/secondary/ghost), progress bars (processing/done/error states), badges, FAQ accordion, step numbers, upload zone, toast notifications, nav + footer, spinner.

**New component — Code Display:** Large monospace 6-digit code in a pill box with copy-to-clipboard button. Expiry countdown below it.

**New component — Code Input:** 6 individual single-character `<input>` cells (monospace, auto-advance on keystroke, backspace goes back, paste fills all).

**New component — QR Canvas:** `<canvas>` rendered by qrcodejs (cdnjs CDN). Hidden until code is generated.

---

## 5. Frontend: `index.html`

### 5.1 Page-level structure

```
<nav>           ← SenFilz branding, theme toggle
<main>
  #tool-panel   ← tab toggle (Send | Receive) + state machine UI
  #how-it-works ← 3-step explainer
  #faq          ← accordion
<footer>        ← links: Terms · Privacy · Contact
```

### 5.2 Send Tab — State Machine

| State | UI shown |
|---|---|
| `idle` | Upload drop zone. Any file type/size accepted. |
| `waiting` | Code display + QR canvas + expiry countdown (MM:SS) + "Waiting for receiver…" spinner. Cancel button. |
| `connecting` | "Receiver joined — establishing connection…" spinner. 30 s timeout clock (hidden). |
| `transferring` | Filename, progress bar (bytes sent / total, %), transfer speed (KB/s or MB/s), Cancel button. |
| `done` | Success result box: "Transfer complete — [filename] sent." New transfer button. |
| `error-timeout` | Error result box (see §5.4). |
| `error-interrupted` | Not applicable to sender (sender is the one who leaves). |

### 5.3 Receive Tab — State Machine

| State | UI shown |
|---|---|
| `idle` | 6-cell code input + Connect button. |
| `connecting` | Spinner. 30 s timeout clock (hidden). |
| `receiving` | Filename shown, progress bar (bytes received / total, %), speed. |
| `done` | Auto-download triggered via `Downloader.download()`. Success box: "Download complete — [filename]." |
| `error-timeout` | Error result box (see §5.4). |
| `error-interrupted` | Error result box: transfer interrupted (see §5.4). |
| `error-bad-code` | Error result box: invalid/expired code (see §5.4). |

### 5.4 Error Messages (exact copy)

- **30 s connection timeout (both sides):**
  > "Could not establish a direct connection. This sometimes happens on restrictive networks (corporate VPNs, firewalls). Try a different network or ask the sender to retry."

- **Sender disconnects mid-transfer (receiver sees):**
  > "Transfer interrupted — the sender disconnected before the file finished."

- **Invalid or expired code:**
  > "That code is invalid or has already been used. Codes expire after 10 minutes and can only be used once."

### 5.5 WebRTC + Transfer Logic (in `assets/app.js`)

**Connection setup:**
```
const pc = new RTCPeerConnection({
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
});
```

**Sender path:**
1. Connect to signaling WS → send `{ type: 'create' }`
2. Receive `{ type: 'code', code }` → display code + QR
3. Create data channel: `pc.createDataChannel('file')`
4. `pc.createOffer()` → `pc.setLocalDescription()` → send `{ type: 'offer', code, offer }`
5. On ICE candidate → send `{ type: 'ice', code, candidate }`
6. Receive `{ type: 'answer' }` → `pc.setRemoteDescription()`
7. Receive `{ type: 'ice' }` → `pc.addIceCandidate()`
8. Data channel `open` event → begin chunked send

**Chunked send:**
```js
const CHUNK_SIZE = 64 * 1024; // 64 KB
let offset = 0;
function sendNext() {
  if (offset >= file.size) { channel.send('__done__'); return; }
  const slice = file.slice(offset, offset + CHUNK_SIZE);
  const reader = new FileReader();
  reader.onload = e => {
    channel.send(e.target.result);
    offset += e.target.result.byteLength;
    updateProgress(offset, file.size);
    if (channel.bufferedAmount < CHUNK_SIZE * 4) sendNext();
    else channel.onbufferedamountlow = sendNext;
  };
  reader.readAsArrayBuffer(slice);
}
```

**Receiver path:**
1. Connect to signaling WS → send `{ type: 'join', code }`
2. Receive `{ type: 'offer' }` → `pc.setRemoteDescription()` → `pc.createAnswer()` → send `{ type: 'answer', code, answer }`
3. ICE exchange same as sender
4. `pc.ondatachannel` → accumulate chunks in `Uint8Array[]`
5. On `'__done__'` sentinel → assemble `Blob` → trigger download

**Metadata exchange:** Before chunks, sender sends a JSON string: `{ name, size, type }` as first message. Receiver parses it, displays filename, allocates progress tracking.

**30 s timeout:** `setTimeout` starts on `connecting` state entry. Cleared when data channel opens. On fire → show timeout error, close PC and WS.

**Transfer speed:** Calculated as `bytesReceived / (Date.now() - startTime)`, updated every 500 ms.

---

## 6. Signaling Server: `signaling/server.js`

### 6.1 Stack
- Runtime: Node.js (no transpilation needed)
- Dependencies: `ws@^8` only (no Express, no database)
- In-process rate limiting (no Redis)

### 6.2 Session Store

```js
// Map<code, Session>
const sessions = new Map();

// Session shape:
{
  senderWs: WebSocket,
  receiverWs: WebSocket | null,
  offer: RTCSessionDescription | null,
  iceCandidates: { from: 'sender'|'receiver', candidate }[],
  createdAt: number,   // Date.now()
  used: boolean
}
```

Cleanup interval every 60 s: remove sessions where `Date.now() - createdAt > 600_000` or `used === true`.

### 6.3 Rate Limiting

```js
// Map<ip, { count: number, windowStart: number }>
const rateLimits = new Map();
const LIMIT = 5;
const WINDOW_MS = 60_000;
```

Checked only on `{ type: 'create' }` messages. Over limit → send `{ type: 'error', message: 'Too many sessions. Try again in a minute.' }` → close socket.

### 6.4 Message Protocol

All messages are JSON strings over WebSocket.

| Direction | Message | Action |
|---|---|---|
| Sender → Server | `{ type: 'create' }` | Generate code, create session, reply `{ type: 'code', code }` |
| Sender → Server | `{ type: 'offer', code, offer }` | Store offer on session |
| Receiver → Server | `{ type: 'join', code }` | Validate code (exists, not expired, not used). Mark used. Forward offer to receiver. Notify sender `{ type: 'receiver-joined' }` |
| Receiver → Server | `{ type: 'answer', code, answer }` | Forward answer to sender |
| Either → Server | `{ type: 'ice', code, candidate }` | Forward candidate to the other peer |

**Invalid/expired code response:**
```json
{ "type": "error", "message": "That code is invalid or has already been used. Codes expire after 10 minutes and can only be used once." }
```
(Same message for all bad-code scenarios — no distinguishing between "never existed" vs "expired" vs "already used".)

### 6.5 Server Startup

```js
const PORT = process.env.PORT || 8080;
```

No HTTP server needed — raw WS server on that port. Health check: `wss.on('connection')` ping/pong is sufficient for most platforms; can add a minimal HTTP response on port+1 if needed at deploy time.

---

## 7. Supporting Pages

### 7.1 `terms.html` — Terms of Service

Sections:
1. **Service description** — relay-only file transfer tool; no file content stored or accessed
2. **Acceptable use** — no illegal content; user responsible for what they transfer
3. **No warranty** — service provided as-is; no uptime guarantee
4. **Limitation of liability** — SenFilz not liable for transfer failures or data loss
5. **Changes to terms** — terms may change; continued use = acceptance

Tone: plain English, no legalese walls. Short paragraphs.

### 7.2 `privacy.html` — Privacy Policy

Sections:
1. **What we collect** — signaling server logs IP addresses transiently for rate limiting (in-memory only, not persisted). No cookies. No analytics by default.
2. **What we don't collect** — file names, file contents, file sizes never reach our servers
3. **How transfer works** — peer-to-peer explanation; we relay only connection metadata (SDP/ICE), not files
4. **Third-party services** — Google STUN server used for NAT traversal (Google's privacy policy applies to that connection); Google Fonts for typography
5. **Contact** — contact link (see §7.3)
6. **No "anonymous" claims** — explicitly states that IP addresses are exchanged between peers as part of WebRTC's standard operation

### 7.3 Contact

Footer link: `mailto:hello@senfilz.com` (placeholder — user updates to real address).

---

## 8. SEO & Meta Tags (`index.html`)

```html
<title>SenFilz — Send Files Directly, Browser to Browser</title>
<meta name="description" content="Transfer files directly between browsers with a 6-digit code. No uploads, no account, no server storage. Peer-to-peer via WebRTC.">
<meta name="keywords" content="send files online, peer to peer file transfer, browser file sharing, no upload file transfer, WebRTC file send">
<link rel="canonical" href="https://senfilz.com/">

<!-- Open Graph -->
<meta property="og:title" content="SenFilz — Send Files Directly">
<meta property="og:description" content="Drop a file, share a 6-digit code. Files transfer directly between browsers — nothing stored on a server.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://senfilz.com/">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="SenFilz — Send Files Directly">
<meta name="twitter:description" content="Peer-to-peer file transfer via a 6-digit code. No server storage.">
```

---

## 9. "How It Works" Section

3 steps using the glass-card step component:

1. **Drop your file** — Select or drag any file. A 6-digit code and QR code appear instantly.
2. **Share the code** — Send the 6-digit code or let the receiver scan the QR code. It works for 10 minutes.
3. **Files transfer directly** — The receiver enters the code and the file goes straight from your browser to theirs. Nothing touches our servers.

---

## 10. FAQ Section

| Question | Answer |
|---|---|
| Does SenFilz store my files? | No. Files transfer directly between the two browsers using WebRTC. Our server only relays the connection details needed to set up that direct link — it never sees your file. |
| Are transfers private? | The connection is peer-to-peer. As with any direct internet connection, both sides can see each other's IP address. We do not log or store any transfer data. |
| What's the file size limit? | There is no hard limit enforced by SenFilz. Very large files may be slow depending on your connection speed and browser memory. |
| How long does the code last? | Each code works for 10 minutes and can only be used once. After the receiver connects, the code is immediately invalidated. |
| Why did my transfer fail? | WebRTC direct connections can fail on restrictive networks (corporate firewalls, certain VPNs). Try a different network if this happens. |
| Is there a mobile app? | No app needed — SenFilz works in any modern mobile browser. |

---

## 11. Additions (TURN + Multi-file + Size Warning)

### 11.1 TURN Server — Metered.ca Free Tier

WebRTC connections fail on symmetric NATs and strict corporate firewalls without a TURN relay. To prevent the ~15–20% failure rate, the ICE server config includes both STUN and TURN:

```js
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  {
    urls: 'turn:relay.metered.ca:80',
    username: 'METERED_USERNAME',      // set from env or config
    credential: 'METERED_CREDENTIAL'
  },
  {
    urls: 'turn:relay.metered.ca:443',
    username: 'METERED_USERNAME',
    credential: 'METERED_CREDENTIAL'
  },
  {
    urls: 'turn:relay.metered.ca:443?transport=tcp',
    username: 'METERED_USERNAME',
    credential: 'METERED_CREDENTIAL'
  }
];
```

**Setup:** User creates a free account at metered.ca, gets credentials, and replaces the placeholder constants in `app.js`. Free tier: 500 GB/month relay bandwidth. TURN only activates as fallback — direct connections still preferred by the ICE negotiation process.

**Important:** TURN credentials are embedded in client-side JS (visible in source). This is normal and acceptable — Metered's free tier credentials have low value and the relay bandwidth cap prevents abuse. Production deployments should use short-lived TURN credentials via a backend endpoint if desired (out of scope for MVP).

### 11.2 Multi-file Support

**Sender UX change:**
- Drop zone accepts multiple files (`multiple` attribute on input)
- After drop, shows a file list: each file name + size, with a remove (×) button per file
- Total count + combined size shown (e.g. "3 files · 48.2 MB")
- A 2 GB warning appears if any single file exceeds 2 GB (see §11.3)
- Same single 6-digit code covers all files in the session

**Transfer protocol change:**
- Files are sent sequentially over the same data channel, one at a time
- Before each file: sender sends a JSON metadata message `{ type: 'meta', index, total, name, size, mimeType }`
- After each file's chunks: sender sends `{ type: 'done', index }`
- After all files: sender sends `{ type: 'all-done' }`
- Receiver triggers a separate `download()` for each completed file

**Progress UI change:**
- Shows "File 2 of 3 — document.pdf" during transfer
- Per-file progress bar + overall session progress bar (two bars)
- Both sides show both bars

**Sender state machine addition:**
- `idle` now shows file list after drop instead of immediately connecting
- A "Send [N] file(s)" button triggers the code generation + WS connection

### 11.3 File Size Warning (above 2 GB)

If any selected file exceeds 2 GB, a `warning-box` appears in the file list:

> "One or more files exceed 2 GB. Very large files are kept in memory during transfer and may crash the browser on slower devices. Make sure both sender and receiver have enough available RAM."

The warning is informational only — it does not block the transfer. The user can proceed. The warning is shown on the sender side before the code is generated, and re-shown on the receiver side once metadata is received.

## 12. Out of Scope

- Authentication / accounts
- Transfer history
- End-to-end encryption beyond WebRTC's built-in DTLS (DTLS is mandatory in WebRTC spec — all data channels are encrypted in transit)
- Analytics (no tracking by default)
- Short-lived TURN credentials endpoint (static credentials used in MVP)

---

## 13. Deployment Notes (informational, not part of build)

- Static files (`index.html`, `terms.html`, `privacy.html`, `assets/`) → any static host (Vercel, Netlify, Cloudflare Pages)
- Signaling server → any Node.js host (Railway, Render, Fly.io); set `PORT` env var; point `WS_URL` constant in `app.js` to the deployed WS URL
- TURN credentials → replace `METERED_USERNAME` and `METERED_CREDENTIAL` placeholders in `app.js` with values from metered.ca dashboard
- No database, no persistent storage needed on server
