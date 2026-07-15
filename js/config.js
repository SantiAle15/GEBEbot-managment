/**
 * config.js — Configuración de Firebase
 *
 * ⚠ Reemplaza estos valores con los de TU proyecto:
 *   Firebase Console → ⚙ Configuración del proyecto → Tus apps → Web
 */
export const firebaseConfig = {
  apiKey: "AIzaSyDMqEMTuu70eZyBQ-GylZnmNTAYjNRa8xw",
  authDomain: "gebe-bot.firebaseapp.com",
  databaseURL: "https://gebe-bot-default-rtdb.firebaseio.com",
  projectId: "gebe-bot",
  storageBucket: "gebe-bot.firebasestorage.app",
  messagingSenderId: "916242051324",
  appId: "1:916242051324:web:3557601980f87c53c4e779"
};

/**
 * Firebase Auth usa EMAIL, pero tu app usa NOMBRE DE USUARIO.
 * Los convertimos internamente:  "santi" → "santi@gebebot.app"
 * Así la interfaz no cambia y nunca ves un email de por medio.
 */
export const EMAIL_DOMAIN = "gebebot.app";

export const SESSION_USER_KEY = "urbanpet_user";
export const SESSION_TOKEN_KEY = "urbanpet_token";

// Ya no hace falta polling: Firebase empuja los cambios en tiempo real.
// Se mantiene la constante por compatibilidad con app.js.
export const POLL_INTERVAL_MS = 30000;