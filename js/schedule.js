// ═══════════════════════════════════════════════════════════
//  HORARIO ESCOLAR
//  Vive dentro de la pestaña Calendario, con un interruptor
//  MES / HORARIO y dos vistas: SEMANA (cuadrícula) y DÍA (lista).
//
//  Cada clase: { id, materia, salon, dias[], horaInicio, horaFin, color }
//  dias: 1=Lunes ... 6=Sábado
// ═══════════════════════════════════════════════════════════

let classes = [];
let onSyncRequest = () => {};
export function setScheduleSyncHandler(fn) { onSyncRequest = fn; }

const DAY_LABELS = ["", "LUN", "MAR", "MIE", "JUE", "VIE", "SAB"];
const DAY_SHORT  = ["", "L", "M", "X", "J", "V", "S"];
const HOUR_PX = 52;          // alto de una hora en la cuadrícula
const DEFAULT_COLOR = "#9bf300";

let editingDays = [];
let editingColor = DEFAULT_COLOR;
let subView = "week";
let selectedDay = 0;   // 0 = usar el dia de hoy

// ─────────────────────────────────────────────
//  CARGA / GUARDADO
// ─────────────────────────────────────────────
export function loadSchedule(data) {
  classes = Array.isArray(data) ? data : [];
  render();
}
export function getScheduleData() { return classes; }
export function getClasses() { return classes; }

// Clases de un día concreto (1..6), ordenadas por hora
export function getClassesForDay(day) {
  return classes
    .filter((c) => (c.dias || []).includes(day))
    .sort((a, b) => (a.horaInicio || "").localeCompare(b.horaInicio || ""));
}

// La siguiente clase de hoy (para el GEBE-BOT / pomodoro)
export function getNextClass() {
  const now = new Date();
  let day = now.getDay();            // 0=domingo
  if (day === 0) return null;
  const hhmm = String(now.getHours()).padStart(2, "0") + ":" +
               String(now.getMinutes()).padStart(2, "0");
  return getClassesForDay(day).find((c) => (c.horaInicio || "") > hhmm) || null;
}

// ─────────────────────────────────────────────
//  INICIALIZACIÓN
// ─────────────────────────────────────────────
export function initSchedule() {
  // Interruptor MES / HORARIO
  document.querySelectorAll(".cal-mode").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".cal-mode").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const esHorario = btn.dataset.mode === "schedule";
      document.getElementById("cal-view-month").classList.toggle("hidden", esHorario);
      document.getElementById("cal-view-schedule").classList.toggle("hidden", !esHorario);
      if (esHorario) render();
    });
  });

  // Interruptor SEMANA / DÍA
  document.querySelectorAll(".sched-sub").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".sched-sub").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      subView = btn.dataset.sub;
      render();
    });
  });

  const addBtn = document.getElementById("btn-add-class");
  if (addBtn) addBtn.addEventListener("click", () => openClassModal(null));

  setupClassModal();
}

// ─────────────────────────────────────────────
//  RENDER
// ─────────────────────────────────────────────
function render() {
  const week = document.getElementById("sched-week");
  const day  = document.getElementById("sched-day");
  if (!week || !day) return;

  week.classList.toggle("hidden", subView !== "week");
  day.classList.toggle("hidden", subView !== "day");

  if (subView === "week") renderWeek(week);
  else                    renderDay(day, selectedDay || todayDay());
}

// Rango horario que abarcan las clases (con margen)
function hourRange() {
  if (!classes.length) return { min: 7, max: 15 };
  let min = 23, max = 0;
  classes.forEach((c) => {
    const h1 = parseInt((c.horaInicio || "07:00").slice(0, 2), 10);
    const h2 = Math.ceil(toMinutes(c.horaFin || "08:00") / 60);
    if (h1 < min) min = h1;
    if (h2 > max) max = h2;
  });
  if (max <= min) max = min + 1;
  return { min, max };
}

function toMinutes(hhmm) {
  const [h, m] = (hhmm || "0:0").split(":").map(Number);
  return h * 60 + (m || 0);
}

function renderWeek(cont) {
  const { min, max } = hourRange();
  const totalH = (max - min) * HOUR_PX;

  let html = '<div class="sw-grid">';

  // Columna de horas
  html += '<div class="sw-hours" style="height:' + totalH + 'px">';
  for (let h = min; h < max; h++) {
    html += '<div class="sw-hour" style="height:' + HOUR_PX + 'px">' +
            String(h).padStart(2, "0") + ':00</div>';
  }
  html += "</div>";

  // Una columna por día (L a V; sábado solo si hay clases)
  const haySabado = classes.some((c) => (c.dias || []).includes(6));
  const ultimoDia = haySabado ? 6 : 5;

  for (let d = 1; d <= ultimoDia; d++) {
    html += '<div class="sw-day">';
    html += '<div class="sw-day-head">' + DAY_SHORT[d] + "</div>";
    html += '<div class="sw-col" style="height:' + totalH + 'px">';

    // Líneas de hora
    for (let h = min; h < max; h++) {
      html += '<div class="sw-line" style="top:' + ((h - min) * HOUR_PX) + 'px"></div>';
    }

    // Bloques de clase
    getClassesForDay(d).forEach((c) => {
      const top = ((toMinutes(c.horaInicio) - min * 60) / 60) * HOUR_PX;
      const alto = Math.max(
        26,
        ((toMinutes(c.horaFin) - toMinutes(c.horaInicio)) / 60) * HOUR_PX - 3
      );
      const rot = ((c.id || "").charCodeAt(0) % 3) - 1;   // -1, 0 o 1 grado
      html +=
        '<div class="sw-class" data-id="' + c.id + '" style="' +
        "top:" + top + "px;height:" + alto + "px;" +
        "background:" + (c.color || DEFAULT_COLOR) + ";" +
        "transform:rotate(" + rot + "deg)\">" +
        '<span class="swc-name">' + escapeHtml(c.materia) + "</span>" +
        (c.salon ? '<span class="swc-room">' + escapeHtml(c.salon) + "</span>" : "") +
        "</div>";
    });

    html += "</div></div>";
  }
  html += "</div>";

  if (!classes.length) {
    html += '<p class="sched-empty">Sin clases todavia. Toca <b>+ CLASE</b> para agregar tu horario.</p>';
  }

  cont.innerHTML = html;
  cont.querySelectorAll(".sw-class").forEach((el) => {
    el.addEventListener("click", () => {
      const c = classes.find((x) => x.id === el.dataset.id);
      if (c) openClassModal(c);
    });
  });
}

function todayDay() {
  const d = new Date().getDay();
  return d === 0 ? 1 : d;                 // domingo -> mostrar lunes
}

function renderDay(cont, hoy) {
  let html = '<div class="sd-daybar">';
  for (let d = 1; d <= 6; d++) {
    html += '<button class="sd-day' + (d === hoy ? " active" : "") +
            '" data-day="' + d + '">' + DAY_SHORT[d] + "</button>";
  }
  html += "</div>";

  const lista = getClassesForDay(hoy);
  html += '<div class="sd-list">';
  if (!lista.length) {
    html += '<p class="sched-empty">Sin clases el ' + DAY_LABELS[hoy] + ".</p>";
  } else {
    lista.forEach((c) => {
      html +=
        '<div class="sd-item" data-id="' + c.id + '" style="border-left-color:' +
        (c.color || DEFAULT_COLOR) + '">' +
        '<div class="sd-time">' + (c.horaInicio || "") + "<span>" + (c.horaFin || "") + "</span></div>" +
        '<div class="sd-info"><div class="sd-name">' + escapeHtml(c.materia) + "</div>" +
        (c.salon ? '<div class="sd-room">' + escapeHtml(c.salon) + "</div>" : "") +
        "</div></div>";
    });
  }
  html += "</div>";

  cont.innerHTML = html;

  cont.querySelectorAll(".sd-day").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedDay = parseInt(btn.dataset.day, 10);
      renderDay(cont, selectedDay);
    });
  });
  cont.querySelectorAll(".sd-item").forEach((el) => {
    el.addEventListener("click", () => {
      const c = classes.find((x) => x.id === el.dataset.id);
      if (c) openClassModal(c);
    });
  });
}

// ─────────────────────────────────────────────
//  MODAL DE CLASE
// ─────────────────────────────────────────────
function setupClassModal() {
  const modal = document.getElementById("modal-class");
  if (!modal) return;

  modal.querySelectorAll(".cday").forEach((btn) => {
    btn.addEventListener("click", () => {
      const d = parseInt(btn.dataset.day, 10);
      if (editingDays.includes(d)) {
        editingDays = editingDays.filter((x) => x !== d);
        btn.classList.remove("on");
      } else {
        editingDays.push(d);
        btn.classList.add("on");
      }
    });
  });

  const colorInput = document.getElementById("class-color");

  // El selector libre (gradiente del sistema) manda
  if (colorInput) {
    colorInput.addEventListener("input", () => {
      editingColor = colorInput.value;
      modal.querySelectorAll(".ccolor").forEach((b) =>
        b.classList.toggle("on", b.dataset.color.toLowerCase() === editingColor.toLowerCase()));
    });
  }

  // Los atajos solo rellenan el selector libre
  modal.querySelectorAll(".ccolor").forEach((btn) => {
    btn.addEventListener("click", () => {
      editingColor = btn.dataset.color;
      if (colorInput) colorInput.value = editingColor;
      modal.querySelectorAll(".ccolor").forEach((b) => b.classList.remove("on"));
      btn.classList.add("on");
    });
  });

  document.getElementById("btn-class-cancel").addEventListener("click", () => modal.close());

  document.getElementById("btn-class-delete").addEventListener("click", () => {
    const id = document.getElementById("class-id").value;
    classes = classes.filter((c) => c.id !== id);
    onSyncRequest();
    modal.close();
    render();
  });

  document.getElementById("form-class").addEventListener("submit", (e) => {
    e.preventDefault();
    const id = document.getElementById("class-id").value;
    const datos = {
      materia: document.getElementById("class-name").value.trim(),
      salon: document.getElementById("class-room").value.trim(),
      dias: [...editingDays].sort(),
      horaInicio: document.getElementById("class-start").value,
      horaFin: document.getElementById("class-end").value,
      color: (document.getElementById("class-color") || {}).value || editingColor,
    };
    if (!datos.materia || !datos.dias.length) return;

    if (id) {
      const c = classes.find((x) => x.id === id);
      if (c) Object.assign(c, datos);
    } else {
      classes.push({ id: "cl_" + Date.now().toString(36), ...datos });
    }
    onSyncRequest();
    modal.close();
    render();
  });
}

function openClassModal(clase) {
  const modal = document.getElementById("modal-class");
  if (!modal) return;

  const delBtn = document.getElementById("btn-class-delete");
  editingDays = clase ? [...(clase.dias || [])] : [];
  editingColor = clase ? (clase.color || DEFAULT_COLOR) : DEFAULT_COLOR;

  document.getElementById("class-id").value    = clase ? clase.id : "";
  document.getElementById("class-name").value  = clase ? clase.materia : "";
  document.getElementById("class-room").value  = clase ? (clase.salon || "") : "";
  document.getElementById("class-start").value = clase ? clase.horaInicio : "07:00";
  document.getElementById("class-end").value   = clase ? clase.horaFin : "08:00";
  delBtn.classList.toggle("hidden", !clase);

  modal.querySelectorAll(".cday").forEach((b) => {
    b.classList.toggle("on", editingDays.includes(parseInt(b.dataset.day, 10)));
  });
  const ci = document.getElementById("class-color");
  if (ci) ci.value = editingColor;
  modal.querySelectorAll(".ccolor").forEach((b) => {
    b.classList.toggle("on", b.dataset.color.toLowerCase() === editingColor.toLowerCase());
  });

  modal.showModal();
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
