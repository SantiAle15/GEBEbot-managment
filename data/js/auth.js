import { SESSION_USER_KEY, SESSION_TOKEN_KEY } from "./config.js";
import * as api from "./api.js";
import * as state from "./state.js";

export function getSessionUser() {
  try {
    return sessionStorage.getItem(SESSION_USER_KEY) || "";
  } catch {
    return "";
  }
}

export function getSessionToken() {
  try {
    return sessionStorage.getItem(SESSION_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

function saveSession(usuario, token) {
  try {
    sessionStorage.setItem(SESSION_USER_KEY, usuario);
    sessionStorage.setItem(SESSION_TOKEN_KEY, token);
  } catch {
    /* sessionStorage no disponible */
  }
}

export function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_USER_KEY);
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {
    /* noop */
  }
  api.setAuthToken("");
}

function sanitizeUsername(raw) {
  const user = raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (user.length < 2) {
    throw new Error("El usuario debe tener al menos 2 letras o números (sin espacios).");
  }
  return user;
}

function validateCredentials(usuario, password) {
  const user = sanitizeUsername(usuario);
  if (!password || password.length < 4) {
    throw new Error("La contraseña debe tener al menos 4 caracteres.");
  }
  return user;
}

export async function login(usuario, password) {
  const user = validateCredentials(usuario, password);
  const data = await api.loginAccount(user, password);
  api.setAuthToken(data.token);
  state.setUsername(data.usuario || user);
  saveSession(data.usuario || user, data.token);
  return data.usuario || user;
}

export async function register(usuario, password) {
  const user = validateCredentials(usuario, password);
  const data = await api.registerAccount(user, password);
  api.setAuthToken(data.token);
  state.setUsername(data.usuario || user);
  saveSession(data.usuario || user, data.token);
  return data.usuario || user;
}

export function logout() {
  // Cierra sesión en Firebase además de limpiar la sesión local
  api.logoutAccount?.().catch(() => {});
  clearSession();
  state.reset();
}

export function restoreSession() {
  const user = getSessionUser();
  const token = getSessionToken();
  if (user && token) {
    api.setAuthToken(token);
    state.setUsername(user);
    return { user, token };
  }
  clearSession();
  return null;
}