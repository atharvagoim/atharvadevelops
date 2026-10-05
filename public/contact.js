// Contact page form → starts (or continues) a private chat, then opens the chat page
(() => {
  const { sendMessage, go, EMAIL, isPhone } = window.SiteChat;
  const form = document.getElementById("ct-form");
  if (!form) return;
  const card = form;
  const f = (n) => form.elements[n];
  const err = document.getElementById("ct-error");
  let busy = false;

  const setError = (name, msg) => {
    const box = form.querySelector(`[data-f="${name}"]`);
    if (!box) return;
    box.classList.toggle("has-error", !!msg);
    box.querySelector("em").textContent = msg || "";
  };
  ["name", "contact", "message"].forEach((n) => f(n).addEventListener("input", () => setError(n, "")));

  // prefill if this visitor already chatted before, and show "Previous chat"
  const saved = window.SiteChat.Store.get();
  if (saved) { f("name").value = saved.name || ""; f("contact").value = saved.contact || ""; }


  // tiles pop in one after another


  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    err.textContent = "";
    const name = f("name").value.trim();
    const contact = f("contact").value.trim();
    const message = f("message").value.trim();
    let ok = true;
    if (!name) { setError("name", "Please enter your name."); ok = false; }
    if (!EMAIL.test(contact) && !isPhone(contact)) { setError("contact", "Enter a valid email or phone number."); ok = false; }
    if (!message) { setError("message", "Please type a message."); ok = false; }
    if (!ok) { form.animate([{ translate: "0" }, { translate: "-8px" }, { translate: "8px" }, { translate: "0" }], { duration: 320 }); return; }

    busy = true;
    card.classList.add("busy");
    try {
      const { conv, stored } = await sendMessage({ name, contact, message, website: f("website").value });
      form.classList.add("sent");
      go(stored ? "chat.html" : `chat.html#c=${conv.id}.${conv.token}`);
    } catch (e2) {
      if (e2.field) setError(e2.field, e2.message);
      else err.textContent = e2.message || "Could not send, please try again.";
    } finally {
      busy = false;
      card.classList.remove("busy");
    }
  });
})();

