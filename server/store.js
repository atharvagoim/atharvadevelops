// Chat storage.
// - MONGODB_URI set → MongoDB (use this in production)
// - otherwise       → data/conversations.json (handy on your laptop)
//
// A conversation = one visitor's chat with you:
//   { id, name, contact, tokenHash, messages: [{ id, from: "visitor" | "admin", text, createdAt }],
//     adminUnread, visitorUnread, createdAt, lastMessageAt }

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MAX_MESSAGES = 500;
const hashToken = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
const newToken = () => crypto.randomBytes(24).toString("hex");
const tokenMatches = (conv, token) => {
  if (!conv || !token) return false;
  const a = Buffer.from(conv.tokenHash, "hex");
  const b = Buffer.from(hashToken(token), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// what the admin list shows for each conversation
const summary = (c) => {
  const last = c.messages[c.messages.length - 1] || null;
  return {
    id: c.id,
    name: c.name,
    contact: c.contact,
    adminUnread: c.adminUnread,
    lastMessageAt: c.lastMessageAt,
    createdAt: c.createdAt,
    count: c.messages.length,
    last: last ? { from: last.from, text: last.text.slice(0, 160) } : null,
  };
};
// your contact details shown on the site (edited from the admin panel)
const SETTING_KEYS = ["phone", "whatsapp", "email", "instagram"];
const pickSettings = (d) => {
  const out = {};
  SETTING_KEYS.forEach((k) => {
    const v = d && typeof d[k] === "string" ? d[k] : undefined;
    out[k] = v !== undefined ? v : process.env[`CONTACT_${k.toUpperCase()}`] || "";
  });
  return out;
};

// the "Services we provide" images; until you change them in admin, the site shows these
const DEFAULT_WORKS = [
  { id: "default-1", src: "assets/work-portfolio.jpg", alt: "Portfolio website project", link: "" },
  { id: "default-2", src: "assets/work-tour.jpg", alt: "Music tour website project", link: "" },
  { id: "default-3", src: "assets/work-store.jpg", alt: "Bag e-commerce store project", link: "" },
  { id: "default-4", src: "assets/work-dance.jpg", alt: "Dance studio class tickets project", link: "" },
];
const cleanWorks = (list) => (Array.isArray(list) ? list : DEFAULT_WORKS).map((w) => ({
  id: w.id, src: w.src, alt: w.alt || "", link: w.link || "", mediaId: w.mediaId || null,
}));

const full = (c) => ({ ...summary(c), visitorUnread: c.visitorUnread, messages: c.messages });
const matchesQuery = (c, q) => {
  if (!q) return true;
  const n = q.toLowerCase();
  return (
    c.name.toLowerCase().includes(n) ||
    c.contact.toLowerCase().includes(n) ||
    c.messages.some((m) => m.text.toLowerCase().includes(n))
  );
};

/* ======================= MongoDB ======================= */
function mongoStore(uri) {
  const mongoose = require("mongoose");

  const messageSchema = new mongoose.Schema(
    {
      from: { type: String, enum: ["visitor", "admin"], required: true },
      text: { type: String, required: true, maxlength: 2000 },
      createdAt: { type: Date, default: Date.now },
    },
    { _id: true }
  );
  const convSchema = new mongoose.Schema({
    name: { type: String, required: true, maxlength: 60 },
    contact: { type: String, required: true, maxlength: 120 },
    tokenHash: { type: String, required: true },
    messages: [messageSchema],
    adminUnread: { type: Number, default: 0 },
    visitorUnread: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    lastMessageAt: { type: Date, default: Date.now, index: true },
  });
  const Conv = mongoose.models.Conversation || mongoose.model("Conversation", convSchema);
  const Settings = mongoose.models.Settings || mongoose.model("Settings", new mongoose.Schema({
    key: { type: String, default: "site", unique: true },
    phone: String, whatsapp: String, email: String, instagram: String,
    works: { type: mongoose.Schema.Types.Mixed, default: undefined },
  }));
  const Media = mongoose.models.Media || mongoose.model("Media", new mongoose.Schema({
    mime: String, size: Number, data: Buffer, createdAt: { type: Date, default: Date.now },
  }));

  const plain = (d) => ({
    id: String(d._id),
    name: d.name,
    contact: d.contact,
    tokenHash: d.tokenHash,
    adminUnread: d.adminUnread,
    visitorUnread: d.visitorUnread,
    createdAt: d.createdAt,
    lastMessageAt: d.lastMessageAt,
    messages: d.messages.map((m) => ({ id: String(m._id), from: m.from, text: m.text, createdAt: m.createdAt })),
  });
  const find = async (id) => {
    if (!mongoose.isValidObjectId(id)) return null;
    const d = await Conv.findById(id);
    return d && d.tokenHash && d.name ? d : null; // ignore records that aren't site chats
  };

  return {
    kind: "mongodb",
    async init() { await mongoose.connect(uri); },

    async create({ name, contact, text }) {
      const token = newToken();
      const d = await Conv.create({
        name, contact, tokenHash: hashToken(token),
        messages: [{ from: "visitor", text }],
        adminUnread: 1,
      });
      return { conversation: full(plain(d)), token };
    },

    async getForVisitor(id, token, { markRead = true } = {}) {
      const d = await find(id);
      if (!d || !tokenMatches(d, token)) return null;
      if (markRead && d.visitorUnread) { d.visitorUnread = 0; await d.save(); }
      return full(plain(d));
    },

    async addMessage(id, from, text, { token } = {}) {
      const d = await find(id);
      if (!d) return null;
      if (from === "visitor" && !tokenMatches(d, token)) return null;
      d.messages.push({ from, text });
      if (d.messages.length > MAX_MESSAGES) d.messages.splice(0, d.messages.length - MAX_MESSAGES);
      d.lastMessageAt = new Date();
      if (from === "visitor") d.adminUnread += 1; else d.visitorUnread += 1;
      if (from === "visitor" && d.visitorUnread) d.visitorUnread = 0;
      await d.save();
      const m = d.messages[d.messages.length - 1];
      return { id: String(m._id), from: m.from, text: m.text, createdAt: m.createdAt };
    },

    async list({ filter, q }) {
      // only real chats from the site: other apps' records in the same database are ignored
      const real = { tokenHash: { $type: "string" }, name: { $type: "string", $ne: "" }, "messages.0": { $exists: true } };
      const query = filter === "unread" ? { ...real, adminUnread: { $gt: 0 } } : real;
      const docs = await Conv.find(query).sort({ lastMessageAt: -1 }).limit(300);
      const items = docs.map(plain).filter((c) => matchesQuery(c, q)).map(summary);
      const agg = await Conv.aggregate([{ $match: real }, { $group: { _id: null, unread: { $sum: { $cond: [{ $gt: ["$adminUnread", 0] }, 1, 0] } }, total: { $sum: 1 } } }]);
      return { items, unread: agg[0] ? agg[0].unread : 0, total: agg[0] ? agg[0].total : 0 };
    },

    async getForAdmin(id, { markRead = true } = {}) {
      const d = await find(id);
      if (!d) return null;
      if (markRead && d.adminUnread) { d.adminUnread = 0; await d.save(); }
      return full(plain(d));
    },

    async setAdminUnread(id, unread) {
      const d = await find(id);
      if (!d) return null;
      d.adminUnread = unread ? Math.max(1, d.adminUnread) : 0;
      await d.save();
      return summary(plain(d));
    },

    async remove(id) {
      if (!mongoose.isValidObjectId(id)) return false;
      return !!(await Conv.findByIdAndDelete(id));
    },

    async getSettings() {
      const d = await Settings.findOne({ key: "site" }).lean();
      return pickSettings(d);
    },
    async saveSettings(values) {
      const d = await Settings.findOneAndUpdate({ key: "site" }, { ...values, key: "site" }, { upsert: true, new: true }).lean();
      return pickSettings(d);
    },

    async getWorks() {
      const d = await Settings.findOne({ key: "site" }, { works: 1 }).lean();
      return cleanWorks(d && d.works);
    },
    async saveWorks(list) {
      await Settings.findOneAndUpdate({ key: "site" }, { works: list, key: "site" }, { upsert: true });
      return cleanWorks(list);
    },
    async saveMedia(buf, mime) {
      const d = await Media.create({ mime, size: buf.length, data: buf });
      return String(d._id);
    },
    async getMedia(id) {
      if (!mongoose.isValidObjectId(id)) return null;
      const d = await Media.findById(id).lean();
      return d ? { mime: d.mime, data: d.data.buffer ? Buffer.from(d.data.buffer) : d.data } : null;
    },
    async deleteMedia(id) {
      if (mongoose.isValidObjectId(id)) await Media.findByIdAndDelete(id);
    },
  };
}

/* ======================= Local JSON file ======================= */
function fileStore(file) {
  const settingsFile = path.join(path.dirname(file), "settings.json");
  const mediaDir = path.join(path.dirname(file), "media");
  let settings = {};
  const writeSettings = async () => {
    const tmp = `${settingsFile}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(settings, null, 2));
    await fs.promises.rename(tmp, settingsFile);
  };
  let convs = [];
  let writing = Promise.resolve();
  const save = () => {
    writing = writing.then(async () => {
      const tmp = `${file}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(convs, null, 2));
      await fs.promises.rename(tmp, file);
    });
    return writing;
  };
  const byId = (id) => convs.find((c) => c.id === id);
  const now = () => new Date().toISOString();

  return {
    kind: "file",
    async init() {
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      try { convs = JSON.parse(await fs.promises.readFile(file, "utf8")); } catch { convs = []; }
      try { settings = JSON.parse(await fs.promises.readFile(settingsFile, "utf8")); } catch { settings = {}; }
    },

    async create({ name, contact, text }) {
      const token = newToken();
      const t = now();
      const c = {
        id: crypto.randomUUID(), name, contact, tokenHash: hashToken(token),
        messages: [{ id: crypto.randomUUID(), from: "visitor", text, createdAt: t }],
        adminUnread: 1, visitorUnread: 0, createdAt: t, lastMessageAt: t,
      };
      convs.push(c);
      await save();
      return { conversation: full(c), token };
    },

    async getForVisitor(id, token, { markRead = true } = {}) {
      const c = byId(id);
      if (!c || !tokenMatches(c, token)) return null;
      if (markRead && c.visitorUnread) { c.visitorUnread = 0; await save(); }
      return full(c);
    },

    async addMessage(id, from, text, { token } = {}) {
      const c = byId(id);
      if (!c) return null;
      if (from === "visitor" && !tokenMatches(c, token)) return null;
      const m = { id: crypto.randomUUID(), from, text, createdAt: now() };
      c.messages.push(m);
      if (c.messages.length > MAX_MESSAGES) c.messages.splice(0, c.messages.length - MAX_MESSAGES);
      c.lastMessageAt = m.createdAt;
      if (from === "visitor") { c.adminUnread += 1; c.visitorUnread = 0; } else c.visitorUnread += 1;
      await save();
      return m;
    },

    async list({ filter, q }) {
      const isReal = (c) => c && c.tokenHash && c.name && Array.isArray(c.messages) && c.messages.length;
      const sorted = convs.filter(isReal).sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
      const items = sorted
        .filter((c) => (filter === "unread" ? c.adminUnread > 0 : true))
        .filter((c) => matchesQuery(c, q))
        .slice(0, 300)
        .map(summary);
      return { items, unread: sorted.filter((c) => c.adminUnread > 0).length, total: sorted.length };
    },

    async getForAdmin(id, { markRead = true } = {}) {
      const c = byId(id);
      if (!c) return null;
      if (markRead && c.adminUnread) { c.adminUnread = 0; await save(); }
      return full(c);
    },

    async setAdminUnread(id, unread) {
      const c = byId(id);
      if (!c) return null;
      c.adminUnread = unread ? Math.max(1, c.adminUnread) : 0;
      await save();
      return summary(c);
    },

    async remove(id) {
      const before = convs.length;
      convs = convs.filter((c) => c.id !== id);
      if (convs.length === before) return false;
      await save();
      return true;
    },

    async getSettings() { return pickSettings(settings); },
    async saveSettings(values) {
      settings = { ...settings, ...values };
      await writeSettings();
      return pickSettings(settings);
    },

    async getWorks() { return cleanWorks(settings.works); },
    async saveWorks(list) {
      settings = { ...settings, works: list };
      await writeSettings();
      return cleanWorks(list);
    },
    async saveMedia(buf, mime) {
      const id = crypto.randomUUID();
      await fs.promises.mkdir(mediaDir, { recursive: true });
      await fs.promises.writeFile(path.join(mediaDir, id), buf);
      await fs.promises.writeFile(path.join(mediaDir, `${id}.type`), mime);
      return id;
    },
    async getMedia(id) {
      if (!/^[a-f0-9-]{36}$/.test(id)) return null;
      try {
        const data = await fs.promises.readFile(path.join(mediaDir, id));
        const mime = await fs.promises.readFile(path.join(mediaDir, `${id}.type`), "utf8");
        return { mime, data };
      } catch { return null; }
    },
    async deleteMedia(id) {
      if (!/^[a-f0-9-]{36}$/.test(id)) return;
      await fs.promises.rm(path.join(mediaDir, id), { force: true });
      await fs.promises.rm(path.join(mediaDir, `${id}.type`), { force: true });
    },
  };
}

module.exports = Object.assign(function createStore() {
  const uri = process.env.MONGODB_URI;
  return uri ? mongoStore(uri) : fileStore(path.join(__dirname, "..", "data", "conversations.json"));
}, { SETTING_KEYS, DEFAULT_WORKS });
