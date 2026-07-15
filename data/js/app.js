import { POLL_INTERVAL_MS } from "./config.js";
import * as auth from "./auth.js";
import * as api from "./api.js";
import * as state from "./state.js";
import { initTasks, setSyncHandler, renderStickers } from "./tasks.js";
import * as physics from "./physics.js";
import { initCalendar } from "./calendar.js";

const $ = (sel) => document.querySelector(sel);

let pollTimer = null;

function getAuthMode() {
  return document.getElementById("auth-mode")?.value || "login";
}

function setAuthMode(mode) {
  const input = document.getElementById("auth-mode");
  if (input) input.value = mode;

  document.querySelectorAll(".auth-tab").forEach((tab) => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });

  const label = document.getElementById("auth-submit-label");
  if (label) {
    label.textContent = mode === "register" ? "Crear cuenta" : "Entrar al mando";
  }

  const errorEl = document.getElementById("login-error");
  errorEl?.classList.add("hidden");
}

function showScreen(name) {
  document.querySelectorAll(".screen").forEach((s) => {
    s.classList.toggle("active", s.id === `screen-${name}`);
  });
}

function setSyncState(stateName) {
  const indicator = $("#sync-indicator");
  if (indicator) indicator.dataset.state = stateName;
}

function setConnectionState(stateName, message) {
  // Actualizar texto del header principal
  const el = $("#connection-status");
  if (el) {
    el.dataset.state = stateName;
    el.textContent = message;
  }
  
  // Actualizar también el nuevo panel de GEBE-BOT
  const gebebotDot = document.getElementById('gebebot-connection-dot');
  const gebebotText = document.getElementById('gebebot-connection-text');
  
  if (gebebotDot) {
    gebebotDot.className = `connection-indicator ${stateName}`;
  }
  if (gebebotText) {
    gebebotText.textContent = stateName === 'online' ? 'Conectado al GEBE-BOT' : 'Desconectado';
  }
}

function updateStats(data) {
  const bars = {
    hunger: data.hunger ?? data.hambre ?? 0,
    happiness: data.happiness ?? data.felicidad ?? 0,
    health: data.health ?? data.salud ?? 0,
  };

  // Actualizar barras del header principal
  for (const [key, val] of Object.entries(bars)) {
    const bar = document.getElementById(`bar-${key}`);
    const label = document.getElementById(`val-${key}`);
    const pct = Math.max(0, Math.min(100, Number(val)));

    if (bar) bar.style.width = `${pct}%`;
    if (label) label.textContent = String(Math.round(pct));
  }
  
  // Actualizar labels del nuevo panel de GEBE-BOT
  const gebebotHunger = document.getElementById('gebebot-hunger');
  const gebebotHappiness = document.getElementById('gebebot-happiness');
  const gebebotHealth = document.getElementById('gebebot-health');
  
  if (gebebotHunger) gebebotHunger.textContent = `${Math.round(bars.hunger)}%`;
  if (gebebotHappiness) gebebotHappiness.textContent = `${Math.round(bars.happiness)}%`;
  if (gebebotHealth) gebebotHealth.textContent = `${Math.round(bars.health)}%`;
}

async function pollStatus() {
  const user = state.getUsername();
  if (!user) return;

  try {
    const data = await api.fetchStatus(user);
    updateStats(data);
    setConnectionState("online", `Conectado · GEBE-BOT ${data.alive === false ? "💀" : "activo"}`);
  } catch {
    setConnectionState("offline", "Sin conexión con gebebot.local");
  }
}

async function syncToDevice() {
  const user = state.getUsername();
  if (!user) return;

  setSyncState("syncing");

  try {
    // Sincronizar los 3 tipos de elementos
    await api.saveUser(user, state.getTasks(), state.getHabits(), state.getReminders());
    setSyncState("ok");
    setTimeout(() => setSyncState("idle"), 2000);
  } catch (err) {
    setSyncState("error");
    if (err.status === 401) forceLogout("Sesión expirada. Vuelve a entrar.");
    setTimeout(() => setSyncState("idle"), 3000);
  }
}

async function loadUserData(user) {
  setConnectionState("connecting", "Cargando tu cuenta…");
  try {
    const data = await api.fetchUser(user);
    state.loadFromServer(data);
    setConnectionState("online", "Cuenta sincronizada");
  } catch (err) {
    if (err.status === 401) {
      forceLogout("Sesión inválida. Inicia sesión de nuevo.");
      throw err;
    }
    setConnectionState("offline", "Sin conexión con el GEBE-BOT");
  }
}

function forceLogout(message) {
  stopPolling();
  auth.logout();
  showScreen("login");
  $("#username").value = "";
  $("#password").value = "";

  const errorEl = $("#login-error");
  if (errorEl && message) {
    errorEl.textContent = message;
    errorEl.classList.remove("hidden");
  }
}

let unsubStatus = null;
let unsubDevice = null;

// Antes: preguntábamos al ESP32 cada 5 seg (polling).
// Ahora: Firebase nos AVISA en cuanto cambian las stats (tiempo real).
function startPolling() {
  stopPolling();

  unsubStatus = api.subscribeStatus((pet, err) => {
    if (err) {
      setConnectionState("offline", "Sin conexión con la nube");
      return;
    }
    updateStats(pet);
    setConnectionState("online",
      `Sincronizado · GEBE-BOT ${pet.alive === false ? "💀" : "activo"}`);
  });

  // Además, detectamos si el bot físico está encendido
  unsubDevice = api.subscribeDeviceOnline((online) => {
    const el = document.getElementById("gebebot-connection-text");
    if (el) el.textContent = online ? "GEBE-BOT encendido" : "GEBE-BOT apagado";
    const dot = document.getElementById("gebebot-connection-dot");
    if (dot) dot.className = `connection-indicator ${online ? "online" : "offline"}`;
  });
}

function stopPolling() {
  if (unsubStatus) { unsubStatus(); unsubStatus = null; }
  if (unsubDevice) { unsubDevice(); unsubDevice = null; }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

const TAB_ORDER = ["tasks", "habits", "reminders", "calendar", "gebebot"];

const TAB_COLORS = {
  tasks: "#4CAF50",
  habits: "#FFC107",
  reminders: "#2196F3",
  calendar: "#f44336",
  gebebot: "#FF9800",
};

// Solo estas 3 pestañas tienen stickers arrastrables
const STICKER_CONTAINERS = {
  tasks: "sticker-container-tasks",
  habits: "sticker-container-habits",
  reminders: "sticker-container-reminders",
};

let currentTab = "tasks";
let tabIsAnimating = false;

function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const bigint = parseInt(h, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Pinta las flechas con el color de la pestaña a la que llevarían
function updateArrowColors(target) {
  const idx = TAB_ORDER.indexOf(target);
  const nextTab = TAB_ORDER[(idx + 1) % TAB_ORDER.length];
  const prevTab = TAB_ORDER[(idx - 1 + TAB_ORDER.length) % TAB_ORDER.length];
  const root = document.documentElement.style;
  root.setProperty("--arrow-prev-color", hexToRgba(TAB_COLORS[prevTab], 0.55));
  root.setProperty("--arrow-prev-color-solid", TAB_COLORS[prevTab]);
  root.setProperty("--arrow-next-color", hexToRgba(TAB_COLORS[nextTab], 0.55));
  root.setProperty("--arrow-next-color-solid", TAB_COLORS[nextTab]);
}

function updateDots(target) {
  document.querySelectorAll(".tab-dot").forEach((dot) => {
    const active = dot.dataset.tab === target;
    dot.classList.toggle("active", active);
    dot.setAttribute("aria-selected", active ? "true" : "false");
  });
}

// Empujón FÍSICO real al cambiar de pestaña: los stickers se mueven,
// chocan entre sí y se acomodan solos (antes era una animación falsa).
function jiggleStickers(tabName, intensity = 1) {
  const containerId = STICKER_CONTAINERS[tabName];
  if (!containerId) return;
  physics.nudgeBoard(containerId, intensity);
}

function switchTab(target, directionHint) {
  if (!target || target === currentTab || tabIsAnimating) return;

  const fromPanel = document.getElementById(`panel-${currentTab}`);
  const toPanel = document.getElementById(`panel-${target}`);
  if (!fromPanel || !toPanel) return;

  const fromIdx = TAB_ORDER.indexOf(currentTab);
  const toIdx = TAB_ORDER.indexOf(target);
  const direction = directionHint || (toIdx > fromIdx ? "next" : "prev");

  tabIsAnimating = true;
  jiggleStickers(currentTab, 1);

  // Coloca el panel entrante fuera de pantalla sin transición
  toPanel.style.transition = "none";
  toPanel.classList.remove("slide-in-left", "slide-in-right", "slide-out-left", "slide-out-right");
  toPanel.classList.add(direction === "next" ? "slide-in-right" : "slide-in-left");
  void toPanel.offsetWidth; // fuerza reflow
  toPanel.style.transition = "";

  requestAnimationFrame(() => {
    fromPanel.classList.remove("active");
    fromPanel.classList.add(direction === "next" ? "slide-out-left" : "slide-out-right");

    toPanel.classList.remove("slide-in-left", "slide-in-right");
    toPanel.classList.add("active");
  });

  let safety;
  const finish = () => {
    fromPanel.classList.remove("slide-out-left", "slide-out-right");
    toPanel.removeEventListener("transitionend", onTransitionEnd);
    clearTimeout(safety);
    tabIsAnimating = false;
    currentTab = target;
    updateArrowColors(target);
    updateDots(target);

    // Solo simula el tablero visible (ahorra CPU)
    const cid = STICKER_CONTAINERS[target];
    if (cid) physics.activateBoard(cid);

    jiggleStickers(target, 0.55);
  };

  function onTransitionEnd(e) {
    if (e.target !== toPanel || e.propertyName !== "transform") return;
    finish();
  }

  toPanel.addEventListener("transitionend", onTransitionEnd);
  safety = setTimeout(finish, 600);
}

function initTabs() {
  updateArrowColors(currentTab);
  updateDots(currentTab);

  document.getElementById("tab-arrow-prev")?.addEventListener("click", () => {
    const idx = TAB_ORDER.indexOf(currentTab);
    const prevTab = TAB_ORDER[(idx - 1 + TAB_ORDER.length) % TAB_ORDER.length];
    switchTab(prevTab, "prev");
  });

  document.getElementById("tab-arrow-next")?.addEventListener("click", () => {
    const idx = TAB_ORDER.indexOf(currentTab);
    const nextTab = TAB_ORDER[(idx + 1) % TAB_ORDER.length];
    switchTab(nextTab, "next");
  });

  document.querySelectorAll(".tab-dot").forEach((dot) => {
    dot.addEventListener("click", () => switchTab(dot.dataset.tab));
  });
}

function initAuthTabs() {
  document.querySelectorAll(".auth-tab").forEach((tab) => {
    tab.addEventListener("click", (e) => {
      e.preventDefault();
      setAuthMode(tab.dataset.mode || "login");
    });
  });
}

async function enterDashboard(username) {
  $("#display-username").textContent = username;
  showScreen("dashboard");
  await loadUserData(username);
  
  // Renderizar todos los tipos de stickers en sus respectivos tableros
  renderStickers('task');
  renderStickers('habit');
  renderStickers('reminder');

  // Arranca la física en el tablero visible
  requestAnimationFrame(() => {
    physics.activateBoard(STICKER_CONTAINERS[currentTab]);
  });

  startPolling();
  await syncToDevice();
}

function initLogin() {
  const form = $("#login-form");
  const errorEl = $("#login-error");

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl?.classList.add("hidden");

    const userInput = $("#username");
    const passInput = $("#password");
    const submitBtn = $("#auth-submit");

    try {
      submitBtn.disabled = true;
      const mode = getAuthMode();

      const user =
        mode === "register"
          ? await auth.register(userInput.value, passInput.value)
          : await auth.login(userInput.value, passInput.value);

      passInput.value = "";
      await enterDashboard(user);
    } catch (err) {
      if (errorEl) {
        if (err.message === "Failed to fetch") {
          errorEl.textContent = "No se pudo conectar con el GEBE-BOT. ¿Estás en la misma Wi-Fi?";
        } else {
          errorEl.textContent = err.message || "Error de autenticación";
        }
        errorEl.classList.remove("hidden");
      }
    } finally {
      submitBtn.disabled = false;
    }
  });
}

function initDashboardActions() {
  $("#btn-logout")?.addEventListener("click", () => {
    stopPolling();
    auth.logout();
    showScreen("login");
    $("#username").value = "";
    $("#password").value = "";
  });

  $("#btn-sync")?.addEventListener("click", async () => {
    pollStatus();
    try {
      await loadUserData(state.getUsername());
      renderStickers('task');
      renderStickers('habit');
      renderStickers('reminder');
      setSyncState("ok");
    } catch {
      setSyncState("error");
    }
    setTimeout(() => setSyncState("idle"), 2000);
  });
}


// ═══════════════════════════════════════════════════════════
//  MANCHAS DE TINTA AL INTERACTUAR
//  Salpica al hacer click en botones, tabs, celdas del calendario.
// ═══════════════════════════════════════════════════════════
const INK_COLORS = ["#9bf300", "#ff2d94", "#00e5ff", "#ff6b00", "#7b2fff"];

function inkSplatAt(x, y, color) {
  const c = color || INK_COLORS[Math.floor(Math.random() * INK_COLORS.length)];

  const splat = document.createElement("div");
  splat.className = "ink-splat";
  splat.style.left = `${x}px`;
  splat.style.top = `${y}px`;
  splat.style.background = c;
  splat.style.setProperty("--spin", `${Math.random() * 360}deg`);
  const size = 70 + Math.random() * 70;
  splat.style.width = `${size}px`;
  splat.style.height = `${size}px`;
  document.body.appendChild(splat);
  setTimeout(() => splat.remove(), 700);

  const drops = 4 + Math.floor(Math.random() * 4);
  for (let i = 0; i < drops; i++) {
    const d = document.createElement("div");
    d.className = "ink-drop";
    const r = 4 + Math.random() * 8;
    const ang = Math.random() * Math.PI * 2;
    const dist = 30 + Math.random() * 55;
    d.style.left = `${x}px`;
    d.style.top = `${y}px`;
    d.style.width = `${r}px`;
    d.style.height = `${r}px`;
    d.style.background = c;
    d.style.setProperty("--dx", `${Math.cos(ang) * dist}px`);
    d.style.setProperty("--dy", `${Math.sin(ang) * dist}px`);
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 820);
  }
}

function initInkSplats() {
  const COLOR_BY = [
    [".btn-primary, .tab-tasks, #btn-add-task", "#9bf300"],
    [".btn-danger, .tab-calendar", "#ff2d94"],
    [".tab-reminders, #btn-add-reminder", "#00e5ff"],
    [".tab-habits, #btn-add-habit", "#ff6b00"],
    [".tab-gebebot", "#7b2fff"],
  ];

  document.addEventListener("pointerdown", (e) => {
    const el = e.target.closest(
      "button, .btn, .tab, .tab-dot, .tab-arrow, .cal-day:not(.empty), .auth-tab"
    );
    if (!el || el.disabled) return;

    let color = null;
    for (const [sel, c] of COLOR_BY) {
      if (el.matches(sel)) { color = c; break; }
    }
    inkSplatAt(e.clientX, e.clientY, color);
  }, { passive: true });
}

function bootstrap() {
  initAuthTabs();
  initLogin();
  initTabs();
  initTasks();
  initCalendar();
  initDashboardActions();

  setSyncHandler(syncToDevice);
  physics.setSyncCallback(syncToDevice);
  initInkSplats();

  const session = auth.restoreSession();
  if (session) {
    enterDashboard(session.user).catch(() => showScreen("login"));
  } else {
    showScreen("login");
  }
}

document.addEventListener("DOMContentLoaded", bootstrap);