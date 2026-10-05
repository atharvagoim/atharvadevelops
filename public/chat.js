(() => {
  const { Store, api, openPopup } = window.SiteChat;
  const thread = document.getElementById("thread");
  const empty = document.getElementById("chat-empty");
  const form = document.getElementById("composer");
  const input = document.getElementById("composer-input");
  const newBtn = document.getElementById("chat-new");
  const sub = document.getElementById("chat-sub");
  const BASE_TITLE = document.title;

  let conv = null;
  const seen = new Set();
  let pollTimer = null;
  let lastDay = "";

  // a chat link like chat.html#c=<id>.<token> (used when the browser can't save the chat)
  const fromHash = () => {
    const m = location.hash.match(/c=([^.]+)\.([a-f0-9]+)/i);
    return m ? { id: m[1], token: m[2], name: "", contact: "" } : null;
  };

  /* ---------------- render ---------------- */
  const dayLabel = (d) => {
    const date = new Date(d);
    const today = new Date();
    const y = new Date(); y.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return "Today";
    if (date.toDateString() === y.toDateString()) return "Yesterday";
    return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  };
  const clock = (d) => new Date(d).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  function bubble(m, { animate = false, pending = false } = {}) {
    const day = dayLabel(m.createdAt);
    if (day !== lastDay) {
      const sep = document.createElement("div");
      sep.className = "day";
      sep.textContent = day;
      thread.appendChild(sep);
      lastDay = day;
    }
    const prev = thread.lastElementChild;
    const row = document.createElement("div");
    row.className = `msg-row ${m.from === "admin" ? "them" : "me"}`;
    if (prev && prev.classList.contains("msg-row") && prev.classList.contains(m.from === "admin" ? "them" : "me")) row.classList.add("cont");
    if (animate) row.classList.add("pop");
    if (pending) row.classList.add("pending");
    if (m.id) row.dataset.id = m.id;

    if (m.from === "admin" && !row.classList.contains("cont")) {
      const who = document.createElement("span");
      who.className = "who";
      who.textContent = "Atharva";
      row.appendChild(who);
    }
    const b = document.createElement("div");
    b.className = "bubble";
    b.textContent = m.text;
    const t = document.createElement("time");
    t.className = "stamp";
    t.dateTime = m.createdAt;
    t.textContent = pending ? "sending…" : clock(m.createdAt);
    row.append(b, t);
    thread.appendChild(row);
    return row;
  }

  const scrollDown = (smooth = true) =>
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: smooth ? "smooth" : "auto" });

  function showEmpty(on) {
    empty.hidden = !on;
    newBtn.hidden = on;
  }

  /* ---------------- load + live updates ---------------- */
  async function load({ first = false } = {}) {
    if (!conv) return;
    try {
      const data = await api(`/api/chat/${encodeURIComponent(conv.id)}`, { token: conv.token });
      let added = 0;
      data.messages.forEach((m) => {
        if (seen.has(m.id)) return;
        seen.add(m.id);
        bubble(m, { animate: !first });
        added++;
      });
      showEmpty(seen.size === 0);
      if (data.name && sub) sub.textContent = `Chatting as ${data.name}. I usually reply within a few hours; this chat is saved on this device.`;
      if (added) scrollDown(!first);
      if (added && !first && document.hidden) document.title = `New reply · ${BASE_TITLE}`;
    } catch (err) {
      if (err.status === 404) { // chat was closed / deleted
        Store.clear(); conv = null; seen.clear(); thread.innerHTML = ""; lastDay = "";
        showEmpty(true);
        sub.textContent = "This chat has ended. Send a new message to start again.";
      }
    }
  }

  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => { if (!document.hidden) load(); }, 4000);
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { document.title = BASE_TITLE; load(); }
  });

  /* ---------------- sending ---------------- */
  const autosize = () => { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 220)}px`; };
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) {
      form.animate([{ translate: "0" }, { translate: "-8px" }, { translate: "8px" }, { translate: "0" }], { duration: 320 });
      input.focus();
      return;
    }
    // first message → the popup (name + contact) is required
    if (!conv) { openPopup(text); return; }

    input.value = ""; autosize();
    form.classList.remove("sent"); void form.offsetWidth; form.classList.add("sent");
    const temp = bubble({ from: "visitor", text, createdAt: new Date().toISOString() }, { animate: true, pending: true });
    showEmpty(false);
    scrollDown();
    try {
      const m = await api(`/api/chat/${encodeURIComponent(conv.id)}/messages`, { method: "POST", token: conv.token, body: { text } });
      seen.add(m.id);
      temp.dataset.id = m.id;
      temp.classList.remove("pending");
      temp.querySelector(".stamp").textContent = clock(m.createdAt);
    } catch (err) {
      temp.classList.remove("pending");
      temp.classList.add("failed");
      const stamp = temp.querySelector(".stamp");
      stamp.textContent = `not sent · ${err.message} · tap to retry`;
      temp.addEventListener("click", () => { temp.remove(); input.value = text; autosize(); input.focus(); }, { once: true });
    }
  });

  // after the popup sends the first message
  document.addEventListener("chat:sent", (e) => {
    conv = e.detail;
    input.value = ""; autosize();
    load().then(startPolling);
  });

  /* ---------------- new chat ---------------- */
  newBtn.addEventListener("click", () => {
    if (!newBtn.classList.contains("confirm")) {
      newBtn.classList.add("confirm");
      newBtn.textContent = "Start over?";
      setTimeout(() => { newBtn.classList.remove("confirm"); newBtn.textContent = "New chat"; }, 3000);
      return;
    }
    Store.clear();
    conv = null; seen.clear(); thread.innerHTML = ""; lastDay = "";
    clearInterval(pollTimer);
    newBtn.classList.remove("confirm"); newBtn.textContent = "New chat";
    sub.textContent = "I usually reply within a few hours. Your chat is saved on this device.";
    showEmpty(true);
    input.focus();
  });

  /* ---------------- start ---------------- */
  conv = Store.get() || fromHash();
  if (conv) {
    if (fromHash() && !Store.get()) Store.set(conv);
    load({ first: true }).then(startPolling);
  } else {
    showEmpty(true);
  }
  setTimeout(() => input.focus(), 400);
})();
