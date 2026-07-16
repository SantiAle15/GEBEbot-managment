import * as state from "./state.js";
import * as api from "./api.js";
import * as physics from "./physics.js";

let onSyncRequest = () => {};
export function setSyncHandler(fn) { onSyncRequest = fn; }

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function getToday() { return new Date().toISOString().split('T')[0]; }

export function initTasks() {
  document.getElementById("btn-add-task")?.addEventListener("click", () => openItemModal(null, 'task'));
  document.getElementById("btn-add-habit")?.addEventListener("click", () => openItemModal(null, 'habit'));
  document.getElementById("btn-add-reminder")?.addEventListener("click", () => openItemModal(null, 'reminder'));

  document.getElementById("form-task")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const type = document.getElementById("task-type").value;
    const id = document.getElementById("task-id").value;
    const title = document.getElementById("task-title").value.trim();
    const description = document.getElementById("task-description").value.trim();
    const date = document.getElementById("task-date").value;
    const timeStart = document.getElementById("task-time-start").value;
    const timeEnd = document.getElementById("task-time-end").value;
    const category = document.getElementById("task-category").value;
    const recurrence = document.getElementById("task-recurrence").value;

    if (!title) return;

    if (type === "task") {
      if (id) {
        state.updateTask(id, { title, description, date, timeStart, timeEnd, category, recurrence });
      } else {
        state.addTask({ id: generateId(), title, description, date, timeStart, timeEnd, category, recurrence, completed: false, isNew: true, createdAt: new Date().toISOString() });
        playStopStickerAnimation(title, 'task');
      }
    } else if (type === "habit") {
      if (id) {
        state.updateHabit(id, { title, description, startDate: date, timeStart, timeEnd, category, recurrence });
      } else {
        state.addHabit({ id: generateId(), title, description, startDate: date, timeStart, timeEnd, category, recurrence, completedDates: [], streak: 0, isNew: true, createdAt: new Date().toISOString() });
        playStopStickerAnimation(title, 'habit');
      }
    } else if (type === "reminder") {
      if (id) {
        state.updateReminder(id, { title, description });
      } else {
        state.addReminder({ id: generateId(), title, description, isNew: true, createdAt: new Date().toISOString() });
        playStopStickerAnimation(title, 'reminder');
      }
    }

    document.getElementById("modal-task").close();
    await onSyncRequest();
  });

  document.getElementById("btn-task-cancel")?.addEventListener("click", () => {
    document.getElementById("modal-task").close();
  });

  document.getElementById("btn-task-delete")?.addEventListener("click", async () => {
    const type = document.getElementById("task-type").value;
    const id = document.getElementById("task-id").value;
    if (confirm("¿Eliminar este elemento?")) {
      if (type === "task") state.removeTask(id);
      else if (type === "habit") state.removeHabit(id);
      else if (type === "reminder") state.removeReminder(id);
      document.getElementById("modal-task").close();
      await onSyncRequest();
    }
  });

  state.subscribe(() => {
    renderStickers('task');
    renderStickers('habit');
    renderStickers('reminder');
  });
}

function updateModalHeader(type) {
  const headerTag = document.querySelector(".modal-header-tag");
  const tagTitle = headerTag?.querySelector(".tag-title");
  const tagSubtitle = headerTag?.querySelector(".tag-subtitle");
  if (!headerTag || !tagTitle || !tagSubtitle) return;
  headerTag.classList.remove("task", "habit", "reminder");
  headerTag.classList.add(type);
  tagTitle.textContent = "¡HOLA!";
  if (type === "task") tagSubtitle.textContent = "Mi tarea es...";
  else if (type === "habit") tagSubtitle.textContent = "Mi hábito es...";
  else if (type === "reminder") tagSubtitle.textContent = "Mi recordatorio es...";
}

export function openItemModal(item = null, type = 'task') {
  const modal = document.getElementById("modal-task");
  const form = document.getElementById("form-task");
  const deleteBtn = document.getElementById("btn-task-delete");
  if (!modal || !form) return;
  form.reset();
  document.getElementById("task-type").value = type;
  updateModalHeader(type);

  if (item) {
    document.getElementById("task-id").value = item.id;
    document.getElementById("task-title").value = item.title;
    document.getElementById("task-description").value = item.description || "";
    document.getElementById("task-date").value = item.date || item.startDate || getToday();
    document.getElementById("task-time-start").value = item.timeStart || "";
    document.getElementById("task-time-end").value = item.timeEnd || "";
    document.getElementById("task-category").value = item.category || "personal";
    document.getElementById("task-recurrence").value = item.recurrence || "none";
    deleteBtn.classList.remove("hidden");
    setupCompleteButton(item, type);   // botón "Completar"
  } else {
    document.getElementById("task-id").value = "";
    document.getElementById("task-date").value = getToday();
    if (type === 'habit') document.getElementById("task-recurrence").value = "daily";
    deleteBtn.classList.add("hidden");
    removeCompleteButton();
  }
  modal.showModal();
}

// Inserta (o actualiza) un botón "Completar" en el modal.
// Al completar: marca en el estado, notifica al GEBE-BOT (que premia a la
// mascota según la carga del día) y guarda en Firebase.
function setupCompleteButton(item, type) {
  if (type === 'reminder') { removeCompleteButton(); return; }

  const actions = document.querySelector("#form-task .modal-actions")
               || document.querySelector("#modal-task .modal-actions");
  if (!actions) return;

  let btn = document.getElementById("btn-task-complete");
  if (!btn) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.id = "btn-task-complete";
    btn.className = "btn btn-primary";
    actions.insertBefore(btn, actions.firstChild);
  }

  // Estado actual de completado
  let done = false;
  if (type === 'task') {
    done = !!item.completed;
  } else if (type === 'habit') {
    const today = new Date().toISOString().slice(0, 10);
    done = item.completedDates?.includes(today);
  }

  btn.textContent = done ? "✓ COMPLETADO" : "COMPLETAR";
  btn.style.opacity = done ? "0.6" : "1";

  btn.onclick = async () => {
    if (type === 'task') {
      const t = state.toggleTask(item.id);
      if (t && t.completed) {
        try { await api.notifyTaskComplete(); } catch (e) {}
      }
    } else if (type === 'habit') {
      const h = state.toggleHabitToday(item.id);
      const today = new Date().toISOString().slice(0, 10);
      if (h && h.completedDates?.includes(today)) {
        try { await api.notifyHabitComplete(); } catch (e) {}
      }
    }
    onSyncRequest();   // guarda en Firebase
    document.getElementById("modal-task").close();
    renderStickers(type);
  };
}

function removeCompleteButton() {
  const btn = document.getElementById("btn-task-complete");
  if (btn) btn.remove();
}

function playStopStickerAnimation(text, type) {
  const overlay = document.getElementById('sticker-overlay');
  const stickerText = document.getElementById('anim-sticker-text');
  const sticker = document.getElementById('anim-sticker');
  if (!overlay || !stickerText || !sticker) return;
  stickerText.textContent = text;
  const colors = { task: '#4CAF50', habit: '#FFC107', reminder: '#2196F3' };
  sticker.style.borderLeftColor = colors[type] || '#4CAF50';
  overlay.classList.add('active');
  setTimeout(() => overlay.classList.remove('active'), 2500);
}

export function renderStickers(type) {
  const containerId = type === 'task' ? 'sticker-container-tasks' :
                      type === 'habit' ? 'sticker-container-habits' :
                      'sticker-container-reminders';
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";

  let items = [];
  if (type === 'task') items = state.getTasks();
  else if (type === 'habit') items = state.getHabits();
  else if (type === 'reminder') items = state.getReminders();

  const entries = [];
  items.forEach((item) => {
    const sticker = createStickerElement(item, type);
    container.appendChild(sticker);
    entries.push({ el: sticker, item, type });
  });

  // El DOM ya está montado: ahora sí podemos medir cada sticker y
  // crear su cuerpo físico con el tamaño real.
  requestAnimationFrame(() => {
    physics.syncBoard(containerId, container, entries);
  });
}

function createStickerElement(item, type) {
  const sticker = document.createElement("div");
  sticker.className = "sticker";
  sticker.dataset.id = item.id;
  sticker.dataset.type = type;

  sticker.style.setProperty('--sticker-color', item.colorHSL);
  // La posición y rotación las escribe physics.js (translate(-50%,-50%) + rotate)

  // Dobleces desactivados (se veían artificiales). Solo arrugas: 6 tipos.
  if (item.wrinklePattern > 0 && item.wrinklePattern <= 6) {
    sticker.classList.add(`sticker-wrinkles-${item.wrinklePattern}`);
  }

  // Marca visual de completado
  let isDone = false;
  if (type === 'task') {
    isDone = !!item.completed;
  } else if (type === 'habit') {
    const today = new Date().toISOString().slice(0, 10);
    isDone = item.completedDates?.includes(today);
  }
  if (isDone) sticker.classList.add('sticker-completed');

  const header = document.createElement("div");
  header.className = "sticker-header";
  const title = document.createElement("h3");
  title.className = "sticker-title";
  // OJO: Reticulum3.ttf no tiene el glifo "¡" (U+00A1) y renderiza basura.
  // Metemos la puntuación en spans aparte para que caigan a la fuente de respaldo.
  title.innerHTML = '<span class="punct">¡</span>HOLA<span class="punct">!</span>';
  const subtitle = document.createElement("div");
  subtitle.className = "sticker-subtitle";
  subtitle.textContent = type === 'task' ? "Mi tarea es..." : type === 'habit' ? "Mi hábito es..." : "Mi recordatorio es...";
  header.appendChild(title);
  header.appendChild(subtitle);

  const body = document.createElement("div");
  body.className = "sticker-body";
  const text = document.createElement("div");
  text.className = "sticker-text";
  text.textContent = item.title;
  body.appendChild(text);

  if (type !== 'reminder' && (item.date || item.startDate || item.timeStart)) {
    const meta = document.createElement("div");
    meta.className = "sticker-meta";
    if (item.date || item.startDate) {
      const dateSpan = document.createElement("span");
      dateSpan.textContent = `📅 ${formatDate(item.date || item.startDate)}`;
      meta.appendChild(dateSpan);
    }
    if (item.timeStart) {
      const timeSpan = document.createElement("span");
      timeSpan.textContent = `⏰ ${formatTimeRange(item.timeStart, item.timeEnd)}`;
      meta.appendChild(timeSpan);
    }
    if (type === 'habit' && item.streak) {
      const streakSpan = document.createElement("span");
      streakSpan.textContent = `🔥 ${item.streak}`;
      meta.appendChild(streakSpan);
    }
    body.appendChild(meta);
  }

  const footer = document.createElement("div");
  footer.className = "sticker-footer";
  sticker.appendChild(header);
  sticker.appendChild(body);
  sticker.appendChild(footer);

  // Matter.js (MouseConstraint) captura el pointerdown para arrastrar, y
  // eso hace que el evento "click" del DOM a veces NO se dispare. Por eso
  // NO dependemos de "click": medimos nosotros mismos el desplazamiento
  // entre pointerdown y pointerup. Si casi no se movió → es un tap limpio
  // → abrimos el modal. Si se movió → fue arrastre → no hacemos nada.
  let downX = 0, downY = 0, downT = 0;

  sticker.addEventListener("pointerdown", (e) => {
    downX = e.clientX;
    downY = e.clientY;
    downT = Date.now();
  });

  sticker.addEventListener("pointerup", (e) => {
    const dist = Math.hypot(e.clientX - downX, e.clientY - downY);
    const dt = Date.now() - downT;

    // Umbral: menos de 6px de movimiento y menos de 400ms = tap
    if (dist < 6 && dt < 400) {
      sticker.classList.add('clicked');
      setTimeout(() => sticker.classList.remove('clicked'), 400);
      setTimeout(() => openItemModal(item, type), 120);
    }
  });

  return sticker;
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

function formatTimeRange(timeStart, timeEnd) {
  if (!timeStart) return "";
  if (timeEnd) return `${timeStart} - ${timeEnd}`;
  return timeStart;
}
