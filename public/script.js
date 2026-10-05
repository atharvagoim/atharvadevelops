/* ====== EDIT YOUR CONTACT DETAILS HERE ====== */
const CONTACT = {
  phone: "+910000000000",          // used by the Call button
  whatsapp: "910000000000",        // country code + number, no "+" or spaces
  email: "you@example.com",        // used by the Mail button
  instagram: "your_instagram",     // handle without "@"
};

// Where the chat talks to. Leave "" when the server hosts this site.
// If the site is hosted elsewhere (e.g. Vercel), put the server URL here: "https://your-app.onrender.com"
const API_BASE = "";
/* =========================================== */

(() => {
  const $ = (sel) => document.querySelector(sel);
  const root = document.documentElement;
  const isMobile = () => window.matchMedia("(max-width: 900px)").matches;

  /* =================== Layout =================== */

  // Scale every 1920px Figma frame to the window width
  const fit = () => root.style.setProperty("--s", isMobile() ? 1 : window.innerWidth / 1920);

  // Keep the message/contact block right under the services list
  const services = $("#services-list");
  const lower = $("#lower");
  const servicesFrame = $("#services");
  const layoutServices = () => {
    if (!services || !lower) return;
    if (isMobile()) { lower.style.top = ""; return; }
    const top = Math.round(services.offsetTop + services.offsetHeight + 100);
    lower.style.top = `${top}px`;
    servicesFrame.style.setProperty("--h", top + lower.offsetHeight);
  };
  const aboutFrame = $("#about");
  const layoutAbout = () => {
    const el = $(".intro");
    if (!aboutFrame || !el || isMobile()) return;
    aboutFrame.style.setProperty("--h", Math.max(1080, Math.ceil(el.offsetTop + el.offsetHeight + 90)));
  };
  const contactFrame = $("#contact");
  const layoutContact = () => {
    const wrap = $("#contact-wrap");
    if (!contactFrame || !wrap || isMobile()) return;
    contactFrame.style.setProperty("--h", Math.max(1080, Math.ceil(wrap.offsetTop + wrap.offsetHeight + 60)));
  };
  const extrasFrame = $("#extras");
  const layoutExtras = () => {
    const wrap = $("#ex-wrap");
    if (!extrasFrame || !wrap || isMobile()) return;
    extrasFrame.style.setProperty("--h", Math.max(1080, Math.ceil(wrap.offsetTop + wrap.offsetHeight + 90)));
  };
  const relayout = () => { fit(); layoutServices(); layoutAbout(); layoutContact(); layoutExtras(); };
  relayout();
  window.addEventListener("resize", relayout);
  document.fonts && document.fonts.ready.then(relayout);
  if (services && "ResizeObserver" in window) new ResizeObserver(layoutServices).observe(services);
  if ($("#ex-wrap") && "ResizeObserver" in window) new ResizeObserver(layoutExtras).observe($("#ex-wrap"));
  if ($("#contact-wrap") && "ResizeObserver" in window) new ResizeObserver(layoutContact).observe($("#contact-wrap"));

  /* =================== Services dropdowns =================== */
  document.querySelectorAll(".svc-head").forEach((head) => {
    head.addEventListener("click", () => {
      // each title opens / closes its own description
      const item = head.closest(".svc");
      const open = item.classList.toggle("is-open");
      head.setAttribute("aria-expanded", open ? "true" : "false");
    });
  });

  /* =================== Animations =================== */
  const splitWords = (el, start, step) => {
    if (!el) return;
    let i = 0;
    const wrap = (node) => {
      node.innerHTML = node.textContent.trim().split(/\s+/)
        .map((w) => `<span class="w" style="animation-delay:${(start + i++ * step).toFixed(3)}s">${w}</span>`)
        .join(" ");
    };
    const lines = el.querySelectorAll(".line");
    lines.length ? lines.forEach(wrap) : wrap(el);
  };
  splitWords($(".headline"), 1.2, 0.045);
  splitWords($(".ct-title"), 0.35, 0.07);
  // About text: words float in, paragraph by paragraph (quick even for long text)
  const intro = $(".intro");
  if (intro) {
    const paras = [...intro.querySelectorAll("p")];
    const total = paras.reduce((n, p) => n + p.textContent.trim().split(/\s+/).length, 0);
    const step = Math.min(0.035, 1.8 / Math.max(total, 1));
    let i = 0;
    const escHtml = (t) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    paras.forEach((p) => {
      // keep <strong> keywords bold while splitting into animated words
      const out = [];
      p.childNodes.forEach((n) => {
        const bold = n.nodeType === 1 && n.tagName === "STRONG";
        n.textContent.split(/(\s+)/).forEach((tok) => {
          if (!tok) return;
          if (/^\s+$/.test(tok)) { out.push(" "); return; }
          out.push(`<span class="w${bold ? " b" : ""}" style="animation-delay:${(0.8 + i++ * step).toFixed(3)}s">${escHtml(tok)}</span>`);
        });
      });
      p.innerHTML = out.join("").replace(/ {2,}/g, " ").trim();
    });
    intro.querySelectorAll(".about-contacts .c-btn").forEach((b, k) => { b.style.transitionDelay = `${(0.9 + total * step + k * 0.08).toFixed(2)}s`; });
  }

  const frameObs = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in-view"); frameObs.unobserve(e.target); } });
  }, { threshold: 0.2 });
  document.querySelectorAll(".frame").forEach((f) => frameObs.observe(f));

  const revealObs = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const group = [...e.target.parentElement.children].filter((c) => c.classList.contains("reveal"));
      e.target.style.transitionDelay = `${Math.max(0, group.indexOf(e.target)) * 0.09}s`;
      e.target.classList.add("shown");
      revealObs.unobserve(e.target);
    });
  }, { threshold: 0.15 });
  document.querySelectorAll(".reveal").forEach((el) => revealObs.observe(el));

  /* =================== Work showcase + tagline =================== */
  const tagline = $(".tagline");
  if (tagline) {
    let n = 0;
    tagline.querySelectorAll(".tl-1").forEach((line) => {
      line.innerHTML = line.textContent.trim().split(/\s+/)
        .map((w) => `<span class="w" style="transition-delay:${(n++ * 0.07).toFixed(2)}s">${w}</span>`).join(" ");
    });
  }
  const showObs = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("shown"); showObs.unobserve(e.target); } });
  }, { threshold: 0.25 });
  [$(".works"), tagline].forEach((el) => el && showObs.observe(el));

  // 3D tilt that follows the cursor on each project image
  function bindTilt(card) {
    const inner = card.querySelector(".work-in");
    card.addEventListener("mousemove", (e) => {
      if (isMobile() || worksEl.classList.contains("dragging")) return;
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      inner.style.animationPlayState = "paused";
      inner.style.transform = `translateY(-14px) scale(1.04) rotateY(${x * 14}deg) rotateX(${y * -12}deg)`;
    });
    card.addEventListener("mouseleave", () => {
      inner.style.transform = "";
      inner.style.animationPlayState = "";
    });
  }
  const worksEl = $(".works");
  document.querySelectorAll(".work").forEach(bindTilt);

  // Images come from the admin panel (Admin → Work). The four in the HTML are the fallback.
  const esc = (t) => String(t || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function renderWorks(list) {
    if (!worksEl || !Array.isArray(list)) return;
    const wasShown = worksEl.classList.contains("shown");
    worksEl.innerHTML = list.map((w, i) => {
      const img = `<img src="${esc(w.src.startsWith("/") ? API_BASE + w.src : w.src)}" alt="${esc(w.alt)}" loading="${i < 4 ? "eager" : "lazy"}" draggable="false">`;
      const body = w.link ? `<a href="${esc(w.link)}" target="_blank" rel="noopener" title="${esc(w.alt || "Open project")}">${img}</a>` : img;
      return `<figure class="work" style="--i:${Math.min(i, 8)}"><div class="work-in">${body}</div></figure>`;
    }).join("");
    worksEl.querySelectorAll(".work").forEach(bindTilt);
    worksEl.hidden = list.length === 0;
    if (wasShown) { worksEl.classList.remove("shown"); void worksEl.offsetWidth; requestAnimationFrame(() => worksEl.classList.add("shown")); }
    worksEl.querySelectorAll("img").forEach((im) => im.addEventListener("load", updateArrows, { once: true }));
    updateArrows();
  }

  // arrows + drag to scroll when there are more images than fit
  const prevBtn = $("#works-prev"), nextBtn = $("#works-next");
  function updateArrows() {
    if (!worksEl || !prevBtn) return;
    const overflow = worksEl.scrollWidth > worksEl.clientWidth + 4 && !isMobile();
    prevBtn.hidden = nextBtn.hidden = !overflow;
    prevBtn.disabled = worksEl.scrollLeft < 8;
    nextBtn.disabled = worksEl.scrollLeft + worksEl.clientWidth > worksEl.scrollWidth - 8;
  }
  if (worksEl) {
    worksEl.addEventListener("scroll", updateArrows, { passive: true });
    window.addEventListener("resize", updateArrows);
    const step = () => worksEl.clientWidth * 0.6;
    prevBtn && prevBtn.addEventListener("click", () => worksEl.scrollBy({ left: -step() }));
    nextBtn && nextBtn.addEventListener("click", () => worksEl.scrollBy({ left: step() }));
    // mouse drag (touch already scrolls natively)
    let down = null, moved = false;
    worksEl.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse" || worksEl.scrollWidth <= worksEl.clientWidth) return;
      down = { x: e.clientX, left: worksEl.scrollLeft }; moved = false;
    });
    window.addEventListener("pointermove", (e) => {
      if (!down) return;
      const dx = e.clientX - down.x;
      if (Math.abs(dx) > 5) { moved = true; worksEl.classList.add("dragging"); }
      if (moved) worksEl.scrollLeft = down.left - dx / (parseFloat(root.style.getPropertyValue("--s")) || 1);
    });
    window.addEventListener("pointerup", () => { down = null; setTimeout(() => worksEl.classList.remove("dragging"), 0); });
    worksEl.addEventListener("click", (e) => { if (moved) { e.preventDefault(); moved = false; } }, true);
    // vertical mouse wheel scrolls the row sideways only while hovering it and there is room
    worksEl.addEventListener("wheel", (e) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || worksEl.scrollWidth <= worksEl.clientWidth) return;
      const atStart = worksEl.scrollLeft <= 0 && e.deltaY < 0;
      const atEnd = worksEl.scrollLeft + worksEl.clientWidth >= worksEl.scrollWidth - 1 && e.deltaY > 0;
      if (atStart || atEnd || !e.shiftKey) return;
      e.preventDefault(); worksEl.scrollLeft += e.deltaY;
    }, { passive: false });

    fetch(`${API_BASE}/api/works`, { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(renderWorks)
      .catch(() => updateArrows()); // keep the built-in images
  }

  /* =================== Page transitions =================== */
  // moving between pages: keep the nav bar where it is (no fade-out, no re-animation on the next page)
  const go = (href) => {
    try { sessionStorage.setItem("navKeep", "1"); } catch {}
    location.href = href;
  };
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href$=".html"]');
    if (!a || e.metaKey || e.ctrlKey || a.target === "_blank") return;
    const target = a.getAttribute("href");
    if (location.pathname.endsWith(target)) return;
    e.preventDefault();
    go(target);
  });
  window.addEventListener("pageshow", (e) => { if (e.persisted) document.body.classList.remove("leaving"); });

  /* =================== Contact buttons =================== */
  // Details come from the admin panel (Settings). CONTACT above is only a fallback
  // for when the site is opened without the server.
  function applyContact(c) {
    const set = (id, value, href) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.hidden = !value;
      if (value) el.href = href;
    };
    set("c-call", c.phone, `tel:${String(c.phone || "").replace(/[^\d+]/g, "")}`);
    set("c-whatsapp", c.whatsapp, `https://wa.me/${String(c.whatsapp || "").replace(/\D/g, "")}`);
    set("c-mail", c.email, `mailto:${c.email}`);
    set("c-instagram", c.instagram, `https://instagram.com/${String(c.instagram || "").replace(/^@/, "")}`);
    const hrefs = {
      phone: `tel:${String(c.phone || "").replace(/[^\d+]/g, "")}`,
      whatsapp: `https://wa.me/${String(c.whatsapp || "").replace(/\D/g, "")}`,
      email: `mailto:${c.email}`,
      instagram: `https://instagram.com/${String(c.instagram || "").replace(/^@/, "")}`,
    };
    const shownText = { phone: c.phone, whatsapp: c.whatsapp ? `+${String(c.whatsapp).replace(/\D/g, "")}` : "", email: c.email, instagram: c.instagram ? `@${String(c.instagram).replace(/^@/, "")}` : "" };
    let cards = 0;
    document.querySelectorAll("[data-contact]").forEach((row) => {
      const k = row.dataset.contact;
      row.hidden = !c[k];
      if (!c[k]) return;
      cards++;
      row.href = hrefs[k];
      const v = row.querySelector(".cd-value"); if (v) v.textContent = shownText[k];
    });
    const cdEmpty = document.getElementById("cd-empty");
    if (cdEmpty) cdEmpty.hidden = cards > 0;
    const box = document.querySelector(".contacts");
    if (box) {
      const shown = [...box.querySelectorAll(".c-btn")].filter((b) => !b.hidden);
      box.dataset.count = shown.length;
      shown.forEach((b, i) => b.classList.toggle("wide", shown.length % 2 === 1 && i === shown.length - 1));
    }
  }
  applyContact(CONTACT);
  if (document.getElementById("c-call") || document.querySelector("[data-contact]")) {
    fetch(`${API_BASE}/api/settings`, { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(applyContact)
      .catch(() => {}); // keep the fallback
  }

  /* =================== Contact icon tiles (Home, About, Contact) =================== */
  // icons live in assets/icons/ (phone / whatsapp / instagram / email .png); built-in glyphs are the fallback
  document.querySelectorAll(".tile-img").forEach((img) => {
    const exts = ["png", "svg", "webp", "jpg"];
    let i = 0;
    const tryNext = () => {
      if (i >= exts.length) { img.remove(); return; }
      img.src = `assets/icons/${img.dataset.icon}.${exts[i++]}`;
    };
    img.addEventListener("load", () => img.closest(".ct-tile").classList.add("has-img"));
    img.addEventListener("error", tryNext);
    tryNext();
  });
  document.querySelectorAll(".ct-tile").forEach((t) => {
    t.style.setProperty("--k", [...t.parentElement.children].indexOf(t));
    // phones have no hover: play the icon's animation on tap
    t.addEventListener("touchstart", () => {
      t.classList.remove("ping"); void t.offsetWidth; t.classList.add("ping");
      setTimeout(() => t.classList.remove("ping"), 750);
    }, { passive: true });
  });

  /* =================== Chat: saved on this device =================== */
  const KEY = "atharva_chat";
  const Store = {
    get() {
      try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
    },
    set(v) {
      try { localStorage.setItem(KEY, JSON.stringify(v)); return true; } catch { return false; }
    },
    clear() { try { localStorage.removeItem(KEY); } catch {} },
  };

  async function api(path, { method = "GET", body, token } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers["X-Chat-Token"] = token;
    const res = await fetch(`${API_BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(data.error || "Could not send right now."); err.status = res.status; err.field = data.field; throw err; }
    return data;
  }

  // Start a chat (or continue it if it's the same person) — used by the popup and the Contact page
  async function sendMessage({ name, contact, message, website = "" }) {
    const saved = Store.get();
    let conv;
    if (saved && saved.name === name && saved.contact === contact) {
      try {
        await api(`/api/chat/${encodeURIComponent(saved.id)}/messages`, { method: "POST", token: saved.token, body: { text: message } });
        conv = saved;
      } catch (err) { if (err.status !== 404) throw err; }
    }
    if (!conv) {
      const r = await api("/api/chat", { method: "POST", body: { name, contact, message, website } });
      conv = { id: r.id, token: r.token, name, contact };
    }
    const stored = Store.set(conv);
    document.dispatchEvent(new CustomEvent("chat:sent", { detail: conv }));
    return { conv, stored };
  }

  /* =================== Send popup (required before sending) =================== */
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const isPhone = (s) => /^[+\d][\d\s\-()]{5,}$/.test(s) && s.replace(/\D/g, "").length >= 7;

  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.hidden = true;
  modal.innerHTML = `
    <form class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" novalidate>
      <h2 id="modal-title">Send a message</h2>
      <p class="modal-sub">Tell me who you are so I can reply. You'll continue in a private chat.</p>
      <label class="f" data-f="name">
        <span>Your name</span>
        <input name="name" maxlength="60" autocomplete="name" placeholder="e.g. Priya Sharma">
        <em></em>
      </label>
      <label class="f" data-f="contact">
        <span>Email or phone</span>
        <input name="contact" maxlength="120" autocomplete="email" placeholder="so I can reach you back">
        <em></em>
      </label>
      <label class="f" data-f="message">
        <span>Message</span>
        <textarea name="message" maxlength="2000" rows="4" placeholder="type your message here"></textarea>
        <em></em>
      </label>
      <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <p class="modal-error" role="alert"></p>
      <div class="modal-actions">
        <button type="button" class="m-btn ghost" data-close>Cancel</button>
        <button type="submit" class="m-btn solid"><span>Send</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3.5 21.5 12 3 20.5l2.6-8.5L3 3.5Z" fill="currentColor"/></svg>
        </button>
      </div>
    </form>`;
  document.body.appendChild(modal);

  const mForm = modal.querySelector("form");
  const field = (n) => mForm.elements[n];
  let lastFocus = null;
  let busy = false;

  const setFieldError = (name, msg) => {
    const box = mForm.querySelector(`[data-f="${name}"]`);
    if (!box) return;
    box.classList.toggle("has-error", !!msg);
    box.querySelector("em").textContent = msg || "";
  };
  const clearErrors = () => { ["name", "contact", "message"].forEach((n) => setFieldError(n, "")); modal.querySelector(".modal-error").textContent = ""; };

  function openPopup(message = "") {
    const saved = Store.get();
    clearErrors();
    field("name").value = saved ? saved.name : field("name").value;
    field("contact").value = saved ? saved.contact : field("contact").value;
    field("message").value = message;
    lastFocus = document.activeElement;
    modal.hidden = false;
    document.body.classList.add("modal-open");
    requestAnimationFrame(() => modal.classList.add("open"));
    setTimeout(() => (field("name").value ? (message ? mForm.querySelector(".solid") : field("message")) : field("name")).focus(), 60);
  }
  function closePopup() {
    modal.classList.remove("open");
    document.body.classList.remove("modal-open");
    setTimeout(() => { modal.hidden = true; }, 300);
    if (lastFocus) lastFocus.focus();
  }

  modal.addEventListener("mousedown", (e) => { if (e.target === modal) closePopup(); });
  modal.querySelector("[data-close]").addEventListener("click", closePopup);
  document.addEventListener("keydown", (e) => {
    if (modal.hidden) return;
    if (e.key === "Escape") closePopup();
    if (e.key === "Tab") { // keep focus inside the popup
      const f = [...mForm.querySelectorAll("input:not(.hp), textarea, button")];
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  ["name", "contact", "message"].forEach((n) => field(n).addEventListener("input", () => setFieldError(n, "")));
  field("message").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) mForm.requestSubmit();
  });

  mForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    clearErrors();
    const name = field("name").value.trim();
    const contact = field("contact").value.trim();
    const message = field("message").value.trim();
    let ok = true;
    if (!name) { setFieldError("name", "Please enter your name."); ok = false; }
    if (!EMAIL.test(contact) && !isPhone(contact)) { setFieldError("contact", "Enter a valid email or phone number."); ok = false; }
    if (!message) { setFieldError("message", "Please type a message."); ok = false; }
    if (!ok) { mForm.animate([{ translate: "0" }, { translate: "-8px" }, { translate: "8px" }, { translate: "0" }], { duration: 320 }); return; }

    busy = true;
    mForm.classList.add("busy");
    try {
      const { conv, stored } = await sendMessage({ name, contact, message, website: field("website").value });
      const msgInput = $("#msg-input"); if (msgInput) msgInput.value = "";
      if (document.body.classList.contains("page-chat")) { closePopup(); }
      else { modal.classList.remove("open"); go(stored ? "chat.html" : `chat.html#c=${conv.id}.${conv.token}`); }
    } catch (err) {
      if (err.field) setFieldError(err.field, err.message);
      else modal.querySelector(".modal-error").textContent = err.message || "Could not send, please try again.";
    } finally {
      busy = false;
      mForm.classList.remove("busy");
    }
  });

  // Home page message box → always goes through the popup
  const form = $("#msg-form");
  const input = $("#msg-input");
  if (form && input) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) {
        input.focus();
        form.animate([{ translate: "0" }, { translate: "-8px" }, { translate: "8px" }, { translate: "0" }], { duration: 320 });
        return;
      }
      openPopup(text);
    });
  }

  /* =================== "Your chat" button (Home / About) =================== */
  const saved = Store.get();
  if (saved && !document.body.classList.contains("page-chat") && !document.body.classList.contains("page-contact")) {
    const pill = document.createElement("a");
    pill.href = "chat.html";
    pill.className = "chat-pill";
    pill.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5v-9Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg><span>Your chat</span><i class="chat-dot" hidden></i>`;
    document.body.appendChild(pill);
    const check = () => api(`/api/chat/${encodeURIComponent(saved.id)}?peek=1`, { token: saved.token })
      .then((r) => { pill.querySelector(".chat-dot").hidden = !r.unread; pill.classList.toggle("has-new", !!r.unread); })
      .catch((err) => { if (err.status === 404) { Store.clear(); pill.remove(); } });
    check();
    setInterval(() => { if (!document.hidden) check(); }, 20000);
    // step aside while a "Previous chat" button is visible, so they never overlap
    const prevOnPage = document.querySelectorAll(".ct-prev");
    if (prevOnPage.length && "IntersectionObserver" in window) {
      const seen = new Set();
      const io = new IntersectionObserver((entries) => {
        entries.forEach((en) => (en.isIntersecting ? seen.add(en.target) : seen.delete(en.target)));
        pill.classList.toggle("tucked", seen.size > 0);
      });
      prevOnPage.forEach((b) => io.observe(b));
    }
  }

  /* =================== "Previous chat" buttons (Home + Contact) =================== */
  const prevBtns = [...document.querySelectorAll(".ct-prev")];
  if (prevBtns.length) {
    const me = Store.get();
    prevBtns.forEach((b) => { b.hidden = !me; });
    if (me && me.token) {
      api(`/api/chat/${encodeURIComponent(me.id)}?peek=1`, { token: me.token })
        .then((r) => prevBtns.forEach((b) => { const n = b.querySelector(".cp-new"); if (n) n.hidden = !r.unread; }))
        .catch((e) => { if (e.status === 404) prevBtns.forEach((b) => { b.hidden = true; }); });
    }
  }

  /* =================== Cursor parallax =================== */
  const hands = $(".hands");
  const portrait = $(".portrait-inner");
  window.addEventListener("mousemove", (e) => {
    if (isMobile()) return;
    const x = (e.clientX / window.innerWidth - 0.5) * 2;
    const y = (e.clientY / window.innerHeight - 0.5) * 2;
    if (hands) hands.style.transform = `translate(${x * 8}px, ${y * 6}px)`;
    if (portrait) portrait.style.transform = `translate(${x * -10}px, ${y * -10}px) scale(1.03)`;
  });

  // shared with chat.js
  window.SiteChat = { Store, api, openPopup, sendMessage, go, EMAIL, isPhone };
})();
