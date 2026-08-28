/* ========================================================== */
/* GESTION-TURNO.JS — Turno automático y borrado seguro        */
/* ========================================================== */
/*
  Dos responsabilidades chicas pero importantes: determinar qué
  turno corresponde según la hora del día, y el flujo de "borrado
  seguro de pantalla" al iniciar un turno nuevo (los datos del
  turno anterior ya están guardados en el histórico, esto solo
  limpia lo que se ve en pantalla).
*/

import { persistir } from '../nucleo/almacenamiento.js';
import { valor } from '../nucleo/utilidades.js';
import { sesion } from '../nucleo/estado.js';
import { mostrarConfirmacionKira, mostrarAlertaKira } from '../nucleo/alertasKira.js';
import { renderTodo } from './vistaDePlanta.js';

/** Determina el turno actual según la franja horaria estricta de planta (Mañana/Tarde/Noche). */
export function determinarTurnoAutomatico() {
  const horaActual = new Date().getHours();
  if (horaActual >= 6 && horaActual < 14) return 'Mañana';
  if (horaActual >= 14 && horaActual < 22) return 'Tarde';
  return 'Noche';
}

/**
 * Pide confirmación y, si se acepta, limpia la pantalla operativa para
 * arrancar un turno nuevo. Los registros del turno anterior NO se pierden:
 * ya están guardados en el histórico bajo su propia clave fecha|turno.
 */
export function solicitarBorrarPantalla() {
  const fechaActual = valor('fecha');
  const turnoActual = valor('turno');

  const mensaje = `¿Desea limpiar la pantalla operativa para el ingreso de un nuevo turno?\n\nLos registros actuales del turno "${turnoActual}" (${fechaActual}) ya se encuentran guardados de forma segura en el Histórico y no se perderán.`;

  mostrarConfirmacionKira(
    mensaje,
    "Restablecer Pantalla de Turno",
    () => {
      // 1. Asegurar la persistencia del turno previo
      persistir();

      // 2. Limpiar la sesión actual en pantalla
      const s = sesion();
      s.paradas = [];
      s.acciones = [];
      s.defectos = [];
      s.supervisor = '';
      s.notaTurno = '';
      s.actualizada = new Date().toISOString();

      persistir();
      renderTodo();

      // 3. Notificación de éxito en modal KIRA
      mostrarAlertaKira('Pantalla restablecida con éxito. El sistema está listo para el registro del nuevo turno.', 'Nuevo Turno', 'exito');
    },
    "Sí, Borrar Pantalla"
  );
}

// ==========================================================
// EXPOSICIÓN A window
// ----------------------------------------------------------
// solicitarBorrarPantalla: se llama desde onclick="..." en
// index.html (botón "Nuevo Turno"). determinarTurnoAutomatico
// se usa internamente desde app.js, no necesita ir a window.
// ==========================================================
window.solicitarBorrarPantalla = solicitarBorrarPantalla;