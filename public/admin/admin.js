(() => {
  const $ = (id) => document.getElementById(id);
  const loginView = $("login");
  const app = $("app");
  const panes = $("panes");
  const convsEl = $("convs");
  const msgsEl = $("msgs");
  const replyForm = $("reply");
  const replyInput = $("reply-input");
  const BASE_TITLE = "Admin";

  let filter = "all";
  let query = "";
  let items = [];               // conversation summaries
  let knownIds = null;          // to spot brand-new chats
  let lastSeenAt = {};          // id -> lastMessageAt, to spot new messages
  let openId = null;            // currently open conversation
  let openData = null;
  let seenMsg = new Set();
  let lastDay = "";
  let pollTimer = null;

  /* ---------------- API ---------------- */
  async function api(path, opts = {}) {
    const res = await fetch(path, { credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...opts });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !path.endsWith("/login")) { showLogin(); throw new Error("Please log in."); }
    if (!res.ok) { const e = new Error(data.error || "Something went wrong."); e.status = res.status; throw e; }
    return data;
  }

  /* ---------------- helpers ---------------- */
  const toast = (() => {
    let t;
    return (msg) => {
      const el = $("toast"); el.textContent = msg; el.classList.add("show");
      clearTimeout(t); t = setTimeout(() => el.classList.remove("show"), 2600);
    };
  })();
  const ago = (iso) => {
    const s = Math.max(1, Math.round((Date.now() - new Date(iso)) / 1000));
    if (s < 60) return "now";
    const m = Math.round(s / 60); if (m < 60) return `${m}m`;
    const h = Math.round(m / 60); if (h < 24) return `${h}h`;
    const d = Math.round(h / 24); if (d < 7) return `${d}d`;
    return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  };
  const clock = (d) => new Date(d).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const dayLabel = (d) => {
    const date = new Date(d), today = new Date(), y = new Date(); y.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return "Today";
    if (date.toDateString() === y.toDateString()) return "Yesterday";
    return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  };
  const initials = (name) => (name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  /* ---------------- views ---------------- */
  function showLogin() {
    clearInterval(pollTimer);
    app.hidden = true; loginView.hidden = false;
    document.title = "Admin";
    setTimeout(() => $("password").focus(), 50);
  }
  function showApp() {
    loginView.hidden = true; app.hidden = false;
    loadList().then(() => {
      const fromHash = location.hash.slice(1);
      if (fromHash && items.some((c) => c.id === fromHash)) openConv(fromHash);
    });
    clearInterval(pollTimer);
    pollTimer = setInterval(tick, 4000);
    setupNotifications();
    let v = "chats"; try { v = sessionStorage.getItem("admin_view") || "chats"; } catch {}
    showView(v);
    if (v !== "work") api("/api/admin/works").then((w) => { works = w; setWorkCount(); }).catch(() => {});
  }

  /* ---------------- conversation list ---------------- */
  function renderList() {
    convsEl.innerHTML = "";
    items.forEach((c, i) => {
      const li = el("li", "ci");
      li.dataset.id = c.id;
      li.classList.toggle("unread", c.adminUnread > 0);
      li.classList.toggle("active", c.id === openId);
      if (knownIds && !knownIds.has(c.id)) li.classList.add("is-new");
      else li.style.animationDelay = `${Math.min(i, 10) * 0.03}s`;

      const main = el("div", "ci-main");
      main.append(el("p", "ci-name", c.name), el("p", "ci-last", c.last ? `${c.last.from === "admin" ? "You: " : ""}${c.last.text}` : ""));
      const side = el("div", "ci-side");
      side.append(el("span", "ci-time", ago(c.lastMessageAt)));
      if (c.adminUnread > 0) side.append(el("span", "ci-count", String(c.adminUnread)));
      li.append(el("span", "avatar", initials(c.name)), main, side);
      li.addEventListener("click", () => openConv(c.id));
      convsEl.appendChild(li);
    });
    const empty = $("side-empty");
    empty.hidden = items.length > 0;
    empty.textContent = query ? "No chats match your search." : filter === "unread" ? "All caught up. No unread chats." : "No chats yet. Messages from your site will appear here.";
  }

  function updateStats(unread, total) {
    const today = new Date().toDateString();
    $("st-total").textContent = total || 0;
    $("st-unread").textContent = unread || 0;
    $("st-today").textContent = items.filter((c) => new Date(c.lastMessageAt).toDateString() === today).length;
    const h = new Date().getHours();
    $("pe-greeting").textContent = `${h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"}, Atharva`;
  }

  function updateCounts(unread, total) {
    updateStats(unread, total);
    const badge = $("unread-badge");
    if (String(unread) !== badge.textContent) { badge.classList.remove("bump"); void badge.offsetWidth; badge.classList.add("bump"); }
    badge.hidden = unread === 0;
    badge.textContent = unread;
    $("count-all").textContent = total || "";
    $("count-unread").textContent = unread || "";
    document.title = unread ? `(${unread}) ${BASE_TITLE}` : BASE_TITLE;
  }

  async function loadList({ quiet = false } = {}) {
    try {
      const params = new URLSearchParams({ filter });
      if (query) params.set("q", query);
      const data = await api(`/api/admin/conversations?${params}`);

      if (knownIds && quiet) {
        const fresh = data.items.filter((c) => c.last && c.last.from === "visitor" && lastSeenAt[c.id] !== c.lastMessageAt && c.id !== openId);
        if (fresh.length) {
          const n = fresh.find((c) => !knownIds.has(c.id)) ? "New chat" : "New message";
          toast(`${n} from ${fresh[0].name}`);
          notify(fresh[0]);
        }
      }
      items = data.items;
      renderList();
      knownIds = new Set([...(knownIds || []), ...items.map((c) => c.id)]);
      items.forEach((c) => { lastSeenAt[c.id] = c.lastMessageAt; });
      updateCounts(data.unread, data.total);
    } catch (err) { if (!quiet) toast(err.message); }
  }

  /* ---------------- open conversation ---------------- */
  function addBubble(m, { animate = false, pending = false } = {}) {
    const day = dayLabel(m.createdAt);
    if (day !== lastDay) { msgsEl.appendChild(el("div", "day", day)); lastDay = day; }
    const side = m.from === "admin" ? "me" : "them";
    const prev = msgsEl.lastElementChild;
    const row = el("div", `row ${side}`);
    if (prev && prev.classList.contains("row") && prev.classList.contains(side)) row.classList.add("cont");
    if (animate) row.classList.add("pop");
    if (pending) row.classList.add("pending");
    const stamp = el("time", "stamp", pending ? "sending…" : clock(m.createdAt));
    stamp.dateTime = m.createdAt;
    row.append(el("div", "bubble", m.text), stamp);
    msgsEl.appendChild(row);
    return row;
  }
  const toBottom = (smooth) => msgsEl.scrollTo({ top: msgsEl.scrollHeight, behavior: smooth ? "smooth" : "auto" });

  function renderReach(c) {
    const reach = $("reach");
    reach.innerHTML = "";
    const contact = (c.contact || "").trim();
    const add = (label, href, blank) => {
      const a = el("a", "mini", label); a.href = href;
      if (blank) { a.target = "_blank"; a.rel = "noopener"; }
      reach.appendChild(a);
    };
    if (EMAIL.test(contact)) {
      add("Email", `mailto:${contact}?subject=${encodeURIComponent("Re: your message")}`);
    } else {
      const digits = contact.replace(/\D/g, "");
      if (digits.length >= 7) { add("WhatsApp", `https://wa.me/${digits}`, true); add("Call", `tel:${contact.replace(/[^\d+]/g, "")}`); }
    }
  }

  async function openConv(id) {
    const switching = id !== openId;
    openId = id;
    if (location.hash.slice(1) !== id) history.replaceState(null, "", `#${id}`);
    panes.classList.add("viewing");
    document.querySelectorAll(".ci").forEach((li) => li.classList.toggle("active", li.dataset.id === id));
    if (switching) {
      msgsEl.innerHTML = ""; seenMsg = new Set(); lastDay = "";
      $("pane-empty").hidden = true; $("conv").hidden = false;
      $("conv").style.animation = "none"; void $("conv").offsetWidth; $("conv").style.animation = "";
    }
    try {
      const c = await api(`/api/admin/conversations/${encodeURIComponent(id)}`);
      if (openId !== id) return;
      openData = c;
      $("who-name").textContent = c.name;
      $("who-contact").textContent = c.contact;
      $("who-avatar").textContent = initials(c.name);
      const started = new Date(c.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
      const n = c.messages.length;
      $("who-meta").textContent = `Started ${started} · ${n} message${n === 1 ? "" : "s"}`;
      renderReach(c);
      let added = 0;
      c.messages.forEach((m) => { if (seenMsg.has(m.id)) return; seenMsg.add(m.id); addBubble(m, { animate: !switching }); added++; });
      if (added) toBottom(!switching);
      lastSeenAt[id] = c.lastMessageAt;
      // opening marks it read → refresh counts
      const item = items.find((x) => x.id === id);
      if (item && item.adminUnread) { item.adminUnread = 0; loadList({ quiet: true }); }
      if (switching) setTimeout(() => replyInput.focus(), 80);
    } catch (err) {
      if (err.status === 404) { toast("That chat no longer exists."); closeConv(); loadList(); }
      else toast(err.message);
    }
  }

  function closeConv() {
    openId = null; openData = null;
    history.replaceState(null, "", location.pathname);
    panes.classList.remove("viewing");
    $("conv").hidden = true; $("pane-empty").hidden = false;
    document.querySelectorAll(".ci").forEach((li) => li.classList.remove("active"));
  }

  /* ---------------- live updates ---------------- */
  async function tick() {
    if (document.hidden && !("Notification" in window && Notification.permission === "granted")) return;
    const before = openId ? lastSeenAt[openId] : null;
    await loadList({ quiet: true });
    if (openId) {
      const item = items.find((c) => c.id === openId);
      if (item && item.lastMessageAt !== before) openConv(openId);
    }
  }

  /* ---------------- reply ---------------- */
  const autosize = () => { replyInput.style.height = "auto"; replyInput.style.height = `${Math.min(replyInput.scrollHeight, 200)}px`; };
  replyInput.addEventListener("input", autosize);
  replyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); replyForm.requestSubmit(); }
  });
  replyForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = replyInput.value.trim();
    if (!text || !openId) return;
    const id = openId;
    replyInput.value = ""; autosize();
    replyForm.classList.remove("sent"); void replyForm.offsetWidth; replyForm.classList.add("sent");
    const row = addBubble({ from: "admin", text, createdAt: new Date().toISOString() }, { animate: true, pending: true });
    toBottom(true);
    try {
      const m = await api(`/api/admin/conversations/${encodeURIComponent(id)}/messages`, { method: "POST", body: JSON.stringify({ text }) });
      seenMsg.add(m.id);
      row.classList.remove("pending");
      row.querySelector(".stamp").textContent = clock(m.createdAt);
      lastSeenAt[id] = m.createdAt;
      loadList({ quiet: true });
    } catch (err) {
      row.classList.remove("pending"); row.classList.add("failed");
      row.querySelector(".stamp").textContent = `not sent · ${err.message}`;
      replyInput.value = text; autosize();
    }
  });

  /* ---------------- quick replies (saved in this browser) ---------------- */
  const QR_KEY = "atharva_quick_replies";
  const QR_DEFAULT = [
    "Hey! Thanks for reaching out 🙂",
    "Could you share a few more details about what you need?",
    "Do you have a budget and a timeline in mind?",
    "Can we hop on a quick call? Share a time that works for you.",
    "I'll send you a quote shortly.",
  ];
  const loadQR = () => { try { const v = JSON.parse(localStorage.getItem(QR_KEY)); return Array.isArray(v) ? v : QR_DEFAULT.slice(); } catch { return QR_DEFAULT.slice(); } };
  const saveQR = (list) => { try { localStorage.setItem(QR_KEY, JSON.stringify(list)); } catch {} };
  let quick = loadQR();
  function renderQuick() {
    const box = $("quick");
    box.innerHTML = "";
    quick.forEach((text, i) => {
      const chip = el("button", "qr"); chip.type = "button"; chip.title = text;
      const label = el("span", "", text);
      const x = el("i", "qx", "×"); x.title = "Remove";
      chip.append(label, x);
      chip.addEventListener("click", (e) => {
        if (e.target === x) { quick.splice(i, 1); saveQR(quick); renderQuick(); toast("Quick reply removed"); return; }
        const cur = replyInput.value.trim();
        replyInput.value = cur ? `${cur} ${text}` : text;
        autosize(); replyInput.focus();
      });
      box.appendChild(chip);
    });
    const add = el("button", "qr add", "+ Save as quick reply"); add.type = "button";
    add.addEventListener("click", () => {
      const t = replyInput.value.trim();
      if (!t) { toast("Type a reply first, then tap + to save it"); replyInput.focus(); return; }
      if (quick.includes(t)) { toast("Already saved"); return; }
      quick.push(t.slice(0, 300)); saveQR(quick); renderQuick(); toast("Saved as a quick reply");
    });
    box.appendChild(add);
  }
  renderQuick();

  // copy the visitor's email / phone
  $("copy-contact").addEventListener("click", async () => {
    const btn = $("copy-contact");
    try { await navigator.clipboard.writeText($("who-contact").textContent); } catch { return toast("Couldn't copy"); }
    btn.textContent = "Copied"; btn.classList.add("done");
    setTimeout(() => { btn.textContent = "Copy"; btn.classList.remove("done"); }, 1500);
  });

  // keyboard: "/" search, Esc close chat
  document.addEventListener("keydown", (e) => {
    if (app.hidden) return;
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName);
    if (e.key === "/" && !typing) { e.preventDefault(); showView("chats"); $("search").focus(); }
    if (e.key === "Escape" && openId) { if (typing) document.activeElement.blur(); closeConv(); }
  });

  /* ---------------- conversation actions ---------------- */
  $("back-btn").addEventListener("click", closeConv);
  $("unread-btn").addEventListener("click", async () => {
    if (!openId) return;
    try {
      await api(`/api/admin/conversations/${encodeURIComponent(openId)}`, { method: "PATCH", body: JSON.stringify({ unread: true }) });
      toast("Marked as unread");
      closeConv();
      loadList();
    } catch (err) { toast(err.message); }
  });
  const delBtn = $("delete-btn");
  delBtn.addEventListener("click", async () => {
    if (!openId) return;
    if (!delBtn.classList.contains("confirm")) {
      delBtn.classList.add("confirm"); delBtn.textContent = "Delete chat?";
      setTimeout(() => { delBtn.classList.remove("confirm"); delBtn.textContent = "Delete"; }, 3000);
      return;
    }
    delBtn.classList.remove("confirm"); delBtn.textContent = "Delete";
    try {
      await api(`/api/admin/conversations/${encodeURIComponent(openId)}`, { method: "DELETE" });
      toast("Chat deleted");
      closeConv();
      loadList();
    } catch (err) { toast(err.message); }
  });

  /* ---------------- filters ---------------- */
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => { t.classList.remove("is-active"); t.setAttribute("aria-selected", "false"); });
      tab.classList.add("is-active"); tab.setAttribute("aria-selected", "true");
      filter = tab.dataset.filter;
      loadList();
    });
  });
  let searchTimer;
  $("search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { query = e.target.value.trim(); loadList(); }, 250);
  });


  /* ---------------- views: Chats / Settings ---------------- */
  const settingsView = $("settings");
  const setForm = $("settings-form");
  const KEYS = ["phone", "whatsapp", "email", "instagram"];
  let saved = null; // last saved values

  function showView(view) {
    document.querySelectorAll(".view-tab").forEach((t) => {
      const on = t.dataset.view === view;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    panes.hidden = view !== "chats";
    settingsView.hidden = view !== "settings";
    workView.hidden = view !== "work";
    if (view === "settings") loadSettings();
    if (view === "work") loadWorks();
    try { sessionStorage.setItem("admin_view", view); } catch {}
  }
  document.querySelectorAll(".view-tab").forEach((t) => t.addEventListener("click", () => showView(t.dataset.view)));

  const testHref = {
    phone: (v) => `tel:${v.replace(/[^\d+]/g, "")}`,
    whatsapp: (v) => `https://wa.me/${v.replace(/\D/g, "")}`,
    email: (v) => `mailto:${v}`,
    instagram: (v) => `https://instagram.com/${v.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/[/?].*$/, "")}`,
  };
  const values = () => Object.fromEntries(KEYS.map((k) => [k, setForm.elements[k].value.trim()]));
  const isDirty = () => saved && KEYS.some((k) => (saved[k] || "") !== setForm.elements[k].value.trim());

  function refreshSettingsUI() {
    KEYS.forEach((k) => {
      const v = setForm.elements[k].value.trim();
      const a = setForm.querySelector(`[data-k="${k}"] .sf-test`);
      a.hidden = !v;
      if (v) a.href = testHref[k](v);
    });
    const dirty = isDirty();
    $("set-save").disabled = !dirty;
    $("set-reset").disabled = !dirty;
    const st = $("set-status");
    if (dirty) { st.textContent = "Unsaved changes"; st.className = "set-status dirty"; }
    else if (st.classList.contains("dirty")) { st.textContent = ""; st.className = "set-status"; }
  }
  const fieldError = (k, msg) => {
    const box = setForm.querySelector(`[data-k="${k}"]`);
    box.classList.toggle("has-error", !!msg);
    box.querySelector(".sf-err").textContent = msg || "";
  };
  function fill(v) {
    saved = { ...v };
    KEYS.forEach((k) => { setForm.elements[k].value = v[k] || ""; fieldError(k, ""); });
    refreshSettingsUI();
  }
  async function loadSettings() {
    if (isDirty()) return; // don't wipe unsaved typing
    try { fill(await api("/api/admin/settings")); } catch (err) { toast(err.message); }
  }
  KEYS.forEach((k) => setForm.elements[k].addEventListener("input", () => { fieldError(k, ""); refreshSettingsUI(); }));
  $("set-reset").addEventListener("click", () => { fill(saved); });
  setForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!isDirty()) return;
    $("set-save").disabled = true;
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values()),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { showLogin(); return; }
      if (!res.ok) {
        Object.entries(data.fields || {}).forEach(([k, m]) => fieldError(k, m));
        toast(data.error || "Could not save");
        refreshSettingsUI();
        return;
      }
      fill(data);
      const st = $("set-status"); st.textContent = "Saved. Live on your site."; st.className = "set-status ok";
      toast("Contact details saved");
    } catch (err) { toast(err.message); refreshSettingsUI(); }
  });
  window.addEventListener("beforeunload", (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ""; } });


  /* ---------------- Work images ---------------- */
  const workView = $("work");
  const wlist = $("wlist");
  let works = [];

  const setWorkCount = () => { $("work-count").textContent = works.length || ""; };
  async function loadWorks() {
    try { works = await api("/api/admin/works"); renderWorks(); } catch (err) { toast(err.message); }
  }

  const ICON_GRIP = '<svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.6" fill="currentColor"/><circle cx="15" cy="6" r="1.6" fill="currentColor"/><circle cx="9" cy="12" r="1.6" fill="currentColor"/><circle cx="15" cy="12" r="1.6" fill="currentColor"/><circle cx="9" cy="18" r="1.6" fill="currentColor"/><circle cx="15" cy="18" r="1.6" fill="currentColor"/></svg>';

  function renderWorks() {
    wlist.innerHTML = "";
    works.forEach((w, i) => {
      const li = el("li", "wi");
      li.dataset.id = w.id;
      li.style.animationDelay = `${Math.min(i, 10) * 0.03}s`;

      const grip = el("span", "grip"); grip.innerHTML = ICON_GRIP; grip.title = "Drag to reorder";
      const thumb = el("a", "wthumb"); thumb.href = w.src; thumb.target = "_blank"; thumb.rel = "noopener";
      const img = el("img"); img.src = w.src; img.alt = ""; img.loading = "lazy"; thumb.appendChild(img);

      const fields = el("div", "wfields");
      const alt = el("input"); alt.placeholder = "Caption, e.g. Bakery e-commerce store"; alt.value = w.alt; alt.maxLength = 120; alt.setAttribute("aria-label", "Caption");
      const link = el("input"); link.placeholder = "Link to live project (optional)"; link.value = w.link; link.type = "url"; link.inputMode = "url"; link.setAttribute("aria-label", "Project link");
      fields.append(alt, link, el("span", "wpos", `Position ${i + 1} of ${works.length}`));

      const tools = el("div", "wtools");
      const up = el("button", "mini move", "↑"); up.title = "Move up"; up.disabled = i === 0;
      const down = el("button", "mini move", "↓"); down.title = "Move down"; down.disabled = i === works.length - 1;
      const del = el("button", "mini danger", "Remove");
      tools.append(up, down, del);

      li.append(grip, thumb, fields, tools);
      wlist.appendChild(li);

      // save caption / link when you leave the field
      const saveField = async (key, input) => {
        const v = input.value.trim();
        if (v === (w[key] || "")) return;
        try {
          works = await api(`/api/admin/works/${encodeURIComponent(w.id)}`, { method: "PATCH", body: JSON.stringify({ [key]: v }) });
          input.classList.remove("bad");
          const fresh = works.find((x) => x.id === w.id); if (fresh) { w.alt = fresh.alt; w.link = fresh.link; input.value = fresh[key]; }
          toast(key === "alt" ? "Caption saved" : "Link saved");
        } catch (err) { input.classList.add("bad"); toast(err.message); }
      };
      alt.addEventListener("change", () => saveField("alt", alt));
      link.addEventListener("change", () => saveField("link", link));
      [alt, link].forEach((inp) => inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); }));

      up.addEventListener("click", () => moveWork(i, i - 1));
      down.addEventListener("click", () => moveWork(i, i + 1));
      del.addEventListener("click", async () => {
        if (!del.classList.contains("confirm")) {
          del.classList.add("confirm"); del.textContent = "Remove?";
          setTimeout(() => { del.classList.remove("confirm"); del.textContent = "Remove"; }, 3000);
          return;
        }
        try {
          li.style.opacity = ".3";
          works = await api(`/api/admin/works/${encodeURIComponent(w.id)}`, { method: "DELETE" });
          renderWorks(); toast("Image removed");
        } catch (err) { li.style.opacity = ""; toast(err.message); }
      });

      // drag to reorder (desktop, using the grip)
      grip.addEventListener("pointerdown", (e) => startDrag(e, li));
    });
    $("wempty").hidden = works.length > 0;
    setWorkCount();
  }

  async function saveOrder(ids) {
    try { works = await api("/api/admin/works/order", { method: "PUT", body: JSON.stringify({ ids }) }); toast("Order saved"); }
    catch (err) { toast(err.message); await loadWorks(); return; }
    renderWorks();
  }
  function moveWork(from, to) {
    if (to < 0 || to >= works.length) return;
    const ids = works.map((w) => w.id);
    const [m] = ids.splice(from, 1); ids.splice(to, 0, m);
    works = ids.map((id) => works.find((w) => w.id === id));
    renderWorks();
    saveOrder(ids);
  }

  function startDrag(e, li) {
    e.preventDefault();
    li.classList.add("dragging");
    let target = null, after = false;
    let lastY = e.clientY, scroller = null;
    // scroll the list while dragging near the top / bottom edge
    const tickScroll = () => {
      const r = workView.getBoundingClientRect();
      const edge = 80;
      if (lastY < r.top + edge) workView.scrollTop -= Math.ceil((r.top + edge - lastY) / 6);
      else if (lastY > r.bottom - edge) workView.scrollTop += Math.ceil((lastY - (r.bottom - edge)) / 6);
      scroller = requestAnimationFrame(tickScroll);
    };
    scroller = requestAnimationFrame(tickScroll);
    const onMove = (ev) => {
      lastY = ev.clientY;
      wlist.querySelectorAll(".wi").forEach((x) => x.classList.remove("drop-before", "drop-after"));
      const over = document.elementFromPoint(ev.clientX, ev.clientY);
      const item = over && over.closest(".wi");
      if (!item || item === li) { target = null; return; }
      const r = item.getBoundingClientRect();
      after = ev.clientY > r.top + r.height / 2;
      item.classList.add(after ? "drop-after" : "drop-before");
      target = item;
    };
    const onUp = () => {
      cancelAnimationFrame(scroller);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      li.classList.remove("dragging");
      wlist.querySelectorAll(".wi").forEach((x) => x.classList.remove("drop-before", "drop-after"));
      if (!target) return;
      const ids = works.map((w) => w.id).filter((id) => id !== li.dataset.id);
      let idx = ids.indexOf(target.dataset.id) + (after ? 1 : 0);
      ids.splice(idx, 0, li.dataset.id);
      works = ids.map((id) => works.find((w) => w.id === id));
      renderWorks();
      saveOrder(ids);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // shrink big photos in the browser before uploading (max 1600px tall, ~85% quality)
  async function prepareImage(file) {
    if (file.type === "image/gif") return file; // keep animations
    const bmp = await createImageBitmap(file);
    const MAX_H = 1600, MAX_W = 1600;
    const scale = Math.min(1, MAX_H / bmp.height, MAX_W / bmp.width);
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, "image/webp", 0.86));
    if (blob && blob.type === "image/webp") return blob;
    return new Promise((r) => c.toBlob(r, "image/jpeg", 0.86));
  }

  function uploadOne(file) {
    const row = el("div", "up");
    const name = el("span", "", file.name.length > 28 ? file.name.slice(0, 25) + "…" : file.name);
    const bar = el("span", "up-bar"); const fillBar = el("i"); bar.appendChild(fillBar);
    row.append(name, bar);
    $("uploads").appendChild(row);
    return new Promise(async (resolve) => {
      try {
        if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error("not a JPG, PNG, WebP or GIF");
        const blob = await prepareImage(file);
        const caption = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, 120);
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/admin/works");
        xhr.setRequestHeader("Content-Type", blob.type);
        xhr.setRequestHeader("X-Alt", encodeURIComponent(caption));
        xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) fillBar.style.width = `${(ev.loaded / ev.total) * 100}%`; };
        xhr.onload = () => {
          let data = {}; try { data = JSON.parse(xhr.responseText); } catch {}
          if (xhr.status === 401) { showLogin(); return resolve(); }
          if (xhr.status >= 200 && xhr.status < 300) { works = data; renderWorks(); row.remove(); }
          else { row.classList.add("err"); name.textContent = `${file.name}: ${data.error || "upload failed"}`; setTimeout(() => row.remove(), 6000); }
          resolve();
        };
        xhr.onerror = () => { row.classList.add("err"); name.textContent = `${file.name}: network error`; resolve(); };
        xhr.send(blob);
      } catch (err) {
        row.classList.add("err"); name.textContent = `${file.name}: ${err.message}`;
        setTimeout(() => row.remove(), 6000); resolve();
      }
    });
  }
  async function uploadFiles(list) {
    const files = [...list].slice(0, 24);
    for (const f of files) await uploadOne(f); // one at a time keeps the order you picked
    if (files.length) toast(files.length === 1 ? "Image added" : `${files.length} images added`);
  }

  $("work-file").addEventListener("change", (e) => { uploadFiles(e.target.files); e.target.value = ""; });
  const drop = $("drop");
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, () => drop.classList.remove("over")));
  drop.addEventListener("drop", (e) => { e.preventDefault(); uploadFiles(e.dataTransfer.files); });

  const resetBtn = $("works-reset");
  resetBtn.addEventListener("click", async () => {
    if (!resetBtn.classList.contains("confirm")) {
      resetBtn.classList.add("confirm"); resetBtn.textContent = "Replace all with the original 4?";
      setTimeout(() => { resetBtn.classList.remove("confirm"); resetBtn.textContent = "Restore originals"; }, 3500);
      return;
    }
    resetBtn.classList.remove("confirm"); resetBtn.textContent = "Restore originals";
    try { works = await api("/api/admin/works/reset", { method: "POST" }); renderWorks(); toast("Original images restored"); }
    catch (err) { toast(err.message); }
  });

  /* ---------------- browser notifications ---------------- */
  function setupNotifications() {
    const btn = $("notify-btn");
    if (!("Notification" in window) || Notification.permission !== "default") { btn.hidden = true; return; }
    btn.hidden = false;
    btn.onclick = async () => {
      const p = await Notification.requestPermission();
      btn.hidden = true;
      toast(p === "granted" ? "Alerts on" : "Alerts stay off");
    };
  }
  function notify(c) {
    if (!("Notification" in window) || Notification.permission !== "granted" || !document.hidden) return;
    const n = new Notification(`Message from ${c.name}`, { body: c.last ? c.last.text : "" });
    n.onclick = () => { window.focus(); openConv(c.id); n.close(); };
  }

  /* ---------------- login / logout ---------------- */
  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = $("password");
    $("login-error").textContent = "";
    try {
      await api("/api/admin/login", { method: "POST", body: JSON.stringify({ password: pw.value }) });
      pw.value = "";
      showApp();
    } catch (err) {
      $("login-error").textContent = err.message;
      const f = $("login-form"); f.classList.remove("shake"); void f.offsetWidth; f.classList.add("shake");
      pw.select();
    }
  });
  $("logout-btn").addEventListener("click", async () => {
    await api("/api/admin/logout", { method: "POST" }).catch(() => {});
    knownIds = null; items = []; closeConv();
    showLogin();
  });

  document.addEventListener("visibilitychange", () => { if (!document.hidden && !app.hidden) tick(); });
  setInterval(() => document.querySelectorAll(".ci-time").forEach((t, i) => { if (items[i]) t.textContent = ago(items[i].lastMessageAt); }), 60000);

  /* ---------------- start ---------------- */
  api("/api/admin/me").then(showApp).catch(showLogin);
})();
