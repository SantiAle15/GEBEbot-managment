// ═══════════════════════════════════════════════════════════
//  COLLAGE — Tablero libre tipo Canva
//  - Pan (arrastrar el lienzo) y zoom infinito
//  - Elementos: imagen, nota (post-it), archivo (recorte), pendiente
//  - Sin colisiones: los elementos se superponen libremente
//  - Cada elemento se queda donde lo sueltas (sin física)
//
//  Persistencia: se guarda en Firebase bajo users/{uid}/collage
//  Las imágenes se guardan comprimidas en base64 (listo para migrar
//  a Firebase Storage: solo cambiar saveImage() para subir y guardar URL).
// ═══════════════════════════════════════════════════════════

import * as state from "./state.js";

let onSyncRequest = () => {};
export function setCollageSyncHandler(fn) { onSyncRequest = fn; }

// Estado del viewport (pan y zoom)
let view = { x: 0, y: 0, scale: 1 };
let elements = [];   // {id, type, x, y, w, h, rot, content, color, refId, refType}

let viewport, canvas, zoomLabel;
let dragTarget = null;      // elemento que se arrastra
let dragOffset = { x: 0, y: 0 };
let isPanning = false;
let panStart = { x: 0, y: 0 };
let pointerStart = { x: 0, y: 0 };

const POSTIT_COLORS = ["#fff9a8", "#b8f7c0", "#ffc4dd", "#bfe3ff", "#ffd8a8"];

// ─────────────────────────────────────────────
//  INICIALIZACIÓN
// ─────────────────────────────────────────────
export function initCollage() {
  viewport = document.getElementById("collage-viewport");
  canvas = document.getElementById("collage-canvas");
  zoomLabel = document.querySelector(".collage-zoom-label");
  if (!viewport || !canvas) return;

  // Barra de herramientas
  document.querySelectorAll(".collage-tool").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      handleTool(btn.dataset.add);
    });
  });

  setupPanZoom();
  setupPickerModal();
  applyTransform();
}

// ─────────────────────────────────────────────
//  CARGA / GUARDADO
// ─────────────────────────────────────────────
export function loadCollage(data) {
  if (data && Array.isArray(data.elements)) {
    elements = data.elements;
  } else {
    elements = [];
  }
  if (data && data.view) view = data.view;
  renderAll();
  applyTransform();
}

export function getCollageData() {
  return { elements, view };
}

// Se llama al activar la pestaña: re-aplica la vista y redibuja
// (el canvas ya es visible y tiene medidas correctas)
export function refreshCollage() {
  if (!canvas) {
    // Por si initCollage no encontró los nodos al inicio, reintentar
    initCollage();
  }
  renderAll();
  applyTransform();
}

function persist() {
  onSyncRequest();
}

// ─────────────────────────────────────────────
//  HERRAMIENTAS
// ─────────────────────────────────────────────
function handleTool(action) {
  switch (action) {
    case "image": addImageFlow(); break;
    case "file":  addFileFlow(); break;
    case "note":  addNote(); break;
    case "item":  openPickerModal(); break;
    case "zoomin":  zoomBy(1.2); break;
    case "zoomout": zoomBy(1 / 1.2); break;
    case "zoomreset": resetZoom(); break;
  }
}

// Coordenadas del centro visible en el espacio del canvas
function centerInCanvas() {
  const rect = viewport.getBoundingClientRect();
  const cx = (rect.width / 2 - view.x) / view.scale;
  const cy = (rect.height / 2 - view.y) / view.scale;
  return { x: cx, y: cy };
}

function newId() {
  return "c_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ─────────────────────────────────────────────
//  AGREGAR ELEMENTOS
// ─────────────────────────────────────────────
function addNote() {
  const c = centerInCanvas();
  const color = POSTIT_COLORS[Math.floor(Math.random() * POSTIT_COLORS.length)];
  const el = {
    id: newId(), type: "note",
    x: c.x - 90, y: c.y - 90, w: 180, h: 180,
    rot: (Math.random() * 6 - 3),
    content: "", color,
  };
  elements.push(el);
  renderElement(el);
  persist();
  // Enfocar para escribir
  setTimeout(() => {
    const node = canvas.querySelector(`[data-id="${el.id}"] .collage-note-text`);
    if (node) node.focus();
  }, 50);
}

function addImageFlow() {
  const input = document.getElementById("collage-file-input");
  input.value = "";
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const dataUrl = await compressImage(file, 900);   // máx 900px
    const c = centerInCanvas();
    const el = {
      id: newId(), type: "image",
      x: c.x - 140, y: c.y - 140, w: 280, h: 280,
      rot: (Math.random() * 4 - 2),
      content: dataUrl,
    };
    elements.push(el);
    renderElement(el);
    persist();
  };
  input.click();
}

function addFileFlow() {
  const input = document.getElementById("collage-file-input");
  input.value = "";
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    let thumb = "";
    if (file.type.startsWith("image/")) {
      thumb = await compressImage(file, 400);
    }
    const c = centerInCanvas();
    const el = {
      id: newId(), type: "file",
      x: c.x - 80, y: c.y - 90, w: 160, h: 180,
      rot: (Math.random() * 6 - 3),
      content: thumb, filename: file.name,
    };
    elements.push(el);
    renderElement(el);
    persist();
  };
  input.click();
}

// Agregar un pendiente (tarea/hábito/recordatorio) al collage
function addItemToBoard(refType, refId, title, accent) {
  const c = centerInCanvas();
  const el = {
    id: newId(), type: "item",
    x: c.x - 100, y: c.y - 60, w: 200, h: 120,
    rot: (Math.random() * 6 - 3),
    content: title, refType, refId, color: accent,
  };
  elements.push(el);
  renderElement(el);
  persist();
}

// ─────────────────────────────────────────────
//  RENDER
// ─────────────────────────────────────────────
function renderAll() {
  canvas.innerHTML = "";
  elements.forEach(renderElement);
}

function renderElement(el) {
  // Si ya existe, quitarlo para redibujar
  const prev = canvas.querySelector(`[data-id="${el.id}"]`);
  if (prev) prev.remove();

  const node = document.createElement("div");
  node.className = `collage-el collage-el-${el.type}`;
  node.dataset.id = el.id;
  node.style.left = el.x + "px";
  node.style.top = el.y + "px";
  node.style.width = el.w + "px";
  node.style.transform = `rotate(${el.rot || 0}deg)`;

  if (el.type === "note") {
    node.style.height = el.h + "px";
    node.style.background = el.color;
    node.innerHTML = `
      <div class="collage-note-text" contenteditable="true" spellcheck="false">${escapeHtml(el.content)}</div>
      <button class="collage-el-del" title="Quitar">×</button>`;
    const txt = node.querySelector(".collage-note-text");
    txt.addEventListener("input", () => { el.content = txt.innerText; scheduleSave(); });
    txt.addEventListener("pointerdown", (e) => e.stopPropagation());
  }
  else if (el.type === "image") {
    node.innerHTML = `
      <img src="${el.content}" draggable="false" alt="">
      <button class="collage-el-del" title="Quitar">×</button>`;
  }
  else if (el.type === "file") {
    node.style.height = el.h + "px";
    const inner = el.content
      ? `<img src="${el.content}" draggable="false" alt="">`
      : `<div class="collage-file-icon">📄</div>`;
    node.innerHTML = `
      <div class="collage-file-cut">${inner}</div>
      <div class="collage-file-name">${escapeHtml(el.filename || "archivo")}</div>
      <button class="collage-el-del" title="Quitar">×</button>`;
  }
  else if (el.type === "item") {
    node.style.height = el.h + "px";
    node.style.setProperty("--item-accent", el.color || "#9bf300");
    const badge = el.refType === "task" ? "TAREA" : el.refType === "habit" ? "HÁBITO" : "RECORDATORIO";
    node.innerHTML = `
      <div class="collage-item-badge">${badge}</div>
      <div class="collage-item-title">${escapeHtml(el.content)}</div>
      <button class="collage-el-del" title="Quitar">×</button>`;
  }

  // Botón eliminar
  const del = node.querySelector(".collage-el-del");
  if (del) {
    del.addEventListener("pointerdown", (e) => e.stopPropagation());
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      elements = elements.filter((x) => x.id !== el.id);
      node.remove();
      persist();
    });
  }

  // Arrastre del elemento (sin física, se queda donde lo sueltas)
  node.addEventListener("pointerdown", (e) => startDragElement(e, el, node));

  canvas.appendChild(node);
}

// ─────────────────────────────────────────────
//  ARRASTRE DE ELEMENTOS (sin colisión)
// ─────────────────────────────────────────────
function startDragElement(e, el, node) {
  if (e.target.classList.contains("collage-note-text")) return;  // editando texto
  e.stopPropagation();
  dragTarget = { el, node };
  // Traer al frente
  node.style.zIndex = ++zTop;
  const pt = screenToCanvas(e.clientX, e.clientY);
  dragOffset.x = pt.x - el.x;
  dragOffset.y = pt.y - el.y;
  node.setPointerCapture(e.pointerId);
}

let zTop = 10;

function onPointerMoveEl(e) {
  if (!dragTarget) return;
  const pt = screenToCanvas(e.clientX, e.clientY);
  dragTarget.el.x = pt.x - dragOffset.x;
  dragTarget.el.y = pt.y - dragOffset.y;
  dragTarget.node.style.left = dragTarget.el.x + "px";
  dragTarget.node.style.top = dragTarget.el.y + "px";
}

function onPointerUpEl() {
  if (dragTarget) { dragTarget = null; scheduleSave(); }
}

// ─────────────────────────────────────────────
//  PAN Y ZOOM DEL LIENZO
// ─────────────────────────────────────────────
function setupPanZoom() {
  // Pan: arrastrar el fondo del viewport
  viewport.addEventListener("pointerdown", (e) => {
    if (e.target === viewport || e.target === canvas) {
      isPanning = true;
      panStart = { x: view.x, y: view.y };
      pointerStart = { x: e.clientX, y: e.clientY };
      viewport.setPointerCapture(e.pointerId);
      viewport.style.cursor = "grabbing";
    }
  });

  viewport.addEventListener("pointermove", (e) => {
    if (isPanning) {
      view.x = panStart.x + (e.clientX - pointerStart.x);
      view.y = panStart.y + (e.clientY - pointerStart.y);
      applyTransform();
    } else {
      onPointerMoveEl(e);
    }
  });

  viewport.addEventListener("pointerup", (e) => {
    if (isPanning) {
      isPanning = false;
      viewport.style.cursor = "grab";
      scheduleSave();
    }
    onPointerUpEl(e);
  });

  // Zoom con rueda (centrado en el cursor)
  viewport.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    zoomAtPoint(factor, mx, my);
  }, { passive: false });

  // Zoom con pellizco (móvil)
  let pinchDist = 0;
  viewport.addEventListener("touchmove", (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (pinchDist > 0) {
        const rect = viewport.getBoundingClientRect();
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
        zoomAtPoint(dist / pinchDist, mx, my);
      }
      pinchDist = dist;
    }
  }, { passive: false });
  viewport.addEventListener("touchend", () => { pinchDist = 0; });
}

function zoomAtPoint(factor, mx, my) {
  const newScale = Math.min(4, Math.max(0.2, view.scale * factor));
  const realFactor = newScale / view.scale;
  // Mantener el punto bajo el cursor fijo
  view.x = mx - (mx - view.x) * realFactor;
  view.y = my - (my - view.y) * realFactor;
  view.scale = newScale;
  applyTransform();
  scheduleSave();
}

function zoomBy(factor) {
  const rect = viewport.getBoundingClientRect();
  zoomAtPoint(factor, rect.width / 2, rect.height / 2);
}

function resetZoom() {
  view.scale = 1;
  applyTransform();
  scheduleSave();
}

function applyTransform() {
  canvas.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  if (zoomLabel) zoomLabel.textContent = Math.round(view.scale * 100) + "%";
}

// Convierte coordenadas de pantalla a coordenadas del canvas
function screenToCanvas(clientX, clientY) {
  const rect = viewport.getBoundingClientRect();
  return {
    x: (clientX - rect.left - view.x) / view.scale,
    y: (clientY - rect.top - view.y) / view.scale,
  };
}

// ─────────────────────────────────────────────
//  MODAL PARA ELEGIR PENDIENTE
// ─────────────────────────────────────────────
let pickerType = "task";

function setupPickerModal() {
  const modal = document.getElementById("modal-collage-picker");
  if (!modal) return;

  modal.querySelectorAll(".cp-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      modal.querySelectorAll(".cp-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      pickerType = tab.dataset.cptype;
      fillPickerList();
    });
  });

  document.getElementById("collage-picker-cancel").addEventListener("click", () => modal.close());
}

function openPickerModal() {
  const modal = document.getElementById("modal-collage-picker");
  if (!modal) return;
  pickerType = "task";
  modal.querySelectorAll(".cp-tab").forEach((t, i) => t.classList.toggle("active", i === 0));
  fillPickerList();
  modal.showModal();
}

function fillPickerList() {
  const list = document.getElementById("collage-picker-list");
  if (!list) return;
  let items = [];
  let accent = "#9bf300";
  if (pickerType === "task") { items = state.getTasks(); accent = "#9bf300"; }
  else if (pickerType === "habit") { items = state.getHabits(); accent = "#ff6b00"; }
  else { items = state.getReminders(); accent = "#00e5ff"; }

  if (!items.length) {
    list.innerHTML = `<p class="collage-picker-empty">No hay ${pickerType === "task" ? "tareas" : pickerType === "habit" ? "hábitos" : "recordatorios"}.</p>`;
    return;
  }

  list.innerHTML = "";
  items.forEach((it) => {
    const row = document.createElement("button");
    row.className = "collage-picker-row";
    row.style.borderLeftColor = accent;
    row.textContent = it.title || "(sin título)";
    row.addEventListener("click", () => {
      addItemToBoard(pickerType, it.id, it.title || "(sin título)", accent);
      document.getElementById("modal-collage-picker").close();
    });
    list.appendChild(row);
  });
}

// ─────────────────────────────────────────────
//  UTILIDADES
// ─────────────────────────────────────────────
// Comprime y redimensiona una imagen a máx `maxSize` px, devuelve dataURL JPEG
function compressImage(file, maxSize) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxSize) {
          height = height * (maxSize / width); width = maxSize;
        } else if (height > maxSize) {
          width = width * (maxSize / height); height = maxSize;
        }
        const cv = document.createElement("canvas");
        cv.width = width; cv.height = height;
        cv.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(cv.toDataURL("image/jpeg", 0.78));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Guardado con debounce (no saturar Firebase al arrastrar)
let saveTimer = null;
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persist(), 800);
}
