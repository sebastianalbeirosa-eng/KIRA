/* ========================================================== */
/* GESTION-TURNO.JS — Turno automático y arranque de turno     */
/* ========================================================== */
/*
  Dos responsabilidades: determinar qué turno corresponde según
  la hora del día, y el flujo de "nuevo turno" al seleccionar un
  turno en el header. Cada combinación fecha|turno es una sesión
  independiente, así que seleccionar un turno ya lleva a su propia
  sesión; acá solo avisamos al operario y, si ese turno ya tenía
  datos, le damos la opción de continuar o empezar limpio (sin
  borrados involuntarios).
*/

import { persistir } from '../nucleo/almacenamiento.js';
import { valor } from '../nucleo/utilidades.js';
import { sesion, lineasActivas } from '../nucleo/estado.js';
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
 * Indica si una sesión ya tiene datos operativos cargados (paradas, acciones,
 * defectos, supervisor, nota de turno, o lecturas de calidad/quemado).
 */
function sesionTieneDatos(s) {
  if (!s) return false;
  if ((s.paradas || []).length) return true;
  if ((s.acciones || []).length) return true;
  if ((s.defectos || []).length) return true;
  if ((s.supervisor || '').trim()) return true;
  if ((s.notaTurno || '').trim()) return true;
  const objs = s.objetivos?.porLinea || {};
  return Object.values(objs).some(o => {
    const cal = (o.lecturasCalidad || []).some(x => x && (x.global !== null || x.parcial !== null));
    const quem = (o.lecturasQuemado || []).some(x => x && x.real > 0);
    return cal || quem;
  });
}

/** Limpia los datos operativos de la sesión actual en pantalla (no toca el histórico). */
function limpiarSesionActual() {
  const s = sesion();
  s.paradas = [];
  s.acciones = [];
  s.defectos = [];
  s.supervisor = '';
  s.notaTurno = '';
  // Reiniciar lecturas de calidad/quemado por línea (los objetivos numéricos
  // se conservan; solo se limpian las lecturas reales del turno).
  const objs = s.objetivos?.porLinea || {};
  Object.values(objs).forEach(o => {
    o.lecturasCalidad = Array(8).fill(null).map(() => ({ hora: '', global: null, parcial: null }));
    o.lecturasQuemado = Array(3).fill(null).map(() => ({ hora: '', real: 0 }));
    o.realCalidad = 0;
    o.calidadParcial = 0;
    o.horaCalidadParcial = '';
    o.realProd = 0;
  });
  s.actualizada = new Date().toISOString();
  persistir();
  renderTodo();
}

/**
 * Se invoca al seleccionar un turno en el header. Avisa "Nuevo turno
 * detectado" y, si la sesión de ese turno ya trae datos, ofrece continuar
 * con ellos o empezar limpio. Si está vacía, solo muestra un aviso.
 * @param {string} fecha
 * @param {string} turno
 */
export function detectarNuevoTurno(fecha, turno) {
  const s = sesion();

  if (!sesionTieneDatos(s)) {
    mostrarAlertaKira(
      `Turno ${turno} (${fecha}) listo para el registro. La producción del horno se hereda del día; cargá solo los cambios y tus tomas.`,
      'Nuevo Turno Detectado',
      'info'
    );
    return;
  }

  // El turno ya tiene datos: preguntar antes de borrar nada.
  // "Empezar limpio" vacía la pantalla; "Cancelar" continúa con los datos.
  mostrarConfirmacionKira(
    `El turno ${turno} (${fecha}) ya tiene registros cargados.\n\nElegí "Empezar limpio" para vaciar la pantalla y cargar un turno nuevo, o "Cancelar" para continuar con los datos actuales.\n\n(Lo ya guardado permanece en el Histórico; "Empezar limpio" solo vacía la pantalla de este turno.)`,
    'Nuevo Turno Detectado',
    () => {
      limpiarSesionActual();
      mostrarAlertaKira('Pantalla restablecida. Listo para el registro del nuevo turno.', 'Nuevo Turno', 'exito');
    },
    'Empezar limpio'
  );
}

// ==========================================================
// EXPOSICIÓN A window
// ----------------------------------------------------------
// detectarNuevoTurno se llama desde app.js (cambiarSesion), no
// directamente desde el HTML, así que no necesita ir a window.
// ==========================================================
