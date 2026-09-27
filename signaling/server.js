'use strict';

/**
 * SenFilz — WebSocket Signaling Server
 *
 * Relays WebRTC SDP offers/answers and ICE candidates between peers.
 * Never sees file data. No database. In-memory sessions only.
 *
 * Deploy: set PORT env var (default 8080)
 * Rate limit: 5 session creates per 60s per IP
 * Code TTL: 10 minutes, single-use
 */

const { WebSocketServer } = require('ws');
const http = require('http');

const PORT       = parseInt(process.env.PORT || '8080', 10);
const CODE_TTL   = 10 * 60 * 1000;   // 10 minutes in ms
const RATE_LIMIT = 5;                 // max creates per window per IP
const RATE_WIN   = 60 * 1000;        // 60 second window

/**
 * Session store: Map<code, Session>
 * Session: { senderWs, receiverWs, offer, createdAt, used }
 */
const sessions = new Map();

/**
 * Rate limit store: Map<ip, { count, windowStart }>
 */
const rateLimits = new Map();

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateCode() {
  let code;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (sessions.has(code));
  return code;
}

/** Returns true if the IP is under the rate limit, false if over. */
function checkRate(ip) {
  const now = Date.now();
  let rec = rateLimits.get(ip);
  if (!rec || now - rec.windowStart > RATE_WIN) {
    rec = { count: 0, windowStart: now };
  }
  rec.count++;
  rateLimits.set(ip, rec);
  return rec.count <= RATE_LIMIT;
}

function isExpired(session) {
  return Date.now() - session.createdAt > CODE_TTL;
}

function send(ws, obj) {
  if (ws && ws.readyState === 1 /* OPEN */) {
    ws.send(JSON.stringify(obj));
  }
}

function sendError(ws, message) {
  send(ws, { type: 'error', message });
}

// ── Cleanup: remove expired/used sessions every 60s ──────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [code, s] of sessions) {
    if (s.used || now - s.createdAt > CODE_TTL) {
      sessions.delete(code);
    }
  }
  // Also prune stale rate-limit records
  for (const [ip, rec] of rateLimits) {
    if (now - rec.windowStart > RATE_WIN * 2) rateLimits.delete(ip);
  }
}, 60_000);

// ── HTTP server (health check + WS upgrade) ───────────────────────────────────
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('SenFilz signaling OK\n');
});

// ── WebSocket server ──────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  // Resolve client IP (works behind most reverse proxies)
  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket.remoteAddress ||
    'unknown';

  // Track which code this socket owns so we can clean up on close
  let assignedCode = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return; // ignore malformed JSON
    }

    switch (msg.type) {

      // ── Sender creates a session ────────────────────────────────────────────
      case 'create': {
        if (!checkRate(ip)) {
          sendError(ws, 'Too many sessions. Try again in a minute.');
          ws.close();
          return;
        }
        const code = generateCode();
        sessions.set(code, {
          senderWs:   ws,
          receiverWs: null,
          offer:      null,
          createdAt:  Date.now(),
          used:       false,
        });
        assignedCode = code;
        send(ws, { type: 'code', code });
        break;
      }

      // ── Sender uploads its SDP offer ────────────────────────────────────────
      case 'offer': {
        const s = sessions.get(msg.code);
        if (!s || isExpired(s)) return;
        s.offer = msg.offer;
        break;
      }

      // ── Receiver joins a session ────────────────────────────────────────────
      case 'join': {
        const s = sessions.get(msg.code);
        if (!s || s.used || isExpired(s)) {
          sendError(ws,
            'That code is invalid or has already been used. Codes expire after 10 minutes and can only be used once.'
          );
          return;
        }
        s.used       = true;
        s.receiverWs = ws;
        assignedCode = msg.code;

        // Forward the stored offer to receiver
        send(ws, { type: 'offer', offer: s.offer });
        // Notify sender that receiver joined
        send(s.senderWs, { type: 'receiver-joined' });
        break;
      }

      // ── Receiver sends its SDP answer ───────────────────────────────────────
      case 'answer': {
        const s = sessions.get(msg.code);
        if (!s) return;
        send(s.senderWs, { type: 'answer', answer: msg.answer });
        break;
      }

      // ── Either peer sends an ICE candidate ──────────────────────────────────
      case 'ice': {
        const s = sessions.get(msg.code);
        if (!s) return;
        const target = ws === s.senderWs ? s.receiverWs : s.senderWs;
        send(target, { type: 'ice', candidate: msg.candidate });
        break;
      }

      default:
        // Unknown message type — silently ignore
        break;
    }
  });

  ws.on('close', () => {
    if (!assignedCode) return;
    const s = sessions.get(assignedCode);
    if (!s) return;

    // Notify the other peer so they can show "transfer interrupted"
    if (ws === s.senderWs && s.receiverWs) {
      send(s.receiverWs, { type: 'peer-disconnected' });
    } else if (ws === s.receiverWs && s.senderWs) {
      send(s.senderWs, { type: 'peer-disconnected' });
    }

    sessions.delete(assignedCode);
  });

  ws.on('error', () => {
    // Handled by the 'close' event above
  });
});

server.listen(PORT, () => {
  console.log(`SenFilz signaling server running on port ${PORT}`);
  console.log(`HTTP health: http://localhost:${PORT}/`);
  console.log(`WebSocket:   ws://localhost:${PORT}/`);
});
