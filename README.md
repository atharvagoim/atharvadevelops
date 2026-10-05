# Atharva Goim — site + message inbox

```
public/          the website (index.html = Home, about.html = About)
public/contact.html the Contact page (opens at /contact)
public/extras.html the Extras page (opens at /extras)
public/chat.html the visitor's private chat page (opens at /chat)
public/admin/    the admin panel (opens at /admin)
server/          Express server: serves the site and stores messages
```

## Run it on your computer

```bash
npm install
cp .env.example .env      # then open .env and set ADMIN_PASSWORD
npm start
```

- Site: http://localhost:3000
- Admin: http://localhost:3000/admin  (log in with your ADMIN_PASSWORD)

With no `MONGODB_URI`, messages are saved to `data/conversations.json`.

## How the chat works

1. A visitor types in "message developer directly" and presses send.
2. A popup opens (or they use the form on the Contact page). They **must** enter their name, a valid email or phone, and the message. Nothing is sent without it.
3. They land on their private chat page (`/chat`). It's saved on their device, so they can come back anytime. A small "Your chat" button appears on Home/About, with an orange dot when you've replied.
4. You open `/admin`, pick the chat on the left and reply. They see your reply live (within ~4 seconds) on their chat page, and can keep replying.
5. In admin you can also email / WhatsApp / call them directly, mark a chat unread, delete it, search, and filter unread. Click **Enable alerts** for browser notifications.

Each chat has a secret key that's stored only on the visitor's device, so nobody else can read it. Spam protection: 5 new chats per 10 minutes per visitor, a hidden honeypot field, a 2000-character limit, and limited login attempts.

## Your work images ("Services we provide")

`/admin` → **Work**:
- **Add images**: click or drop files (JPG, PNG, WebP, GIF). Big photos are shrunk in your browser before upload, so it's quick.
- **Caption** and optional **link** per image (clicking the image on your site opens the link).
- **Reorder** by dragging the ⋮⋮ handle (on phones use ↑ / ↓). **Remove** asks you to confirm.
- **Restore originals** puts the first four images back.
- With more images than fit, the row gets arrows and can be dragged sideways; on phones it's a swipe row.

Uploaded images are stored in MongoDB when `MONGODB_URI` is set (so they survive redeploys on Render), otherwise in `data/media/`.

## Your contact details (Call / WhatsApp / Mail / Instagram)

Edit them in the admin panel: `/admin` → **Settings**. They go live on the site as soon as you save.
- Paste a full WhatsApp or Instagram link if you like; it's cleaned up to just the number / username.
- Leave a field empty to hide that button on the site.
- Optional starting values can be set with env vars `CONTACT_PHONE`, `CONTACT_WHATSAPP`, `CONTACT_EMAIL`, `CONTACT_INSTAGRAM` (used until you save in Settings).

## Put it online (Render + MongoDB Atlas)

1. Create a free cluster on MongoDB Atlas and copy its connection string.
2. Push this folder to GitHub.
3. On Render: **New → Web Service** → pick the repo.
   - Build command: `npm install`
   - Start command: `npm start`
4. Add environment variables on Render:
   - `ADMIN_PASSWORD` – your admin password
   - `JWT_SECRET` – a long random string (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
   - `MONGODB_URI` – your Atlas connection string
   - `NODE_ENV` – `production`
5. In Atlas → Network Access, allow Render to connect (adding `0.0.0.0/0` is the simple option).

Use MongoDB in production: Render's disk is wiped on every deploy, so the local-file option would lose messages.

### Using a MongoDB database you share with another app?
The inbox only shows chats created by this site, so records from other apps in the same database are ignored (they're never touched or deleted). To keep things clean, give this site its own database name in the connection string, e.g. `...mongodb.net/atharva-site?retryWrites=true`.

## Put it online on Vercel (everything on Vercel)

The project is Vercel-ready (`vercel.json` + `api/index.js`): pages are served from Vercel's CDN and the API runs as a serverless function.

1. Create a free MongoDB Atlas cluster (required on Vercel, because its disk is temporary). Network Access → allow `0.0.0.0/0`.
2. Push this folder to GitHub.
3. vercel.com → **Add New → Project** → import the repo. Framework preset: **Other**. Leave build/output settings empty (`vercel.json` sets them).
4. Environment variables: `ADMIN_PASSWORD`, `JWT_SECRET`, `MONGODB_URI`, `NODE_ENV=production`.
5. Deploy, then open `https://your-project.vercel.app/admin`.

Notes: uploads must be under 4.5 MB (the admin panel already shrinks photos to 1600px, well below that). Every `git push` redeploys.

### Site on Vercel, server on Render?

That works too:
- In `public/script.js`, set `API_BASE` to your Render URL (e.g. `https://your-app.onrender.com`).
- On Render, set `ALLOWED_ORIGINS` to your site's URL (e.g. `https://atharva.vercel.app`).
- Open the admin panel on the Render URL: `https://your-app.onrender.com/admin`.


## Security built in

- Strict security headers on every page: Content-Security-Policy (only this site's own scripts can run), no framing, Permissions-Policy, HSTS in production.
- Admin login: rate-limited, constant-time password check, httpOnly + SameSite=strict cookie, sessions expire after 7 days. Changing `ADMIN_PASSWORD` logs out every existing session.
- Admin changes are only accepted from your own site's pages (cross-site requests are blocked).
- Uploads: only real JPG/PNG/WebP/GIF images (checked by file signature), max 8 MB, served with a sandbox policy so they can never run as a page.
- Visitor chats: secret per-chat key (only its hash is stored), rate limits, honeypot, length limits, strict id checks.
- Use a strong `ADMIN_PASSWORD` (10+ characters) and a long random `JWT_SECRET` in production.
