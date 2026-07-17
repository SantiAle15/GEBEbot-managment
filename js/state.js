let username = "";
let tasks = [];
let habits = [];
let reminders = [];
let listeners = new Set();

export function getUsername() { return username; }
export function setUsername(name) { username = name.trim(); }
export function getTasks() { return [...tasks]; }
export function getHabits() { return [...habits]; }
export function getReminders() { return [...reminders]; }

export function setTasks(list) { tasks = list.map(normalizeTask); emit(); }
export function setHabits(list) { habits = list.map(normalizeHabit); emit(); }
export function setReminders(list) { reminders = list.map(normalizeReminder); emit(); }

// ═══ GENERADORES DE ESTILO ALEATORIO ═══
function generateRandomColorHSL(type) {
  let hue, saturation, lightness;
  if (type === 'task') {
    hue = Math.floor(Math.random() * 41) + 100;
    saturation = Math.floor(Math.random() * 30) + 60;
    lightness = Math.floor(Math.random() * 20) + 40;
  } else if (type === 'habit') {
    hue = Math.floor(Math.random() * 21) + 40;
    saturation = Math.floor(Math.random() * 30) + 70;
    lightness = Math.floor(Math.random() * 15) + 50;
  } else if (type === 'reminder') {
    hue = Math.floor(Math.random() * 31) + 200;
    saturation = Math.floor(Math.random() * 30) + 60;
    lightness = Math.floor(Math.random() * 20) + 45;
  } else {
    hue = Math.floor(Math.random() * 360);
    saturation = 70;
    lightness = 50;
  }
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

function generateRandomFold() { return 0; }  // dobleces desactivados (se veían artificiales)
function generateRandomWrinkles() {
  // 0 = sin arrugas (poco común); 1..6 = tipos de arruga
  // 85% de probabilidad de tener alguna arruga
  return Math.random() < 0.15 ? 0 : (Math.floor(Math.random() * 6) + 1);
}
function generateRandomPosition() {
  return {
    x: Math.floor(Math.random() * 60) + 10,
    y: Math.floor(Math.random() * 50) + 25
  };
}
function generateRandomRotation() { return Math.floor(Math.random() * 17) - 8; }

// ═══ NORMALIZADORES ═══
function normalizeTask(t) {
  return {
    id: t.id || crypto.randomUUID(),
    title: String(t.title || "").trim(),
    description: String(t.description || ""),
    date: t.date || todayISO(),
    dateEnd: t.dateEnd || "",
    timeStart: t.timeStart || "",
    timeEnd: t.timeEnd || "",
    category: t.category || "personal",
    recurrence: t.recurrence || "none",
    completed: Boolean(t.completed),
    isNew: Boolean(t.isNew),
    createdAt: t.createdAt || todayISO(),
    colorHSL: t.colorHSL || generateRandomColorHSL('task'),
    foldType: t.foldType !== undefined ? t.foldType : generateRandomFold(),
    wrinklePattern: t.wrinklePattern !== undefined ? t.wrinklePattern : generateRandomWrinkles(),
    positionX: t.positionX !== undefined ? t.positionX : generateRandomPosition().x,
    positionY: t.positionY !== undefined ? t.positionY : generateRandomPosition().y,
    rotation: t.rotation !== undefined ? t.rotation : generateRandomRotation()
  };
}

function normalizeHabit(h) {
  return {
    id: h.id || crypto.randomUUID(),
    title: String(h.title || "").trim(),
    description: String(h.description || ""),
    startDate: h.startDate || todayISO(),
    dateEnd: h.dateEnd || "",
    timeStart: h.timeStart || "",
    timeEnd: h.timeEnd || "",
    category: h.category || "personal",
    recurrence: h.recurrence || "daily",
    completedDates: Array.isArray(h.completedDates) ? h.completedDates : [],
    streak: Number(h.streak) || 0,
    isNew: Boolean(h.isNew),
    createdAt: h.createdAt || todayISO(),
    colorHSL: h.colorHSL || generateRandomColorHSL('habit'),
    foldType: h.foldType !== undefined ? h.foldType : generateRandomFold(),
    wrinklePattern: h.wrinklePattern !== undefined ? h.wrinklePattern : generateRandomWrinkles(),
    positionX: h.positionX !== undefined ? h.positionX : generateRandomPosition().x,
    positionY: h.positionY !== undefined ? h.positionY : generateRandomPosition().y,
    rotation: h.rotation !== undefined ? h.rotation : generateRandomRotation()
  };
}

function normalizeReminder(r) {
  return {
    id: r.id || crypto.randomUUID(),
    title: String(r.title || "").trim(),
    description: String(r.description || ""),
    expiryDate: r.expiryDate || "",
    isNew: Boolean(r.isNew),
    createdAt: r.createdAt || todayISO(),
    colorHSL: r.colorHSL || generateRandomColorHSL('reminder'),
    foldType: r.foldType !== undefined ? r.foldType : generateRandomFold(),
    wrinklePattern: r.wrinklePattern !== undefined ? r.wrinklePattern : generateRandomWrinkles(),
    positionX: r.positionX !== undefined ? r.positionX : generateRandomPosition().x,
    positionY: r.positionY !== undefined ? r.positionY : generateRandomPosition().y,
    rotation: r.rotation !== undefined ? r.rotation : generateRandomRotation()
  };
}

export function loadFromServer(data) {
  const tareas = Array.isArray(data?.tareas) ? data.tareas : [];
  const habitos = Array.isArray(data?.habitos) ? data.habitos : [];
  const recordatorios = Array.isArray(data?.recordatorios) ? data.recordatorios : [];
  tasks = tareas.map(normalizeTask);
  habits = habitos.map(normalizeHabit);
  reminders = recordatorios.map(normalizeReminder);
  emit();
}

export function addTask(taskData) { const t = normalizeTask(taskData); tasks.push(t); emit(); return t; }
export function addHabit(habitData) { const h = normalizeHabit(habitData); habits.push(h); emit(); return h; }
export function addReminder(reminderData) { const r = normalizeReminder(reminderData); reminders.push(r); emit(); return r; }

export function updateTask(id, patch) {
  const i = tasks.findIndex((t) => t.id === id);
  if (i === -1) return null;
  tasks[i] = normalizeTask({ ...tasks[i], ...patch });
  emit();
  return tasks[i];
}

export function updateHabit(id, patch) {
  const i = habits.findIndex((h) => h.id === id);
  if (i === -1) return null;
  habits[i] = normalizeHabit({ ...habits[i], ...patch });
  emit();
  return habits[i];
}

export function updateReminder(id, patch) {
  const i = reminders.findIndex((r) => r.id === id);
  if (i === -1) return null;
  reminders[i] = normalizeReminder({ ...reminders[i], ...patch });
  emit();
  return reminders[i];
}

export function removeTask(id) { tasks = tasks.filter((t) => t.id !== id); emit(); }
export function removeHabit(id) { habits = habits.filter((h) => h.id !== id); emit(); }
export function removeReminder(id) { reminders = reminders.filter((r) => r.id !== id); emit(); }

export function toggleTask(id) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return null;
  t.completed = !t.completed;
  emit();
  return t;
}

export function toggleHabitToday(id) {
  const h = habits.find((x) => x.id === id);
  if (!h) return null;
  const today = todayISO();
  const wasDone = h.completedDates?.includes(today);
  if (!wasDone) {
    if (!h.completedDates) h.completedDates = [];
    h.completedDates.push(today);
    h.streak += 1;
  } else {
    h.completedDates = h.completedDates.filter(d => d !== today);
    if (h.streak > 0) h.streak -= 1;
  }
  emit();
  return h;
}

export function getItemsForDate(dateStr) {
  const dayTasks = tasks.filter((t) => t.date === dateStr);
  const dayHabits = habits.filter((h) => {
    if (!h.startDate) return false;
    const startDate = new Date(h.startDate);
    const currentDate = new Date(dateStr);
    if (h.recurrence === "daily") return currentDate >= startDate;
    if (h.recurrence === "weekly") return currentDate >= startDate && currentDate.getDay() === startDate.getDay();
    if (h.recurrence === "monthly") return currentDate >= startDate && currentDate.getDate() === startDate.getDate();
    return h.startDate === dateStr;
  });
  return { tasks: dayTasks, habits: dayHabits };
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ═══ ACTUALIZACIÓN SILENCIOSA (para el motor de física) ═══
// Muta el item SIN emitir evento. Si emitiera, tasks.js re-renderizaría
// todos los stickers en cada frame de física y destruiría los cuerpos.
export function updatePositionSilent(type, id, patch) {
  let list;
  if (type === "task") list = tasks;
  else if (type === "habit") list = habits;
  else if (type === "reminder") list = reminders;
  else return;

  const item = list.find((x) => x.id === id);
  if (!item) return;
  Object.assign(item, patch);
}

function emit() {
  listeners.forEach((fn) => fn({ tasks, habits, reminders, username }));
}

export function todayISO() { return new Date().toISOString().slice(0, 10); }

export function reset() {
  username = "";
  tasks = [];
  habits = [];
  reminders = [];
  emit();
}
