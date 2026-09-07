/* ========================================================== */
/* UTILIDADES.JS — Helpers generales de DOM, formato y texto  */
/* ========================================================== */
/*
  Funciones chicas y sin estado propio, usadas en TODOS los módulos.
  No dependen de "db" ni de ningún otro módulo de KIRA:
  son la capa más básica de la aplicación.
*/

/** Devuelve el valor actual de un input/select por su id de HTML. */
export function valor(id) {
  // Guarda de null: si el elemento no existe (aún no montado, id renombrado),
  // devuelve '' en vez de romper el render completo con "Cannot read value of null".
  return document.getElementById(id)?.value ?? '';
}

/** Igual que valor(), pero convierte el resultado a número (0 si no es válido). */
export function numero(id) {
  return Number(valor(id)) || 0;
}

/** Devuelve la fecha de hoy en formato 'YYYY-MM-DD', ajustada a la zona horaria local. */
export function hoyLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

/**
 * Escapa caracteres especiales de HTML para evitar inyección de código
 * al insertar texto de usuario dentro de innerHTML (protección básica XSS).
 */
export function esc(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/** Convierte una fecha 'YYYY-MM-DD' al formato visual argentino 'DD/MM/YYYY'. */
export function fmtFecha(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

/** Muestra un elemento (modal, panel, etc.) quitándole 'hidden' y agregando 'flex'. */
export function abrir(id) {
  const e = document.getElementById(id);
  e.classList.remove('hidden');
  e.classList.add('flex');
}

/** Oculta un elemento (modal, panel, etc.) agregando 'hidden' y quitando 'flex'. */
export function cerrar(id) {
  const e = document.getElementById(id);
  e.classList.add('hidden');
  e.classList.remove('flex');
}

// ==========================================================
// EXPOSICIÓN A window
// ----------------------------------------------------------
// Solo cerrar() se llama directo desde onclick="cerrar('modalX')"
// en index.html, por eso es la única que necesita estar en window.
// abrir() se usa siempre desde otras funciones JS (import normal).
// ==========================================================
window.cerrar = cerrar;