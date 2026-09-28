# SenFilz — Complete Deployment Guide
Everything you need to go fully live, step by step.

---

## What you have (already done)

| File | Status |
|---|---|
| `index.html` | Ready |
| `terms.html` | Ready |
| `privacy.html` | Ready |
| `assets/style.css` | Ready |
| `assets/app.js` | TURN credentials set, **WS_URL still needs updating after Step 2** |
| `signaling/server.js` | Ready to deploy |
| `signaling/package.json` | Ready |

---

## What's left (in order)

1. Deploy the signaling server → get its URL
2. Update WS_URL in app.js
3. Deploy the frontend
4. (Optional) Connect your custom domain

---

---

# STEP 1 — Deploy the Signaling Server on Railway

Railway is the easiest free host for a Node.js WebSocket server.

### 1.1 Create a Railway account
1. Go to **https://railway.app**
2. Click **Login** → sign in with GitHub (recommended) or email

### 1.2 Create a new project
1. Click **New Project**
2. Select **Empty Project**

### 1.3 Add a service from your local folder
1. Inside the project, click **+ Add Service**
2. Choose **GitHub Repo** if your code is on GitHub
   — OR —
   Choose **Empty Service**, then in the service settings go to **Source** → upload or connect

> **Easiest method if not on GitHub:**
> 1. Install Railway CLI: open your Terminal and run:
>    ```
>    npm install -g @railway/cli
>    ```
> 2. Log in:
>    ```
>    railway login
>    ```
> 3. Navigate to the signaling folder:
>    ```
>    cd /Users/mac/Desktop/Muzaffar1/signaling
>    ```
> 4. Link to your project:
>    ```
>    railway link
>    ```
>    (select the project you just created)
> 5. Deploy:
>    ```
>    railway up
>    ```

### 1.4 Set the start command
In Railway dashboard → your service → **Settings** → **Deploy** → **Start Command**:
```
node server.js
```

### 1.5 Generate a public domain
1. In Railway → your service → **Settings** → **Networking**
2. Click **Generate Domain**
3. You will get a URL like:
   ```
   senfilz-signaling.up.railway.app
   ```
4. **Copy this URL** — you need it in Step 2

### 1.6 Verify the server is running
Open your browser and go to:
```
https://senfilz-signaling.up.railway.app
```
You should see:
```
SenFilz signaling OK
```
If you see that — the signaling server is live. ✅

---

---

# STEP 2 — Update WS_URL in app.js

Open this file:
```
/Users/mac/Desktop/Muzaffar1/assets/app.js
```

Find line 9 (at the very top of the file):
```js
const WS_URL = 'wss://YOUR_SIGNALING_SERVER';
```

Replace it with your Railway URL (use `wss://` not `https://`):
```js
const WS_URL = 'wss://senfilz-signaling.up.railway.app';
```

**Important:** Use `wss://` (WebSocket Secure) — NOT `https://`. The domain is the same, just the protocol prefix changes.

Save the file.

---

---

# STEP 3 — Deploy the Frontend on Netlify

The frontend is just static files — no server needed. Netlify hosts it for free.

### 3.1 Create a Netlify account
1. Go to **https://netlify.com**
2. Click **Sign up** → use GitHub or email

### 3.2 Deploy by drag and drop (easiest method)
1. Go to **https://app.netlify.com/drop**
2. Open Finder → navigate to your Desktop → open the **Muzaffar1** folder
3. Select these items (hold Cmd to select multiple):
   - `index.html`
   - `terms.html`
   - `privacy.html`
   - `assets/` (the entire folder)
4. Drag all of them into the Netlify drop zone in your browser
5. Wait ~30 seconds for deployment

> **Do NOT include:**
> - `signaling/` folder (that's already on Railway)
> - `docs/` folder
> - `DEPLOY_GUIDE.md`

### 3.3 Get your live URL
Netlify gives you a random URL like:
```
https://amazing-curie-abc123.netlify.app
```

Open it in your browser. You should see the SenFilz homepage. ✅

### 3.4 Test the full flow
1. Open your Netlify URL in **Browser Tab 1** (Sender)
2. Open the same URL in **Browser Tab 2** (Receiver) — or on your phone
3. In Tab 1: drop any file → a 6-digit code appears
4. In Tab 2: click "Receive a file" tab → enter the code → click Connect
5. File should transfer and auto-download on Tab 2

If it works — you're live. ✅

---

---

# STEP 4 — (Optional) Connect a Custom Domain

If you have a domain (e.g. `senfilz.com`), connect it to Netlify.

### 4.1 Add domain to Netlify
1. Netlify dashboard → your site → **Domain settings**
2. Click **Add custom domain**
3. Enter your domain: `senfilz.com`
4. Click **Verify** → **Add domain**

### 4.2 Update your DNS
Go to your domain registrar (GoDaddy, Namecheap, Cloudflare, etc.) and add:

| Type | Name | Value |
|---|---|---|
| `CNAME` | `www` | `amazing-curie-abc123.netlify.app` |
| `A` | `@` | `75.2.60.5` |

> Netlify shows you the exact values in **Domain settings → DNS panel**. Use those — they may differ slightly.

DNS changes take 5 minutes to 48 hours to propagate.

### 4.3 Enable HTTPS (automatic)
Netlify auto-provisions an SSL certificate via Let's Encrypt once DNS is set. No action needed — just wait for the green lock to appear.

### 4.4 (Optional) Custom domain for signaling server too
If you want `ws://signal.senfilz.com` instead of the Railway URL:
1. Railway → your service → **Settings** → **Networking** → **Custom Domain**
2. Add `signal.senfilz.com`
3. Add a `CNAME` record in your DNS: `signal` → your Railway domain
4. Update `WS_URL` in `app.js` to `wss://signal.senfilz.com`
5. Re-deploy frontend to Netlify (drag and drop again)

---

---

# Final Checklist Before Sharing

Go through each item and confirm:

- [ ] Signaling server live → `https://your-railway-url.railway.app` returns "SenFilz signaling OK"
- [ ] `WS_URL` in `assets/app.js` updated to `wss://your-railway-url.railway.app`
- [ ] Frontend deployed to Netlify → site loads correctly
- [ ] Full transfer test passed (two tabs, file transfers and downloads)
- [ ] `mailto:hello@senfilz.com` updated to your real email in `index.html`, `terms.html`, `privacy.html`
- [ ] (Optional) Custom domain connected and HTTPS active

---

---

# Troubleshooting

### "Connection failed" after 30 seconds
- Check that `WS_URL` starts with `wss://` not `https://`
- Check that Railway service is running (Railway dashboard → Deployments → should show "Active")
- Try from a mobile hotspot — corporate/university networks often block WebSocket connections

### QR code is blank or not showing
- The QR code library loads from cdnjs CDN. Check your internet connection.
- If it still fails, the code display still works — the QR is a convenience feature only.

### File downloads but is corrupted
- This should not happen (WebRTC data channels are reliable). If it does, try a smaller file first to confirm the connection is working.

### Railway server sleeps (free tier)
- Railway free tier does not sleep — it stays live as long as you have credits.
- If you run out of Railway credits, migrate to **Render.com** (free tier sleeps after 15 min inactivity — first connection after sleep takes ~30s) or **Fly.io**.

### Transfer fails on mobile
- Some mobile browsers (older iOS Safari) have limited WebRTC DataChannel support. Use Chrome or Firefox on mobile for best results.

---

---

# Quick Reference — Credentials & URLs

| Item | Value |
|---|---|
| TURN domain | `senfilz.metered.live` |
| TURN username | `de7ab377b3405aad1e5e44c4` |
| TURN password | `OUfcZ/F2q6bzpqxp` |
| Signaling server URL | ⬅ Add after Railway deployment |
| Frontend URL | ⬅ Add after Netlify deployment |
| Contact email | `hello@senfilz.com` (update to your real email) |

---

*Once all checkboxes above are ticked, SenFilz is fully live.*
