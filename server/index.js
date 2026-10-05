require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const createStore = require("./store");

const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === "production";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
let JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  JWT_SECRET = crypto.randomBytes(32).toString("hex");
  console.warn("⚠  JWT_SECRET not set — using a temporary one (you'll be logged out when the server restarts).");
}
if (!ADMIN_PASSWORD) {
  console.warn("⚠  ADMIN_PASSWORD not set — admin login is disabled until you set it in .env");
}

if (process.env.VERCEL && !process.env.MONGODB_URI) {
  console.error("✗ MONGODB_URI is not set. On Vercel the disk is temporary, so a MongoDB database is required.");
}

const store = createStore();
const app = express();
// connect once per server instance (on Vercel each instance reuses this between requests)
const ready = store.init();
app.set("trust proxy", 1); // correct client IPs behind Render / Vercel proxies
app.disable("x-powered-by");
app.use((req, res, next) => ready.then(() => next(), next)); // wait for the database before handling anything
app.use(express.json({ limit: "20kb" }));
app.use(cookieParser());

if (IS_PROD && ADMIN_PASSWORD && ADMIN_PASSWORD.length < 10) {
  console.warn("⚠  ADMIN_PASSWORD is short. Use at least 10 characters (a few random words works well).");
}

// Security headers
// The only inline script on the pages is the tiny "keep the nav still" line in <head>; it's allowed by its hash.
const NAV_SCRIPT_HASH = "'sha256-RRsP7V4EZXKIY4pbS0gsnIDx74tpcbl0kvxfenc6V9w='";
const CSP = [
  "default-src 'self'",
  `script-src 'self' ${NAV_SCRIPT_HASH}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(IS_PROD ? ["upgrade-insecure-requests"] : []),
].join("; ");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", ALLOWED_ORIGINS.length ? "cross-origin" : "same-origin");
  if (IS_PROD) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});

/* ======================= Visitor chat ======================= */

// Allow the site to call the API from another domain (e.g. site on Vercel, API on Render)
app.use("/api/chat", (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Chat-Token");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  res.setHeader("Cache-Control", "no-store");
  next();
});

const limiter = (limit, minutes, error) =>
  rateLimit({ windowMs: minutes * 60 * 1000, limit, standardHeaders: "draft-7", legacyHeaders: false, message: { error } });
const startLimiter = limiter(5, 10, "Too many new chats. Please try again in a few minutes.");
const sendLimiter = limiter(40, 10, "You're sending messages too fast. Please wait a moment.");
const pollLimiter = limiter(400, 10, "Too many requests.");

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const isPhone = (s) => /^[+\d][\d\s\-()]{5,}$/.test(s) && s.replace(/\D/g, "").length >= 7;
const clean = (v, max) => (typeof v === "string" ? v.replace(/\s+$/g, "").replace(/^\s+/g, "").slice(0, max + 1) : "");
const checkText = (text) => {
  if (!text) return "Please type a message.";
  if (text.length > 2000) return "Message is too long (max 2000 characters).";
  return null;
};
const tokenOf = (req) => (req.get("X-Chat-Token") || "").slice(0, 100);
app.param("id", (req, res, next, id) => (typeof id === "string" && id.length <= 64 && /^[A-Za-z0-9-]+$/.test(id) ? next() : res.status(404).json({ error: "Not found." })));

// Start a chat (the popup on the site sends name + contact + first message)
app.post("/api/chat", startLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    if (body.website) return res.status(201).json({ id: "ok", token: "ok" }); // honeypot: bots fill it

    const name = clean(body.name, 60);
    const contact = clean(body.contact, 120);
    const text = clean(body.message, 2000);
    if (!name) return res.status(400).json({ error: "Please enter your name.", field: "name" });
    if (name.length > 60) return res.status(400).json({ error: "Name is too long.", field: "name" });
    if (!EMAIL.test(contact) && !isPhone(contact))
      return res.status(400).json({ error: "Enter a valid email or phone number.", field: "contact" });
    const err = checkText(text);
    if (err) return res.status(400).json({ error: err, field: "message" });

    const { conversation, token } = await store.create({ name, contact, text });
    res.status(201).json({ id: conversation.id, token });
  } catch (err) {
    console.error("start chat failed:", err);
    res.status(500).json({ error: "Could not send right now. Please try again." });
  }
});

// Read your chat (visitor)
app.get("/api/chat/:id", pollLimiter, async (req, res) => {
  try {
    const peek = req.query.peek === "1"; // peek = check for new replies without marking them read
    const c = await store.getForVisitor(req.params.id, tokenOf(req), { markRead: !peek });
    if (!c) return res.status(404).json({ error: "Chat not found." });
    if (peek) return res.json({ id: c.id, unread: c.visitorUnread });
    res.json({ id: c.id, name: c.name, messages: c.messages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load the chat." });
  }
});

// Send another message in your chat (visitor)
app.post("/api/chat/:id/messages", sendLimiter, async (req, res) => {
  try {
    const text = clean((req.body || {}).text, 2000);
    const err = checkText(text);
    if (err) return res.status(400).json({ error: err });
    const m = await store.addMessage(req.params.id, "visitor", text, { token: tokenOf(req) });
    if (!m) return res.status(404).json({ error: "Chat not found." });
    res.status(201).json(m);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not send right now." });
  }
});

/* ======================= Admin auth ======================= */

const COOKIE = "admin_token";
const cookieOpts = { httpOnly: true, sameSite: "strict", secure: IS_PROD, path: "/", maxAge: 7 * 24 * 60 * 60 * 1000 };

// changing ADMIN_PASSWORD invalidates every existing login
const PASS_FP = crypto.createHmac("sha256", JWT_SECRET).update(ADMIN_PASSWORD).digest("hex").slice(0, 16);

const safeEqual = (a, b) => {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again in 15 minutes." },
});

app.post("/api/admin/login", loginLimiter, (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: "Admin password is not set on the server." });
  const { password } = req.body || {};
  if (typeof password !== "string" || password.length > 200 || !safeEqual(password, ADMIN_PASSWORD)) return res.status(401).json({ error: "Wrong password." });
  const token = jwt.sign({ role: "admin", pv: PASS_FP }, JWT_SECRET, { algorithm: "HS256", expiresIn: "7d" });
  res.cookie(COOKIE, token, cookieOpts).json({ ok: true });
});

app.post("/api/admin/logout", (req, res) => {
  res.clearCookie(COOKIE, { ...cookieOpts, maxAge: undefined }).json({ ok: true });
});

function requireAdmin(req, res, next) {
  try {
    const payload = jwt.verify(req.cookies[COOKIE] || "", JWT_SECRET, { algorithms: ["HS256"] });
    if (payload.role !== "admin" || payload.pv !== PASS_FP) throw new Error("bad session");
    next();
  } catch {
    res.status(401).json({ error: "Please log in." });
  }
}

/* ======================= Admin: conversations ======================= */

// Admin changes must come from this site's own pages (blocks cross-site request forgery)
app.use("/api/admin", (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("Origin");
  const site = req.get("Sec-Fetch-Site");
  if (site && !["same-origin", "none"].includes(site)) return res.status(403).json({ error: "Blocked." });
  if (origin) {
    let host = "";
    try { host = new URL(origin).host; } catch {}
    if (host !== req.get("host")) return res.status(403).json({ error: "Blocked." });
  }
  next();
});

app.get("/api/admin/me", requireAdmin, (req, res) => res.json({ ok: true }));
app.use("/api/admin", (req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

app.get("/api/admin/conversations", requireAdmin, async (req, res) => {
  try {
    const filter = req.query.filter === "unread" ? "unread" : "all";
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
    res.json(await store.list({ filter, q }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load conversations." });
  }
});

app.get("/api/admin/conversations/:id", requireAdmin, async (req, res) => {
  const c = await store.getForAdmin(req.params.id, { markRead: req.query.peek !== "1" });
  if (!c) return res.status(404).json({ error: "Conversation not found." });
  const { tokenHash, ...safe } = c;
  res.json(safe);
});

app.post("/api/admin/conversations/:id/messages", requireAdmin, async (req, res) => {
  const text = clean((req.body || {}).text, 2000);
  const err = checkText(text);
  if (err) return res.status(400).json({ error: err });
  const m = await store.addMessage(req.params.id, "admin", text);
  m ? res.status(201).json(m) : res.status(404).json({ error: "Conversation not found." });
});

app.patch("/api/admin/conversations/:id", requireAdmin, async (req, res) => {
  const c = await store.setAdminUnread(req.params.id, !!(req.body && req.body.unread));
  c ? res.json(c) : res.status(404).json({ error: "Conversation not found." });
});

app.delete("/api/admin/conversations/:id", requireAdmin, async (req, res) => {
  (await store.remove(req.params.id)) ? res.json({ ok: true }) : res.status(404).json({ error: "Conversation not found." });
});

/* ======================= Contact settings ======================= */

// Public: the site reads your phone / WhatsApp / email / Instagram from here
app.get("/api/settings", async (req, res) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) { res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin"); }
  res.setHeader("Cache-Control", "no-cache");
  try { res.json(await store.getSettings()); } catch (err) { console.error(err); res.status(500).json({ error: "Could not load settings." }); }
});

app.get("/api/admin/settings", requireAdmin, async (req, res) => {
  res.json(await store.getSettings());
});

// Validate + normalise what you type in the admin panel
function cleanSettings(body) {
  const errors = {};
  const out = {};
  const str = (v) => (typeof v === "string" ? v.trim() : "");

  const phone = str(body.phone);
  if (phone && !(/^[+\d][\d\s\-()]{5,24}$/.test(phone) && phone.replace(/\D/g, "").length >= 7)) errors.phone = "Enter a valid phone number, e.g. +91 98765 43210";
  out.phone = phone;

  let wa = str(body.whatsapp).replace(/^https?:\/\/(wa\.me|api\.whatsapp\.com\/send\?phone=)\/?/i, "");
  const waDigits = wa.replace(/\D/g, "");
  if (wa && (waDigits.length < 8 || waDigits.length > 15)) errors.whatsapp = "Enter the number with country code, e.g. 91 98765 43210";
  out.whatsapp = waDigits;

  const email = str(body.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = "Enter a valid email address";
  out.email = email;

  let ig = str(body.instagram).replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/\/.*$/, "").replace(/\?.*$/, "");
  if (ig && !/^[A-Za-z0-9._]{1,30}$/.test(ig)) errors.instagram = "Enter your Instagram username, e.g. atharva.builds";
  out.instagram = ig;

  return { out, errors };
}

app.put("/api/admin/settings", requireAdmin, async (req, res) => {
  const { out, errors } = cleanSettings(req.body || {});
  if (Object.keys(errors).length) return res.status(400).json({ error: "Please fix the highlighted fields.", fields: errors });
  try { res.json(await store.saveSettings(out)); } catch (err) { console.error(err); res.status(500).json({ error: "Could not save." }); }
});

/* ======================= Work images ("Services we provide") ======================= */

const publicWorks = (list) => list.map((w) => ({ id: w.id, src: w.mediaId ? `/media/${w.mediaId}` : w.src, alt: w.alt, link: w.link }));

// Public: the site loads the image row from here
app.get("/api/works", async (req, res) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) { res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin"); }
  res.setHeader("Cache-Control", "no-cache");
  try { res.json(publicWorks(await store.getWorks())); } catch (err) { console.error(err); res.status(500).json({ error: "Could not load images." }); }
});

const IMAGE_TYPES = { "image/jpeg": [0xff, 0xd8], "image/png": [0x89, 0x50], "image/webp": [0x52, 0x49], "image/gif": [0x47, 0x49] };

// Serve uploaded images
app.get("/media/:id", async (req, res) => {
  try {
    const m = await store.getMedia(req.params.id);
    if (!m || !IMAGE_TYPES[m.mime]) return res.sendStatus(404);
    res.setHeader("Content-Type", m.mime);
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable"); // ids never change
    res.send(m.data);
  } catch (err) { console.error(err); res.sendStatus(500); }
});

app.get("/api/admin/works", requireAdmin, async (req, res) => {
  res.json(publicWorks(await store.getWorks()));
});

// Upload: the admin panel sends the (already resized) image as the raw request body
const cleanLink = (v) => {
  const t = typeof v === "string" ? v.trim() : "";
  if (!t) return "";
  if (/\s/.test(t) || t.length > 300) return null;
  const withProto = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withProto);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(u.hostname)) return null; // needs a real domain like mysite.com
    return u.href;
  } catch { return null; }
};
const safeDecode = (v) => { try { return decodeURIComponent(v || ""); } catch { return ""; } };
const cleanAlt = (v) => (typeof v === "string" ? v.trim().slice(0, 120) : "");

app.post("/api/admin/works", requireAdmin, express.raw({ type: Object.keys(IMAGE_TYPES), limit: "8mb" }), async (req, res) => {
  try {
    const mime = (req.headers["content-type"] || "").split(";")[0];
    const sig = IMAGE_TYPES[mime];
    if (!sig || !Buffer.isBuffer(req.body) || req.body.length < 100) return res.status(400).json({ error: "Please upload a JPG, PNG, WebP or GIF image." });
    if (req.body[0] !== sig[0] || req.body[1] !== sig[1]) return res.status(400).json({ error: "That file doesn't look like a real image." });
    const list = await store.getWorks();
    if (list.length >= 24) return res.status(400).json({ error: "You can have up to 24 images. Remove one first." });
    const mediaId = await store.saveMedia(req.body, mime);
    const item = { id: crypto.randomUUID(), src: "", mediaId, alt: cleanAlt(safeDecode(req.get("X-Alt"))), link: cleanLink(safeDecode(req.get("X-Link"))) || "" };
    const saved = await store.saveWorks([...list, item]);
    res.status(201).json(publicWorks(saved));
  } catch (err) {
    if (err.type === "entity.too.large") return res.status(413).json({ error: "Image is too large (max 8 MB)." });
    console.error(err);
    res.status(500).json({ error: "Upload failed." });
  }
});

// Edit the caption / link of one image
app.patch("/api/admin/works/:id", requireAdmin, async (req, res) => {
  const list = await store.getWorks();
  const w = list.find((x) => x.id === req.params.id);
  if (!w) return res.status(404).json({ error: "Image not found." });
  const body = req.body || {};
  if ("alt" in body) w.alt = cleanAlt(body.alt);
  if ("link" in body) {
    const l = cleanLink(body.link);
    if (l === null) return res.status(400).json({ error: "That link doesn't look right. Example: https://mysite.com", field: "link" });
    w.link = l;
  }
  res.json(publicWorks(await store.saveWorks(list)));
});

// Reorder: body = { ids: [...] }
app.put("/api/admin/works/order", requireAdmin, async (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : null;
  const list = await store.getWorks();
  if (!ids || ids.length !== list.length || !ids.every((id) => list.some((w) => w.id === id)))
    return res.status(400).json({ error: "The image list changed. Please refresh." });
  const next = ids.map((id) => list.find((w) => w.id === id));
  res.json(publicWorks(await store.saveWorks(next)));
});

app.delete("/api/admin/works/:id", requireAdmin, async (req, res) => {
  const list = await store.getWorks();
  const w = list.find((x) => x.id === req.params.id);
  if (!w) return res.status(404).json({ error: "Image not found." });
  const saved = await store.saveWorks(list.filter((x) => x.id !== w.id));
  if (w.mediaId) await store.deleteMedia(w.mediaId).catch(() => {});
  res.json(publicWorks(saved));
});

// Put the original four images back
app.post("/api/admin/works/reset", requireAdmin, async (req, res) => {
  const list = await store.getWorks();
  await Promise.all(list.filter((w) => w.mediaId).map((w) => store.deleteMedia(w.mediaId).catch(() => {})));
  res.json(publicWorks(await store.saveWorks(createStore.DEFAULT_WORKS)));
});

app.get("/api/health", (req, res) => res.json({ ok: true, storage: store.kind }));

/* ======================= Website + admin pages ======================= */

const PUBLIC = path.join(__dirname, "..", "public");
app.get("/admin", (req, res) => res.sendFile(path.join(PUBLIC, "admin", "index.html")));
app.get("/about", (req, res) => res.sendFile(path.join(PUBLIC, "about.html")));
app.get("/chat", (req, res) => res.sendFile(path.join(PUBLIC, "chat.html")));
app.get("/contact", (req, res) => res.sendFile(path.join(PUBLIC, "contact.html")));
app.get("/extras", (req, res) => res.sendFile(path.join(PUBLIC, "extras.html")));
app.use(express.static(PUBLIC, {
  extensions: ["html"],
  dotfiles: "ignore",
  setHeaders(res, file) {
    if (/\.(html)$/.test(file)) res.setHeader("Cache-Control", "no-cache");
    else if (/\.(woff2|png|jpe?g|webp|gif|svg)$/.test(file)) res.setHeader("Cache-Control", "public, max-age=604800");
    else res.setHeader("Cache-Control", "public, max-age=3600, must-revalidate");
  },
}));
app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC, "index.html")));

// Run as a normal server (your computer, Render). On Vercel the app is exported instead.
if (require.main === module) {
  ready
    .then(() => {
      app.listen(PORT, () => {
        console.log(`✓ Site:   http://localhost:${PORT}`);
        console.log(`✓ Admin:  http://localhost:${PORT}/admin`);
        console.log(`✓ Storage: ${store.kind === "mongodb" ? "MongoDB" : "local file (data/conversations.json)"}`);
      });
    })
    .catch((err) => {
      console.error("Could not connect to the database:", err.message);
      process.exit(1);
    });
}

module.exports = app;
