/* ========================================================== */
/* NOTAS-TURNO.JS — Observación general del turno              */
/* ========================================================== */
/*
  Módulo chico a propósito: la nota de turno es un campo de texto
  libre que el supervisor completa en Vista de Planta (por ejemplo:
  "Turno tranquilo, sin novedades" o "Falla recurrente en Prensa 2").
  Se separó en su propio archivo por claridad semántica, aunque
  podría vivir dentro de vistaDePlanta.js.
*/

import { persistir } from '../nucleo/almacenamiento.js';
import { sesion } from '../nucleo/estado.js';

/** Garantiza que la sesión tenga el campo notaTurno como string (compatibilidad con datos viejos). */
export function asegurarNotaTurno(s) {
  if (typeof s.notaTurno !== 'string') s.notaTurno = '';
}

/** Guarda el texto de la nota de turno escrita por el supervisor. */
export function guardarNotaTurno(valorNuevo) {
  const s = sesion();
  asegurarNotaTurno(s);
  s.notaTurno = valorNuevo.trim();
  s.actualizada = new Date().toISOString();
  persistir();
}

// ==========================================================
// EXPOSICIÓN A window
// ----------------------------------------------------------
// guardarNotaTurno: se llama desde onchange="..." en index.html
// (textarea de observaciones en Vista de Planta).
// ==========================================================
window.guardarNotaTurno = guardarNotaTurno;