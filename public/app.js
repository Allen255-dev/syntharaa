// ============================================================================
// Synthara — client
// ============================================================================

const els = {
  backdrop: document.getElementById("backdrop"),
  sidebar: document.getElementById("sidebar"),
  sidebarToggleBtn: document.getElementById("sidebarToggleBtn"),
  newChatBtn: document.getElementById("newChatBtn"),
  searchInput: document.getElementById("searchInput"),
  threadList: document.getElementById("threadList"),
  hero: document.getElementById("hero"),
  heroName: document.getElementById("heroName"),
  userName: document.getElementById("userName"),
  messages: document.getElementById("messages"),
  composerForm: document.getElementById("composerForm"),
  composerInput: document.getElementById("composerInput"),
  sendBtn: document.getElementById("sendBtn"),
  attachBtn: document.getElementById("attachBtn"),
  fileInput: document.getElementById("fileInput"),
  attachmentStrip: document.getElementById("attachmentStrip"),
  modelPickerBtn: document.getElementById("modelPickerBtn"),
  modelPickerLabel: document.getElementById("modelPickerLabel"),
  modelMenu: document.getElementById("modelMenu"),
  modelDot: document.getElementById("modelDot"),
  settingsBtn: document.getElementById("settingsBtn"),
  settingsOverlay: document.getElementById("settingsOverlay"),
  closeSettingsBtn: document.getElementById("closeSettingsBtn"),
  providerStatusList: document.getElementById("providerStatusList"),
  defaultModelSelect: document.getElementById("defaultModelSelect"),
  clearAllBtn: document.getElementById("clearAllBtn"),
  modalNavBtns: document.querySelectorAll(".modal-nav-btn"),
  modalPanels: document.querySelectorAll(".modal-panel"),
  themeOpts: document.querySelectorAll(".theme-opt"),
  displayNameInput: document.getElementById("displayNameInput"),
  sharedLinksList: document.getElementById("sharedLinksList"),
  exportDataBtn: document.getElementById("exportDataBtn"),
  shareChatBtn: document.getElementById("shareChatBtn"),
  shareOverlay: document.getElementById("shareOverlay"),
  closeShareBtn: document.getElementById("closeShareBtn"),
  shareModalSub: document.getElementById("shareModalSub"),
  shareLinkInput: document.getElementById("shareLinkInput"),
  copyShareLinkBtn: document.getElementById("copyShareLinkBtn"),
  shareBanner: document.getElementById("shareBanner"),
  appRoot: document.getElementById("appRoot"),
  authScreen: document.getElementById("authScreen"),
  authError: document.getElementById("authError"),
  authTabBtns: document.querySelectorAll(".auth-tab-btn"),
  authForms: document.querySelectorAll(".auth-form"),
  loginForm: document.getElementById("loginForm"),
  signupForm: document.getElementById("signupForm"),
  accountEmail: document.getElementById("accountEmail"),
  logoutBtn: document.getElementById("logoutBtn"),
  logoutAllBtn: document.getElementById("logoutAllBtn"),
  deleteAccountBtn: document.getElementById("deleteAccountBtn"),
};

const STORAGE = {
  model: "synthara_selected_model_v1",
  theme: "synthara_theme_v1",
};

const MAX_FILES = 4;
const MAX_TEXT_CHARS = 15000;
const TEXT_EXTENSIONS = ["txt", "md", "csv", "json", "js", "ts", "jsx", "tsx", "py", "html", "css", "yaml", "yml", "log"];

let PROVIDERS = {};
let state = {
  user: null,
  threads: [], // loaded from the server after login
  activeThreadId: null,
  selected: loadJSON(STORAGE.model, null), // { provider, model }
  streaming: false,
  abortController: null,
  pendingAttachments: [], // [{ id, name, kind: 'image'|'document', mimeType, dataUrl?, text?, uploading }]
};

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function saveJSON(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}
function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// ----------------------------------------------------------------------------
// Theme
// ----------------------------------------------------------------------------
const systemDarkQuery = window.matchMedia("(prefers-color-scheme: dark)");

function applyTheme(choice) {
  state.themeChoice = choice;
  const resolved = choice === "system" ? (systemDarkQuery.matches ? "dark" : "light") : choice;
  document.documentElement.setAttribute("data-theme", resolved);
  els.themeOpts.forEach((btn) => btn.classList.toggle("active", btn.dataset.themeChoice === choice));
}
applyTheme(loadJSON(STORAGE.theme, "dark"));
systemDarkQuery.addEventListener("change", () => {
  if (state.themeChoice === "system") applyTheme("system");
});

// ----------------------------------------------------------------------------
// Bootstrapping
// ----------------------------------------------------------------------------
const shareViewMatch = window.location.pathname.match(/^\/share\/([a-f0-9]+)/);
if (shareViewMatch) {
  initShareView(shareViewMatch[1]);
} else {
  boot();
}

async function boot() {
  bindAuthEvents();
  try {
    const res = await fetch("/api/auth/me");
    const data = await res.json();
    if (data.user) {
      state.user = data.user;
      await startApp();
    } else {
      showAuthScreen();
    }
  } catch {
    showAuthScreen();
  }
}

async function startApp() {
  hideAuthScreen();
  await init();
}

function showAuthScreen() {
  els.appRoot.hidden = true;
  els.authScreen.hidden = false;
}
function hideAuthScreen() {
  els.authScreen.hidden = true;
  els.appRoot.hidden = false;
}

function setAuthError(msg) {
  if (!msg) {
    els.authError.hidden = true;
    els.authError.textContent = "";
  } else {
    els.authError.hidden = false;
    els.authError.textContent = msg;
  }
}

function bindAuthEvents() {
  els.authTabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      setAuthError(null);
      els.authTabBtns.forEach((b) => b.classList.toggle("active", b === btn));
      els.authForms.forEach((f) => f.classList.toggle("active", f.dataset.authPanel === btn.dataset.authTab));
    });
  });

  els.loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setAuthError(null);
    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    const submitBtn = els.loginForm.querySelector(".auth-submit-btn");
    submitBtn.disabled = true;
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't log in.");
      state.user = data.user;
      await startApp();
    } catch (err) {
      setAuthError(err.message);
    } finally {
      submitBtn.disabled = false;
    }
  });

  els.signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setAuthError(null);
    const displayName = document.getElementById("signupName").value.trim();
    const email = document.getElementById("signupEmail").value.trim();
    const password = document.getElementById("signupPassword").value;
    const submitBtn = els.signupForm.querySelector(".auth-submit-btn");
    submitBtn.disabled = true;
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, displayName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't create your account.");
      state.user = data.user;
      await startApp();
    } catch (err) {
      setAuthError(err.message);
    } finally {
      submitBtn.disabled = false;
    }
  });
}

async function logout() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    /* clear the client state regardless */
  }
  window.location.reload();
}

async function initShareView(id) {
  els.appRoot.hidden = false;
  document.body.classList.add("share-view");
  els.shareBanner.hidden = false;
  els.hero.classList.add("hidden");
  els.messages.classList.add("active");
  try {
    const res = await fetch(`/api/share/${id}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "This shared chat wasn't found.");
    document.title = `${data.title} · Synthara`;
    data.messages.forEach((m) => {
      const row = document.createElement("div");
      row.className = "msg-row " + m.role;
      const avatar =
        m.role === "assistant"
          ? `<div class="msg-avatar"><svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 2.5l1.9 6.6L20.5 11l-6.6 1.9L12 19.5l-1.9-6.6L3.5 11l6.6-1.9L12 2.5z" fill="#0a0812"/></svg></div>`
          : "";
      const attachHtml =
        m.attachments && m.attachments.length
          ? m.attachments.map((a) => `<span class="attachment-chip-inline">${a.kind === "image" ? "🖼️" : "📄"} ${escapeHtml(a.name)}</span>`).join("")
          : "";
      row.innerHTML = `${avatar}<div class="msg-col"><div class="msg-bubble">${attachHtml}${renderContent(m.content)}</div></div>`;
      els.messages.appendChild(row);
    });
  } catch (err) {
    els.messages.innerHTML = `<div class="share-error">⚠️ ${escapeHtml(err.message)}</div>`;
  }
}

async function init() {
  try {
    const res = await fetch("/api/providers");
    PROVIDERS = await res.json();
  } catch {
    PROVIDERS = {};
  }

  // If nothing is selected yet, or the saved selection is no longer valid/available, pick the first available model.
  if (!state.selected || !isSelectionValid(state.selected)) {
    state.selected = firstAvailableModel();
    saveJSON(STORAGE.model, state.selected);
  }

  applyDisplayName(state.user.displayName);
  buildModelMenu();
  buildPreferences();
  await fetchThreads();
  renderThreadList();
  applySelectedModelLabel();
  bindEvents();
  autoGrowTextarea();

  if (!hasAnyProviderAvailable()) {
    showSetupNotice();
  }
}

function applyDisplayName(name) {
  state.displayName = name;
  els.heroName.textContent = name;
  els.userName.textContent = name;
  if (els.displayNameInput) els.displayNameInput.value = name;
  if (els.accountEmail && state.user) els.accountEmail.textContent = state.user.email;
}

function hasAnyProviderAvailable() {
  return Object.values(PROVIDERS).some((p) => p.available);
}

function isSelectionValid(sel) {
  const cfg = PROVIDERS[sel?.provider];
  return !!(cfg && cfg.available && cfg.models.some((m) => m.id === sel.model));
}

function firstAvailableModel() {
  for (const [providerId, cfg] of Object.entries(PROVIDERS)) {
    if (cfg.available && cfg.models.length) {
      return { provider: providerId, model: cfg.models[0].id };
    }
  }
  return null;
}

function showSetupNotice() {
  els.hero.querySelector("p").textContent =
    "No AI provider is configured on this server yet — open Preferences to see setup info, or ask the site owner to add an API key.";
}

// ----------------------------------------------------------------------------
// Model picker
// ----------------------------------------------------------------------------
function buildModelMenu() {
  els.modelMenu.innerHTML = "";
  Object.entries(PROVIDERS).forEach(([providerId, cfg]) => {
    const label = document.createElement("div");
    label.className = "model-group-label";
    label.innerHTML = `<span>${cfg.label}</span>`;
    els.modelMenu.appendChild(label);

    cfg.models.forEach((m) => {
      const opt = document.createElement("div");
      const isSelected = state.selected && state.selected.provider === providerId && state.selected.model === m.id;
      opt.className = "model-option" + (isSelected ? " selected" : "") + (!cfg.available ? " needs-key" : "");
      opt.innerHTML = `<span>${m.label}</span><span class="badge">${cfg.available ? "" : "unavailable"}</span>`;
      opt.addEventListener("click", () => {
        if (!cfg.available) {
          openSettings();
          els.modelMenu.classList.remove("open");
          return;
        }
        state.selected = { provider: providerId, model: m.id };
        saveJSON(STORAGE.model, state.selected);
        applySelectedModelLabel();
        buildModelMenu();
        els.modelMenu.classList.remove("open");
      });
      els.modelMenu.appendChild(opt);
    });
  });
}

function applySelectedModelLabel() {
  if (state.selected) {
    const cfg = PROVIDERS[state.selected.provider];
    const m = cfg?.models.find((x) => x.id === state.selected.model);
    els.modelPickerLabel.textContent = m ? m.label : "Choose a model";
    els.modelDot.classList.add("ready");
  } else {
    els.modelPickerLabel.textContent = "Choose a model";
    els.modelDot.classList.remove("ready");
  }
}

function currentProviderConfig() {
  return state.selected ? PROVIDERS[state.selected.provider] : null;
}

// ----------------------------------------------------------------------------
// Preferences modal
// ----------------------------------------------------------------------------
function buildPreferences() {
  els.providerStatusList.innerHTML = "";
  els.defaultModelSelect.innerHTML = "";

  Object.entries(PROVIDERS).forEach(([providerId, cfg]) => {
    const row = document.createElement("div");
    row.className = "provider-status-row";
    row.innerHTML = `<span>${cfg.label}</span><span class="status-pill ${cfg.available ? "on" : "off"}">${
      cfg.available ? "Configured" : "Not configured"
    }</span>`;
    els.providerStatusList.appendChild(row);

    if (cfg.available) {
      cfg.models.forEach((m) => {
        const opt = document.createElement("option");
        opt.value = `${providerId}::${m.id}`;
        opt.textContent = `${cfg.label} — ${m.label}`;
        if (state.selected && state.selected.provider === providerId && state.selected.model === m.id) {
          opt.selected = true;
        }
        els.defaultModelSelect.appendChild(opt);
      });
    }
  });

  if (!els.defaultModelSelect.children.length) {
    const opt = document.createElement("option");
    opt.textContent = "No models available yet";
    els.defaultModelSelect.appendChild(opt);
  }

  renderSharedLinksList();
}

async function renderSharedLinksList() {
  els.sharedLinksList.innerHTML = `<p class="shared-links-empty">Loading…</p>`;
  let shares = [];
  try {
    const res = await fetch("/api/shares");
    const data = await res.json();
    shares = data.shares || [];
  } catch {
    shares = [];
  }

  els.sharedLinksList.innerHTML = "";
  if (!shares.length) {
    els.sharedLinksList.innerHTML = `<p class="shared-links-empty">You haven't shared any chats yet.</p>`;
    return;
  }
  shares.forEach((s) => {
    const url = `${window.location.origin}/share/${s.id}`;
    const row = document.createElement("div");
    row.className = "shared-link-item";
    row.innerHTML = `
      <span class="link-title">${escapeHtml(s.title)}</span>
      <button class="open-btn" title="Open">Open</button>
      <button class="copy-btn" title="Copy link">Copy</button>
      <button class="revoke-btn" title="Revoke">Revoke</button>
    `;
    row.querySelector(".open-btn").addEventListener("click", () => window.open(url, "_blank"));
    row.querySelector(".copy-btn").addEventListener("click", async () => {
      await navigator.clipboard.writeText(url);
    });
    row.querySelector(".revoke-btn").addEventListener("click", () => revokeShare(s.id));
    els.sharedLinksList.appendChild(row);
  });
}

async function revokeShare(id) {
  try {
    await fetch(`/api/share/${id}`, { method: "DELETE" });
  } catch {
    /* ignore — re-render will reflect actual server state either way */
  }
  renderSharedLinksList();
}

function openSettings() {
  buildPreferences();
  els.settingsOverlay.classList.add("open");
}
function closeSettings() {
  els.settingsOverlay.classList.remove("open");
}

// ----------------------------------------------------------------------------
// Threads — persisted server-side, per account
// ----------------------------------------------------------------------------
async function fetchThreads() {
  try {
    const res = await fetch("/api/threads");
    const data = await res.json();
    state.threads = data.threads || [];
  } catch {
    state.threads = [];
  }
}

async function ensureActiveThread() {
  const existing = getActiveThread();
  if (existing) return existing;
  const res = await fetch("/api/threads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "New chat", messages: [] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Couldn't start a new chat.");
  state.threads.unshift(data.thread);
  state.activeThreadId = data.thread.id;
  renderThreadList();
  return data.thread;
}

function getActiveThread() {
  return state.threads.find((t) => t.id === state.activeThreadId) || null;
}

// Fire-and-forget sync of one thread's current title/pinned/messages to the
// server. Called after mutations rather than on every keystroke/token.
function syncThread(thread) {
  if (!thread) return;
  fetch(`/api/threads/${thread.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: thread.title, pinned: thread.pinned, messages: thread.messages }),
  }).catch(() => {
    /* best-effort — a later sync will catch up */
  });
}

function renderThreadList(filter = "") {
  els.threadList.innerHTML = "";
  const q = filter.trim().toLowerCase();
  const visible = state.threads.filter((t) => !q || t.title.toLowerCase().includes(q));
  const pinned = visible.filter((t) => t.pinned);
  const rest = visible.filter((t) => !t.pinned);

  if (pinned.length) {
    els.threadList.appendChild(groupLabel("Pinned"));
    pinned.forEach((t) => els.threadList.appendChild(buildThreadItem(t, q)));
  }
  if (pinned.length && rest.length) {
    els.threadList.appendChild(groupLabel("All chats"));
  }
  rest.forEach((t) => els.threadList.appendChild(buildThreadItem(t, q)));
}

function groupLabel(text) {
  const el = document.createElement("div");
  el.className = "thread-group-label";
  el.textContent = text;
  return el;
}

function buildThreadItem(t, q) {
  const item = document.createElement("div");
  item.className = "thread-item" + (t.id === state.activeThreadId ? " active" : "");
  item.innerHTML = `
    ${t.pinned ? '<svg class="pin-indicator" width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2l8 8-5 2-5 5-2-2 5-5 2-5-3-3z"/><path d="M4 20l6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' : ""}
    <span class="thread-title">${escapeHtml(t.title)}</span>
    <div class="thread-actions">
      <button class="thread-action-btn pin-btn" title="${t.pinned ? "Unpin" : "Pin"}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="${t.pinned ? "currentColor" : "none"}"><path d="M14 2l8 8-5 2-5 5-2-2 5-5 2-5-3-3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M4 20l6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      </button>
      <button class="thread-action-btn edit-btn" title="Rename">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="thread-action-btn del-btn" title="Delete">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m2 0v14a2 2 0 01-2 2H8a2 2 0 01-2-2V6h12z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
      </button>
    </div>
  `;
  item.addEventListener("click", (e) => {
    if (e.target.closest(".thread-actions")) return;
    state.activeThreadId = t.id;
    renderThreadList(q);
    renderActiveThread();
    autoCloseOnNavigate();
  });
  item.querySelector(".pin-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    t.pinned = !t.pinned;
    syncThread(t);
    renderThreadList(q);
  });
  item.querySelector(".edit-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    beginRenameThread(item, t, q);
  });
  item.querySelector(".del-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    if (!confirm(`Delete "${t.title}"?`)) return;
    state.threads = state.threads.filter((x) => x.id !== t.id);
    if (state.activeThreadId === t.id) state.activeThreadId = null;
    fetch(`/api/threads/${t.id}`, { method: "DELETE" }).catch(() => {});
    renderThreadList(q);
    renderActiveThread();
  });
  return item;
}

function beginRenameThread(item, t, q) {
  const titleEl = item.querySelector(".thread-title");
  const input = document.createElement("input");
  input.className = "thread-rename-input";
  input.value = t.title;
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  const commit = () => {
    const val = input.value.trim();
    if (val) t.title = val;
    syncThread(t);
    renderThreadList(q);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    if (e.key === "Escape") renderThreadList(q);
  });
  input.addEventListener("blur", commit);
}

function renderActiveThread() {
  const thread = getActiveThread();
  els.messages.innerHTML = "";
  if (!thread || thread.messages.length === 0) {
    els.hero.classList.remove("hidden");
    els.messages.classList.remove("active");
    return;
  }
  els.hero.classList.add("hidden");
  els.messages.classList.add("active");
  thread.messages.forEach((m, i) => appendMessageBubble(m.role, m.content, i, m.attachments));
  scrollToBottom();
}

// ----------------------------------------------------------------------------
// Message rendering + actions
// ----------------------------------------------------------------------------
function appendMessageBubble(role, content, index, attachments) {
  const row = document.createElement("div");
  row.className = "msg-row " + role;
  row.dataset.index = index;

  const avatar =
    role === "assistant"
      ? `<div class="msg-avatar"><svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 2.5l1.9 6.6L20.5 11l-6.6 1.9L12 19.5l-1.9-6.6L3.5 11l6.6-1.9L12 2.5z" fill="#0a0812"/></svg></div>`
      : "";
  const attachHtml = attachments && attachments.length ? renderAttachmentChips(attachments) : "";

  row.innerHTML = `
    ${avatar}
    <div class="msg-col">
      <div class="msg-bubble">${attachHtml}${renderContent(content)}</div>
      <div class="msg-actions"></div>
    </div>
  `;
  els.messages.appendChild(row);
  attachMessageActions(row, role);
  return row.querySelector(".msg-bubble");
}

function renderAttachmentChips(attachments) {
  return attachments
    .map((a) => {
      if (a.kind === "image") {
        return `<span class="attachment-chip-inline"><img src="${a.dataUrl}" alt=""/> ${escapeHtml(a.name)}</span>`;
      }
      return `<span class="attachment-chip-inline">📄 ${escapeHtml(a.name)}</span>`;
    })
    .join("");
}

function attachMessageActions(row, role) {
  const actions = row.querySelector(".msg-actions");
  const index = Number(row.dataset.index);

  const copyBtn = document.createElement("button");
  copyBtn.className = "msg-action-btn";
  copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="12" height="12" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1" stroke="currentColor" stroke-width="2"/></svg> Copy`;
  copyBtn.addEventListener("click", async () => {
    const thread = getActiveThread();
    const msg = thread?.messages[index];
    if (!msg) return;
    await navigator.clipboard.writeText(msg.content);
    copyBtn.classList.add("copied");
    copyBtn.innerHTML = "✓ Copied";
    setTimeout(() => {
      copyBtn.classList.remove("copied");
      copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="12" height="12" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1" stroke="currentColor" stroke-width="2"/></svg> Copy`;
    }, 1400);
  });
  actions.appendChild(copyBtn);

  if (role === "user") {
    const editBtn = document.createElement("button");
    editBtn.className = "msg-action-btn";
    editBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Edit`;
    editBtn.addEventListener("click", () => beginEdit(row, index));
    actions.appendChild(editBtn);
  }

  if (role === "assistant") {
    const regenBtn = document.createElement("button");
    regenBtn.className = "msg-action-btn";
    regenBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M3 12a9 9 0 0115.36-6.36M21 12a9 9 0 01-15.36 6.36M21 3v6h-6M3 21v-6h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Regenerate`;
    regenBtn.addEventListener("click", () => regenerateFrom(index));
    actions.appendChild(regenBtn);
  }
}

function beginEdit(row, index) {
  const thread = getActiveThread();
  const msg = thread?.messages[index];
  if (!msg) return;
  const bubble = row.querySelector(".msg-bubble");
  const original = msg.content;

  bubble.innerHTML = `
    <textarea class="msg-edit-area">${escapeHtml(original)}</textarea>
    <div class="msg-edit-actions">
      <button class="cancel-btn" type="button">Cancel</button>
      <button class="save-btn" type="button">Save & submit</button>
    </div>
  `;
  const textarea = bubble.querySelector(".msg-edit-area");
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";
  textarea.focus();

  bubble.querySelector(".cancel-btn").addEventListener("click", () => renderActiveThread());
  bubble.querySelector(".save-btn").addEventListener("click", () => {
    const newText = textarea.value.trim();
    if (!newText) return;
    // Truncate everything from this message onward, then resend as a fresh turn.
    thread.messages = thread.messages.slice(0, index);
    syncThread(thread);
    renderActiveThread();
    submitTurn(newText, msg.attachments || []);
  });
}

function regenerateFrom(assistantIndex) {
  const thread = getActiveThread();
  if (!thread || state.streaming) return;
  thread.messages = thread.messages.slice(0, assistantIndex);
  syncThread(thread);
  renderActiveThread();
  streamAssistantReply(thread);
}

function renderContent(text) {
  const escaped = escapeHtml(text || "");
  const withCodeBlocks = escaped.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => `<pre><code>${code.trim()}</code></pre>`);
  const withInlineCode = withCodeBlocks.replace(/`([^`]+)`/g, "<code>$1</code>");
  const paragraphs = withInlineCode
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return paragraphs || "<p></p>";
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function scrollToBottom() {
  els.messages.scrollTop = els.messages.scrollHeight;
}

// ----------------------------------------------------------------------------
// Attachments (file handling)
// ----------------------------------------------------------------------------
function fileExt(name) {
  return (name.split(".").pop() || "").toLowerCase();
}

async function handleFilesSelected(fileList) {
  const files = Array.from(fileList).slice(0, MAX_FILES - state.pendingAttachments.length);
  for (const file of files) {
    if (file.size > 8 * 1024 * 1024) {
      alert(`${file.name} is larger than 8MB and was skipped.`);
      continue;
    }
    const isImage = file.type.startsWith("image/");
    const ext = fileExt(file.name);
    const id = uid();

    if (isImage) {
      const dataUrl = await readAsDataUrl(file);
      state.pendingAttachments.push({ id, name: file.name, kind: "image", mimeType: file.type, dataUrl });
      renderAttachmentStrip();
    } else if (ext === "pdf") {
      const chip = { id, name: file.name, kind: "document", mimeType: "application/pdf", text: "", uploading: true };
      state.pendingAttachments.push(chip);
      renderAttachmentStrip();
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Upload failed");
        chip.text = data.text;
      } catch (err) {
        state.pendingAttachments = state.pendingAttachments.filter((a) => a.id !== id);
        alert(`Couldn't read ${file.name}: ${err.message}`);
      }
      chip.uploading = false;
      renderAttachmentStrip();
    } else if (TEXT_EXTENSIONS.includes(ext) || file.type.startsWith("text/")) {
      const text = (await readAsText(file)).slice(0, MAX_TEXT_CHARS);
      state.pendingAttachments.push({ id, name: file.name, kind: "document", mimeType: file.type || "text/plain", text });
      renderAttachmentStrip();
    } else {
      alert(`${file.name}: unsupported file type. Try text files, PDFs, or images.`);
    }
  }
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function renderAttachmentStrip() {
  els.attachmentStrip.innerHTML = "";
  state.pendingAttachments.forEach((a) => {
    const chip = document.createElement("div");
    chip.className = "attach-chip" + (a.uploading ? " uploading" : "");
    const preview =
      a.kind === "image"
        ? `<img src="${a.dataUrl}" alt="" />`
        : `<span class="file-icon">${fileExt(a.name).slice(0, 3).toUpperCase() || "DOC"}</span>`;
    chip.innerHTML = `
      ${preview}
      <span class="chip-name">${escapeHtml(a.name)}${a.uploading ? " · reading…" : ""}</span>
      <button type="button" class="chip-remove" title="Remove">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    `;
    chip.querySelector(".chip-remove").addEventListener("click", () => {
      state.pendingAttachments = state.pendingAttachments.filter((x) => x.id !== a.id);
      renderAttachmentStrip();
    });
    els.attachmentStrip.appendChild(chip);
  });
}

// ----------------------------------------------------------------------------
// Messaging
// ----------------------------------------------------------------------------
function composeFinalText(text, attachments) {
  const docs = attachments.filter((a) => a.kind === "document" && a.text);
  if (!docs.length) return text;
  const docBlocks = docs.map((d) => `--- ${d.name} ---\n${d.text}`).join("\n\n");
  return `${text}\n\n[Attached files]\n${docBlocks}`;
}

async function sendMessage() {
  const text = els.composerInput.value.trim();
  if ((!text && !state.pendingAttachments.length) || state.streaming) return;
  if (state.pendingAttachments.some((a) => a.uploading)) return; // wait for uploads to finish

  if (!state.selected || !currentProviderConfig()?.available) {
    openSettings();
    return;
  }

  const attachments = state.pendingAttachments;
  state.pendingAttachments = [];
  renderAttachmentStrip();
  els.composerInput.value = "";
  autoGrowTextarea();

  await submitTurn(text || "(see attached file)", attachments);
}

async function submitTurn(text, attachments) {
  const thread = await ensureActiveThread();

  els.hero.classList.add("hidden");
  els.messages.classList.add("active");

  const userMsg = {
    role: "user",
    content: composeFinalText(text, attachments),
    attachments: attachments.map((a) => ({ id: a.id, name: a.name, kind: a.kind, dataUrl: a.dataUrl })),
  };
  thread.messages.push(userMsg);
  if (thread.messages.filter((m) => m.role === "user").length === 1) {
    thread.title = text.slice(0, 42) + (text.length > 42 ? "…" : "");
  }
  appendMessageBubble("user", userMsg.content, thread.messages.length - 1, userMsg.attachments);
  syncThread(thread);
  renderThreadList(els.searchInput.value);
  scrollToBottom();

  await streamAssistantReply(thread, attachments.filter((a) => a.kind === "image"));
}

async function streamAssistantReply(thread, imageAttachments = []) {
  const bubble = appendMessageBubble("assistant", "", thread.messages.length);
  bubble.innerHTML = `<span class="typing-dots"><span></span><span></span><span></span></span>`;
  scrollToBottom();

  state.streaming = true;
  state.abortController = new AbortController();
  setSendButtonState("stop");

  let assistantText = "";
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: state.selected.provider,
        model: state.selected.model,
        messages: thread.messages.map((m) => ({ role: m.role, content: m.content })),
        attachments: imageAttachments.map((a) => ({ mimeType: a.mimeType, dataUrl: a.dataUrl })),
      }),
      signal: state.abortController.signal,
    });

    if (!res.ok) {
      const ct = res.headers.get("content-type") || "";
      let message;
      if (ct.includes("application/json")) {
        const errJson = await res.json().catch(() => ({}));
        message = errJson.error;
      } else {
        message = (await res.text().catch(() => "")).trim();
      }
      throw new Error(message || `Request failed (${res.status})`);
    }
    if (!res.body) throw new Error("No response body from server.");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let first = true;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (!chunk) continue;
      if (first) {
        bubble.innerHTML = "";
        first = false;
      }
      assistantText += chunk;
      bubble.innerHTML = renderContent(assistantText);
      scrollToBottom();
    }

    if (!assistantText) bubble.innerHTML = renderContent("_(no response received)_");
  } catch (err) {
    if (err.name === "AbortError") {
      bubble.innerHTML = renderContent(assistantText || "_(stopped)_");
    } else {
      bubble.innerHTML = renderContent(`⚠️ ${err.message}`);
    }
  } finally {
    thread.messages.push({ role: "assistant", content: assistantText });
    syncThread(thread);
    maybeGenerateTitle(thread, assistantText);
    state.streaming = false;
    state.abortController = null;
    setSendButtonState("send");
    // The bubble was rendered as a placeholder before this message existed
    // in `thread.messages`; its index is now correct, and its action
    // buttons were already attached once in appendMessageBubble — no need
    // to attach them again here.
    const row = els.messages.lastElementChild;
    if (row) row.dataset.index = thread.messages.length - 1;
  }
}

// Names the thread the way a good librarian would: after the first
// exchange, ask the current provider/model to read the exchange and name it
// based on its key concepts and entities, rather than just truncating the
// first message. Works identically across every provider since it's just
// another call through the same /api/title endpoint. Silently keeps the
// truncated fallback title (set in submitTurn) if this fails for any reason.
async function maybeGenerateTitle(thread, assistantText) {
  const userCount = thread.messages.filter((m) => m.role === "user").length;
  if (userCount !== 1 || !assistantText || !state.selected) return;
  const userMsg = thread.messages.find((m) => m.role === "user");

  try {
    const res = await fetch("/api/title", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: state.selected.provider,
        model: state.selected.model,
        messages: [
          { role: "user", content: userMsg.content },
          { role: "assistant", content: assistantText },
        ],
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.title) return;
    thread.title = data.title;
    syncThread(thread);
    renderThreadList(els.searchInput.value);
  } catch {
    /* keep the fallback title */
  }
}

function setSendButtonState(mode) {
  if (mode === "stop") {
    els.sendBtn.classList.add("stop");
    els.sendBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
  } else {
    els.sendBtn.classList.remove("stop");
    els.sendBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
}

// ----------------------------------------------------------------------------
// Mobile sidebar
// ----------------------------------------------------------------------------
const mobileQuery = window.matchMedia("(max-width: 820px)");

function isSidebarOpen() {
  return mobileQuery.matches ? els.sidebar.classList.contains("mobile-open") : !els.sidebar.classList.contains("collapsed");
}
function openSidebar() {
  if (mobileQuery.matches) {
    els.sidebar.classList.add("mobile-open");
    els.backdrop.classList.add("open");
  } else {
    els.sidebar.classList.remove("collapsed");
  }
}
function closeSidebarUI() {
  if (mobileQuery.matches) {
    els.sidebar.classList.remove("mobile-open");
    els.backdrop.classList.remove("open");
  } else {
    els.sidebar.classList.add("collapsed");
  }
}
function toggleSidebar() {
  isSidebarOpen() ? closeSidebarUI() : openSidebar();
}
// Used after navigating (new chat / picking a thread) — only auto-closes the
// drawer on mobile; leaves the desktop sidebar exactly as the user left it.
function autoCloseOnNavigate() {
  if (mobileQuery.matches) closeSidebarUI();
}

// ----------------------------------------------------------------------------
// Events
// ----------------------------------------------------------------------------
function bindEvents() {
  els.newChatBtn.addEventListener("click", () => {
    state.activeThreadId = null;
    renderThreadList(els.searchInput.value);
    renderActiveThread();
    autoCloseOnNavigate();
    els.composerInput.focus();
  });

  els.searchInput.addEventListener("input", (e) => renderThreadList(e.target.value));

  els.composerForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (state.streaming) {
      state.abortController?.abort();
      return;
    }
    sendMessage();
  });

  els.composerInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!state.streaming) sendMessage();
    }
  });
  els.composerInput.addEventListener("input", autoGrowTextarea);

  els.attachBtn.addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", (e) => {
    if (e.target.files.length) handleFilesSelected(e.target.files);
    e.target.value = "";
  });

  // Paste-to-attach images
  els.composerInput.addEventListener("paste", (e) => {
    const items = Array.from(e.clipboardData?.items || []).filter((i) => i.type.startsWith("image/"));
    if (items.length) handleFilesSelected(items.map((i) => i.getAsFile()));
  });

  els.modelPickerBtn.addEventListener("click", () => els.modelMenu.classList.toggle("open"));
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#modelPicker")) els.modelMenu.classList.remove("open");
  });

  els.sidebarToggleBtn.addEventListener("click", toggleSidebar);
  els.backdrop.addEventListener("click", closeSidebarUI);

  els.settingsBtn.addEventListener("click", openSettings);
  els.closeSettingsBtn.addEventListener("click", closeSettings);
  els.settingsOverlay.addEventListener("click", (e) => {
    if (e.target === els.settingsOverlay) closeSettings();
  });

  els.defaultModelSelect.addEventListener("change", (e) => {
    const [provider, model] = e.target.value.split("::");
    if (provider && model) {
      state.selected = { provider, model };
      saveJSON(STORAGE.model, state.selected);
      applySelectedModelLabel();
      buildModelMenu();
    }
  });

  els.clearAllBtn.addEventListener("click", async () => {
    if (!confirm("Delete all your chats? This can't be undone.")) return;
    try {
      await fetch("/api/threads", { method: "DELETE" });
    } catch {
      /* fall through — clear the local view either way */
    }
    state.threads = [];
    state.activeThreadId = null;
    renderThreadList();
    renderActiveThread();
    closeSettings();
  });

  els.logoutBtn.addEventListener("click", logout);
  els.logoutAllBtn.addEventListener("click", async () => {
    if (!confirm("Log out on every device where you're currently signed in?")) return;
    try {
      await fetch("/api/auth/logout-all", { method: "POST" });
    } finally {
      window.location.reload();
    }
  });
  els.deleteAccountBtn.addEventListener("click", async () => {
    if (!confirm("Permanently delete your account, all your chats, and everything you've shared? This can't be undone.")) return;
    if (!confirm("Are you absolutely sure? This is your last chance to back out.")) return;
    try {
      await fetch("/api/auth/account", { method: "DELETE" });
    } finally {
      window.location.reload();
    }
  });

  // Settings tabs
  els.modalNavBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      els.modalNavBtns.forEach((b) => b.classList.toggle("active", b === btn));
      els.modalPanels.forEach((p) => p.classList.toggle("active", p.dataset.panel === btn.dataset.tab));
    });
  });

  // Theme switcher
  els.themeOpts.forEach((btn) => {
    btn.addEventListener("click", () => {
      const choice = btn.dataset.themeChoice;
      saveJSON(STORAGE.theme, choice);
      applyTheme(choice);
    });
  });

  // Display name (synced to the account)
  if (els.displayNameInput) {
    els.displayNameInput.addEventListener("change", async () => {
      const name = els.displayNameInput.value.trim();
      if (!name) {
        els.displayNameInput.value = state.displayName;
        return;
      }
      try {
        const res = await fetch("/api/auth/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName: name }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Couldn't update your name.");
        state.user = data.user;
        applyDisplayName(data.user.displayName);
      } catch (err) {
        alert(err.message);
        els.displayNameInput.value = state.displayName;
      }
    });
  }

  // Export all chats as a single JSON file
  els.exportDataBtn.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state.threads, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `synthara-chats-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Share the active thread
  els.shareChatBtn.addEventListener("click", shareActiveThread);
  els.closeShareBtn.addEventListener("click", () => els.shareOverlay.classList.remove("open"));
  els.shareOverlay.addEventListener("click", (e) => {
    if (e.target === els.shareOverlay) els.shareOverlay.classList.remove("open");
  });
  els.copyShareLinkBtn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(els.shareLinkInput.value);
    els.copyShareLinkBtn.textContent = "Copied!";
    setTimeout(() => (els.copyShareLinkBtn.textContent = "Copy"), 1400);
  });
}

async function shareActiveThread() {
  const thread = getActiveThread();
  if (!thread || !thread.messages.length) {
    alert("Start a conversation before sharing it.");
    return;
  }
  els.shareChatBtn.disabled = true;
  try {
    const res = await fetch("/api/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: thread.title, messages: thread.messages }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Couldn't create a share link.");

    els.shareLinkInput.value = data.url;
    els.shareModalSub.textContent = "Anyone with this link can view a read-only copy of this conversation.";
    els.shareOverlay.classList.add("open");
  } catch (err) {
    alert(err.message);
  } finally {
    els.shareChatBtn.disabled = false;
  }
}

function autoGrowTextarea() {
  const ta = els.composerInput;
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, 180) + "px";
}
