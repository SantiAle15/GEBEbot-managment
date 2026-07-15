/**
 * physics.js — Colisiones reales entre stickers (Matter.js)
 *
 * Modelo mental: un escritorio visto desde arriba. Sin gravedad.
 * Levantas un papel, empuja a los de al lado. Lo sueltas, se desliza
 * y frena solo. Los demás reaccionan al golpe.
 *
 * DECISIONES CLAVE (y por qué la versión anterior fallaba):
 *
 *  1. UN MUNDO POR TABLERO. Antes los 3 tableros compartían un solo
 *     engine.world, así que los stickers de "Tareas" chocaban en secreto
 *     con los de "Hábitos" aunque estuvieran en pestañas distintas.
 *
 *  2. COORDENADAS LOCALES DEL CONTENEDOR (0..w, 0..h), no del viewport.
 *     Matter.Mouse entrega coordenadas relativas al elemento; si los
 *     cuerpos viven en coordenadas absolutas del viewport, el mouse
 *     "agarra" en un lugar y el cuerpo está en otro.
 *
 *  3. Map, NO WeakMap. WeakMap no tiene forEach/values/keys — la versión
 *     anterior los llamaba y lanzaba TypeError en cada arrastre.
 *
 *  4. positionX/Y = CENTRO del sticker (%), y el DOM lo compensa con
 *     translate(-50%, -50%). Matter razona en centros; mezclarlo con
 *     esquinas hacía que los stickers saltaran de lugar al cargar.
 *
 *  5. Guardado SILENCIOSO (state.updatePositionSilent) para no disparar
 *     un re-render en cada frame, que destruiría los cuerpos.
 */

import * as state from "./state.js";

// ── Sensación física: papeles pesados sobre un escritorio ───────────
const BODY_OPTIONS = {
  friction: 0.55,        // roce entre papeles
  frictionAir: 0.14,     // frenan rápido al soltarlos (no patinan eternamente)
  frictionStatic: 0.9,   // cuesta empezar a moverlos → sensación de peso
  restitution: 0.12,     // casi no rebotan (son papeles, no pelotas)
  density: 0.0016,
  slop: 0.02,
};

const WALL_T = 300;              // grosor de las paredes invisibles
const SETTLE_SPEED = 0.12;       // por debajo de esto se considera "quieto"
const SETTLE_MS = 350;           // cuánto debe estar quieto antes de guardar

// containerId -> { engine, runner, container, walls, mouseConstraint,
//                  bodies: Map(id -> {body, el, item, type, w, h}) }
const boards = new Map();

let activeId = null;
let syncCallback = () => {};

export function setSyncCallback(fn) {
  syncCallback = fn;
}

function hasMatter() {
  if (!window.Matter) {
    console.error("[physics] Matter.js no está cargado. Revisa el <script> en index.html");
    return false;
  }
  return true;
}

// ════════════════════════════════════════════════════════════════════
//  CREAR / OBTENER UN TABLERO
// ════════════════════════════════════════════════════════════════════
function getBoard(containerId, container) {
  if (!hasMatter()) return null;

  let board = boards.get(containerId);
  if (board) {
    board.container = container;   // por si el DOM se recreó
    return board;
  }

  const engine = Matter.Engine.create({
    gravity: { x: 0, y: 0, scale: 0 },   // vista cenital: sin gravedad
    // Sleeping DESACTIVADO: al chocar entre sí los cuerpos se dormían
    // y ya no se podían volver a mover. Con frictionAir alto igual
    // frenan rápido, así que no hace falta.
    enableSleeping: false,
  });

  board = {
    engine,
    runner: null,
    container,
    walls: [],
    mouseConstraint: null,
    bodies: new Map(),
    settleTimer: null,
    dragging: false,
  };
  boards.set(containerId, board);

  // Cada frame: copiar posiciones de los cuerpos al DOM
  Matter.Events.on(engine, "afterUpdate", () => syncDom(board));

  buildWalls(board);
  installMouse(board, containerId);

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => buildWalls(board));
    ro.observe(container);
    board.resizeObs = ro;
  }

  return board;
}

// Paredes en coordenadas LOCALES (0,0) → (w,h)
function buildWalls(board) {
  const { engine, container } = board;
  const w = container.clientWidth || 1;
  const h = container.clientHeight || 1;
  const t = WALL_T;

  if (board.walls.length) {
    Matter.World.remove(engine.world, board.walls);
  }

  const opts = { isStatic: true, friction: 0.6, restitution: 0.1 };
  board.walls = [
    Matter.Bodies.rectangle(w / 2, -t / 2, w + t * 2, t, opts),        // arriba
    Matter.Bodies.rectangle(w / 2, h + t / 2, w + t * 2, t, opts),     // abajo
    Matter.Bodies.rectangle(-t / 2, h / 2, t, h + t * 2, opts),        // izquierda
    Matter.Bodies.rectangle(w + t / 2, h / 2, t, h + t * 2, opts),     // derecha
  ];
  Matter.World.add(engine.world, board.walls);
}

function installMouse(board, containerId) {
  const { engine, container } = board;

  const mouse = Matter.Mouse.create(container);
  // NO tocar mouse.pixelRatio: es para render en <canvas>. En DOM,
  // ponerlo en devicePixelRatio (2 en retina) DUPLICA las coordenadas
  // del cursor y hace que "agarres" stickers desde muy lejos.

  const mc = Matter.MouseConstraint.create(engine, {
    mouse,
    constraint: {
      stiffness: 0.9,     // se siente "pegado" al dedo, no elástico
      damping: 0.25,
      render: { visible: false },
    },
  });

  Matter.Events.on(mc, "startdrag", (e) => {
    board.dragging = true;
    const entry = findEntryByBody(board, e.body);
    if (entry) {
      entry.el.classList.add("dragging");
      entry.el.dataset.moved = "false";
      entry.el.style.zIndex = 1000;
    }
  });

  Matter.Events.on(mc, "enddrag", (e) => {
    board.dragging = false;
    const entry = findEntryByBody(board, e.body);
    if (entry) {
      entry.el.classList.remove("dragging");
      entry.el.style.zIndex = "";
    }
    scheduleSave(board);
  });

  // Si arrastraste, el sticker no debe abrir el modal al soltar
  Matter.Events.on(engine, "afterUpdate", () => {
    if (!board.dragging || !mc.body) return;
    const entry = findEntryByBody(board, mc.body);
    if (!entry) return;
    const speed = Matter.Vector.magnitude(mc.body.velocity);
    if (speed > 0.6) entry.el.dataset.moved = "true";
  });

  Matter.World.add(engine.world, mc);
  board.mouseConstraint = mc;

  // Matter necesita estos listeners en modo pasivo=false para touch
  mouse.element.removeEventListener("wheel", mouse.mousewheel);
}

function findEntryByBody(board, body) {
  if (!body) return null;
  for (const entry of board.bodies.values()) {
    if (entry.body.id === body.id) return entry;
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════
//  API PÚBLICA
// ════════════════════════════════════════════════════════════════════

/**
 * Registra los stickers de un tablero. Se llama después de renderizar.
 * items: [{ el, item, type }]
 */
export function syncBoard(containerId, container, entries) {
  const board = getBoard(containerId, container);
  if (!board) return;

  const { engine } = board;
  const cw = container.clientWidth || 1;
  const ch = container.clientHeight || 1;

  // Quitar cuerpos de stickers que ya no existen
  const liveIds = new Set(entries.map((e) => e.item.id));
  for (const [id, entry] of board.bodies) {
    if (!liveIds.has(id)) {
      Matter.World.remove(engine.world, entry.body);
      board.bodies.delete(id);
    }
  }

  // Crear/actualizar cuerpos
  for (const { el, item, type } of entries) {
    const w = el.offsetWidth || 280;
    const h = el.offsetHeight || 180;

    const existing = board.bodies.get(item.id);
    if (existing) {
      existing.el = el;
      existing.item = item;
      // Si cambió de tamaño (editaste el texto), rehacer el cuerpo
      if (Math.abs(existing.w - w) > 4 || Math.abs(existing.h - h) > 4) {
        Matter.World.remove(engine.world, existing.body);
        board.bodies.delete(item.id);
      } else {
        writeDom(container, existing);
        continue;
      }
    }

    // positionX/Y son el CENTRO en % del contenedor
    const cx = (item.positionX / 100) * cw;
    const cy = (item.positionY / 100) * ch;
    const angle = ((item.rotation || 0) * Math.PI) / 180;

    const body = Matter.Bodies.rectangle(cx, cy, w, h, {
      ...BODY_OPTIONS,
      angle,
    });

    const entry = { body, el, item, type, w, h };
    board.bodies.set(item.id, entry);
    Matter.World.add(engine.world, body);
    writeDom(container, entry);
  }

  buildWalls(board);
}

/** Activa un tablero: solo el activo simula (ahorra CPU). */
export function activateBoard(containerId) {
  if (!hasMatter()) return;

  // Pausar el anterior
  if (activeId && activeId !== containerId) {
    const prev = boards.get(activeId);
    if (prev?.runner) {
      Matter.Runner.stop(prev.runner);
      prev.runner = null;
    }
  }

  activeId = containerId;
  const board = boards.get(containerId);
  if (!board) return;

  buildWalls(board);

  if (!board.runner) {
    board.runner = Matter.Runner.create();
    Matter.Runner.run(board.runner, board.engine);
  }
}

/**
 * Sacude los stickers de un tablero (al cambiar de pestaña).
 * Ahora es un impulso FÍSICO real: empuja los cuerpos y ellos
 * se empujan entre sí de forma natural.
 */
export function nudgeBoard(containerId, intensity = 1) {
  const board = boards.get(containerId);
  if (!board || !hasMatter()) return;

  for (const entry of board.bodies.values()) {
    const fx = (Math.random() - 0.5) * 0.06 * intensity * entry.body.mass;
    const fy = (Math.random() - 0.5) * 0.06 * intensity * entry.body.mass;
    Matter.Body.applyForce(entry.body, entry.body.position, { x: fx, y: fy });
    Matter.Body.setAngularVelocity(
      entry.body,
      (Math.random() - 0.5) * 0.12 * intensity
    );
  }
  scheduleSave(board);
}

// ════════════════════════════════════════════════════════════════════
//  SINCRONIZACIÓN DOM ↔ FÍSICA
// ════════════════════════════════════════════════════════════════════
function writeDom(container, entry) {
  const cw = container.clientWidth || 1;
  const ch = container.clientHeight || 1;
  const { body, el } = entry;

  const px = (body.position.x / cw) * 100;
  const py = (body.position.y / ch) * 100;
  const deg = (body.angle * 180) / Math.PI;

  el.style.left = `${px}%`;
  el.style.top = `${py}%`;
  el.style.transform = `translate(-50%, -50%) rotate(${deg}deg)`;
}

function syncDom(board) {
  const { container } = board;
  if (!container || !container.clientWidth) return;
  for (const entry of board.bodies.values()) {
    writeDom(container, entry);
  }
}

// ════════════════════════════════════════════════════════════════════
//  GUARDADO (cuando todo se calma)
// ════════════════════════════════════════════════════════════════════
function scheduleSave(board) {
  if (board.settleTimer) clearTimeout(board.settleTimer);

  board.settleTimer = setTimeout(() => {
    if (board.dragging) {
      scheduleSave(board);
      return;
    }

    let calm = true;
    for (const entry of board.bodies.values()) {
      const v = Matter.Vector.magnitude(entry.body.velocity);
      const av = Math.abs(entry.body.angularVelocity);
      if (v > SETTLE_SPEED || av > 0.02) {
        calm = false;
        break;
      }
    }

    if (!calm) {
      scheduleSave(board);
      return;
    }

    persist(board);
  }, SETTLE_MS);
}

function persist(board) {
  const { container } = board;
  const cw = container.clientWidth || 1;
  const ch = container.clientHeight || 1;

  for (const entry of board.bodies.values()) {
    const px = (entry.body.position.x / cw) * 100;
    const py = (entry.body.position.y / ch) * 100;
    const deg = (entry.body.angle * 180) / Math.PI;

    // Guardado SILENCIOSO: no dispara re-render (si no, adiós cuerpos)
    state.updatePositionSilent(entry.type, entry.item.id, {
      positionX: Math.max(3, Math.min(97, px)),
      positionY: Math.max(3, Math.min(97, py)),
      rotation: deg,
    });
  }

  syncCallback();   // manda al ESP32
}

export function destroyPhysics() {
  for (const board of boards.values()) {
    if (board.runner) Matter.Runner.stop(board.runner);
    if (board.resizeObs) board.resizeObs.disconnect();
    Matter.Engine.clear(board.engine);
  }
  boards.clear();
  activeId = null;
}