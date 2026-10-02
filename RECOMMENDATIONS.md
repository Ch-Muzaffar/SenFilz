# SenFilz — Recommendations for Improvement
_What to add to grow the product, build customer trust, and increase reliability._

---

## Priority 1 — Trust & Reliability (Add First)

### 1.1 Transfer history (this session only)
Show a simple log of completed transfers in the current browser session — filename, size, time, direction (sent/received). No server storage — just `sessionStorage`. Customers immediately trust a tool more when they can see what it did.

### 1.2 File integrity checksum
After transfer completes, display a short SHA-256 hash of the file on both sides. Receiver can verify their copy matches. Builds trust that the file arrived intact. WebRTC guarantees this technically, but showing it visually reassures non-technical users.

### 1.3 Transfer speed and time remaining
Currently progress shows percentage and speed. Add estimated time remaining ("~2 min left") — the single most-requested feature in any file transfer UI.

### 1.4 Connection quality indicator
Small dot next to "Connected" — green (direct P2P), yellow (relayed via TURN), red (reconnecting). Users on restrictive networks often don't know why it's slow. Knowing it's relayed sets expectations.

### 1.5 TURN server health check on load
On page load, silently ping the TURN server. If it's unreachable, show a subtle warning: "Relay server unavailable — transfers on restricted networks may fail." Prevents silent failures.

---

## Priority 2 — UX Improvements

### 2.1 Drag-and-drop from phone (camera roll)
On mobile, the file picker doesn't show a "Take photo" option by default. Add `accept="*/*"` and `capture` attribute hints so mobile users can share directly from camera roll or Files app without confusion.

### 2.2 Pause and resume transfer
If the browser tab goes to background on mobile, the transfer may stall. Add a "Pause" button that stops sending chunks and a "Resume" that continues from where it left off. Requires tracking offset state.

### 2.3 Copy link instead of just code
Next to the "Copy code" button, add a "Copy link" button that copies `https://senfilz.com/?code=XXXXXX`. Receivers can click a link instead of typing digits — much smoother when sharing over chat.

### 2.4 QR code download button
Let the sender save the QR code as a PNG. Useful when sharing over platforms where images are easier than text (WhatsApp status, Instagram DMs, printed paper).

### 2.5 Dark/light mode remembers preference
Already implemented via localStorage. ✅ No action needed.

### 2.6 Transfer cancelled confirmation
When sender cancels mid-transfer, show a brief confirmation dialog ("Cancel this transfer? The receiver will see a 'Transfer interrupted' message.") to prevent accidental cancellations.

### 2.7 Sound notification on completion
Optional — a short completion chime when the transfer finishes (especially useful on mobile when the screen is off). Respect `prefers-reduced-motion` and add a toggle to disable.

---

## Priority 3 — Growth & SEO

### 3.1 Dedicated landing page for "send large files"
Create `/send-large-files.html` targeting the keyword "send large files free online". 300-word explainer focused on large file use case. Internal links to main tool.

### 3.2 Comparison page
"/vs-wetransfer" or "/vs-google-drive" — "Why use SenFilz instead of WeTransfer?" (no signup, no storage, no file size limit). High-intent SEO keyword. Short, honest comparison.

### 3.3 Share buttons on completion
After a successful transfer, show "Share SenFilz" → small Twitter/WhatsApp/copy-link buttons. Every happy user is a potential referrer.

### 3.4 Open Graph image
Add a custom OG image (`og:image`) to `index.html` — currently missing. Without it, social media previews show a blank card. A simple 1200×630px image with the SenFilz logo and tagline is enough.

### 3.5 Structured data (JSON-LD)
Add `WebApplication` structured data to `index.html` for better Google rich results:
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "name": "SenFilz",
  "url": "https://senfilz.com",
  "description": "Browser-to-browser file transfer using WebRTC. No uploads, no account.",
  "applicationCategory": "UtilitiesApplication",
  "operatingSystem": "Any",
  "offers": { "@type": "Offer", "price": "0" }
}
</script>
```

### 3.6 robots.txt and sitemap.xml
Currently missing from the project. Add both before deploying:

**robots.txt:**
```
User-agent: *
Allow: /
Disallow:
Sitemap: https://senfilz.com/sitemap.xml
```

**sitemap.xml:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://senfilz.com/</loc><priority>1.0</priority></url>
  <url><loc>https://senfilz.com/terms.html</loc><priority>0.3</priority></url>
  <url><loc>https://senfilz.com/privacy.html</loc><priority>0.3</priority></url>
</urlset>
```

---

## Priority 4 — Security Hardening

### 4.1 Short-lived TURN credentials
Currently TURN username/password are hardcoded in client-side JS — anyone can read them from the source. For production, add a tiny backend endpoint (`/api/turn-credentials`) that generates a HMAC-signed credential valid for 24 hours. Metered.ca supports this natively.

### 4.2 Content Security Policy header
Add a `Content-Security-Policy` header via Netlify `_headers` file to prevent XSS. At minimum:
```
Content-Security-Policy: default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com 'unsafe-inline'; connect-src 'self' wss: https:; font-src https://fonts.gstatic.com; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'
```

### 4.3 Signaling server input validation
Currently the server parses JSON and reads `msg.code`, `msg.offer`, etc. without length/type checks. Add basic validation — reject messages where `code` is not exactly 6 digits, or where `offer`/`answer`/`candidate` fields exceed reasonable size limits (e.g. 10 KB). Prevents memory abuse.

### 4.4 WSS-only in production
The signaling server should reject plain `ws://` connections in production (only allow `wss://`). Railway handles TLS termination automatically, but add a note in the deploy guide to never expose the server over plain HTTP.

---

## Priority 5 — Monetisation (When Traffic Exists)

### 5.1 "Buy a coffee" link
Add a Ko-fi or Buy Me a Coffee button — small, non-intrusive, shown after a successful transfer. Users who just got value are most likely to donate.

### 5.2 Pro plan (later)
A paid tier could offer:
- Larger TURN relay quota (no 500 GB/month cap)
- Custom expiry time (extend beyond 10 minutes)
- Password-protected transfers
- Transfer receipts via email
- No 2 GB memory warning (server-side streaming)

### 5.3 API for developers
Expose a REST API to programmatically create transfer codes. Developers could embed SenFilz transfers into their own apps. Monetise via API keys.

---

## Quick Wins (Can Do Today)

| Item | Effort | Impact |
|---|---|---|
| Add `robots.txt` and `sitemap.xml` | 10 min | SEO |
| Add OG image | 20 min | Social sharing |
| Add JSON-LD structured data | 10 min | SEO |
| Add "Copy link" button next to "Copy code" | 30 min | UX |
| Add estimated time remaining to progress | 45 min | UX |
| Add Ko-fi link after successful transfer | 15 min | Revenue |

---

_Version 1.0 — September 2026_
