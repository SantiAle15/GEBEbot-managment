/**
 * api.js — Ahora habla con Firebase, no con el ESP32.
 *
 * ARQUITECTURA NUEVA:
 *            ┌──────────────┐
 *            │   Firebase   │  ← la fuente de verdad
 *            └──────┬───────┘
 *        ┌──────────┼──────────┐
 *        ▼          ▼          ▼
 *     Web app   GEBE-BOT   Asistente
 *     (HTTPS)    (ESP32)   de escritorio
 *
 * El ESP32 ya NO es servidor: es un cliente más. Tus datos viven en la
 * nube, así que la app funciona aunque el bot esté apagado.
 *
 * IMPORTANTE: se conservan EXACTAMENTE los mismos nombres de funciones
 * exportadas que la versión anterior (registerAccount, loginAccount,
 * fetchUser, saveUser, fetchStatus, postCommand, setAuthToken...), para
 * no tener que reescribir auth.js, app.js ni tasks.js.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase,
  ref,
  get,
  set,
  update,
  push,
  onValue,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

import { firebaseConfig, EMAIL_DOMAIN } from "./config.js";

// ── Inicialización ──────────────────────────────────────────
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

let currentUid = null;
let authToken = "";

onAuthStateChanged(auth, (user) => {
  currentUid = user ? user.uid : null;
});

// "santi" → "santi@gebebot.app"
function toEmail(usuario) {
  return `${String(usuario).trim().toLowerCase()}@${EMAIL_DOMAIN}`;
}

function requireUid() {
  const uid = currentUid || auth.currentUser?.uid;
  if (!uid) {
    const err = new Error("No has iniciado sesión");
    err.status = 401;
    throw err;
  }
  return uid;
}

// ── Compatibilidad con la interfaz anterior ─────────────────
export function setAuthToken(token) {
  authToken = token || "";
}
export function getAuthToken() {
  return authToken;
}

// ═══════════════════════════════════════════════════════════
//  AUTENTICACIÓN
// ═══════════════════════════════════════════════════════════

/** Registro → { ok, usuario, token } (mismo contrato que antes) */
export async function registerAccount(usuario, password) {
  try {
    const cred = await createUserWithEmailAndPassword(auth, toEmail(usuario), password);
    const token = await cred.user.getIdToken();
    currentUid = cred.user.uid;

    // Estructura inicial de la cuenta en la base de datos
    await set(ref(db, `users/${cred.user.uid}`), {
      perfil: { usuario, creado: serverTimestamp() },
      tareas: [],
      habitos: [],
      recordatorios: [],
      pet: { hambre: 100, felicidad: 100, salud: 100, alive: true, edad: 0 },
    });

    return { ok: true, usuario, token };
  } catch (e) {
    throw mapFirebaseError(e);
  }
}

/** Login → { ok, usuario, token } */
export async function loginAccount(usuario, password) {
  try {
    const cred = await signInWithEmailAndPassword(auth, toEmail(usuario), password);
    const token = await cred.user.getIdToken();
    currentUid = cred.user.uid;
    return { ok: true, usuario, token };
  } catch (e) {
    throw mapFirebaseError(e);
  }
}

export async function logoutAccount() {
  await signOut(auth);
  currentUid = null;
  authToken = "";
}

// Traduce los códigos de Firebase a mensajes en español
function mapFirebaseError(e) {
  const code = e?.code || "";
  const map = {
    "auth/email-already-in-use": "Ese usuario ya existe",
    "auth/invalid-email": "Nombre de usuario inválido",
    "auth/weak-password": "La contraseña debe tener 6+ caracteres",
    "auth/user-not-found": "Usuario o contraseña incorrectos",
    "auth/wrong-password": "Usuario o contraseña incorrectos",
    "auth/invalid-credential": "Usuario o contraseña incorrectos",
    "auth/too-many-requests": "Demasiados intentos. Espera un momento.",
    "auth/network-request-failed": "Sin conexión a internet",
  };
  const err = new Error(map[code] || e?.message || "Error de autenticación");
  err.status = (code.includes("wrong-password") || code.includes("user-not-found") ||
                code.includes("invalid-credential")) ? 401 : 400;
  err.code = code;
  return err;
}

// ═══════════════════════════════════════════════════════════
//  DATOS DEL USUARIO (tareas / hábitos / recordatorios)
// ═══════════════════════════════════════════════════════════

/** GET /user → { tareas, habitos, recordatorios } */
export async function fetchUser(_user) {
  const uid = requireUid();
  const snap = await get(ref(db, `users/${uid}`));
  const data = snap.val() || {};
  return {
    tareas: data.tareas || [],
    habitos: data.habitos || [],
    recordatorios: data.recordatorios || [],
  };
}

/** POST /user → guarda los objetos COMPLETOS (colorHSL, positionX, rotation…) */
export async function saveUser(_user, tareas, habitos, recordatorios) {
  const uid = requireUid();
  await update(ref(db, `users/${uid}`), {
    tareas: tareas || [],
    habitos: habitos || [],
    recordatorios: recordatorios || [],
  });
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════
//  ESTADO DE LA MASCOTA
// ═══════════════════════════════════════════════════════════

/** GET /status → { hambre, felicidad, salud, alive } */
export async function fetchStatus(_user) {
  const uid = requireUid();
  const snap = await get(ref(db, `users/${uid}/pet`));
  const pet = snap.val();
  if (!pet) {
    const err = new Error("Sin datos de la mascota");
    err.status = 404;
    throw err;
  }
  return pet;
}

/**
 * NUEVO · suscripción en TIEMPO REAL.
 * Cuando el GEBE-BOT actualiza sus stats, la web se entera al instante
 * (ya no hace falta polling). Devuelve una función para desuscribirse.
 */
export function subscribeStatus(callback) {
  const uid = currentUid || auth.currentUser?.uid;
  if (!uid) return () => {};
  return onValue(
    ref(db, `users/${uid}/pet`),
    (snap) => { const pet = snap.val(); if (pet) callback(pet, null); },
    (err) => callback(null, err)
  );
}

/** NUEVO · detecta si el GEBE-BOT está encendido (reporta cada minuto) */
export function subscribeDeviceOnline(callback) {
  const uid = currentUid || auth.currentUser?.uid;
  if (!uid) return () => {};
  return onValue(ref(db, `users/${uid}/device/lastSeen`), (snap) => {
    const last = snap.val();
    callback(last ? (Date.now() - Number(last) < 120000) : false);
  });
}

// ═══════════════════════════════════════════════════════════
//  COMANDOS PARA EL GEBE-BOT
//  Se encolan en Firebase; el ESP32 los lee, ejecuta y borra.
//  Si el bot está apagado, esperan a que encienda.
// ═══════════════════════════════════════════════════════════
export async function postCommand(body) {
  const uid = requireUid();
  await push(ref(db, `users/${uid}/commands`), { ...body, ts: Date.now() });
  return { ok: true };
}

export function notifyTaskComplete() {
  return postCommand({ type: "TAREA_COMPLETADA" });
}
export function notifyHabitComplete() {
  return postCommand({ type: "HABITO_COMPLETADO" });
}