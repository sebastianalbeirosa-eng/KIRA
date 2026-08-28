/* ========================================================== */
/* ACCIONES-CORRECTIVAS.JS — CRUD de acciones correctivas     */
/* ========================================================== */
/*
  Registro de acciones tomadas durante el turno (con o sin una
  parada asociada). Depende de renderTodo() (modulos/vistaDePlanta.js),
  todavía pendiente de cortar.
*/

import { persistir } from '../nucleo/almacenamiento.js';
import { valor, abrir, cerrar } from '../nucleo/utilidades.js';
import { sesion, lineasActivas } from '../nucleo/estado.js';
import { mostrarConfirmacionKira } from '../nucleo/alertasKira.js';

import { renderTodo } from './vistaDePlanta.js';

/** Pide confirmación antes de eliminar la acción correctiva actualmente abierta en el modal. */
export function eliminarAccionActual(id) {
  mostrarConfirmacionKira('¿Eliminar este registro de acción correctiva?', 'Eliminar Acción', () => {
    eliminarAccionDirecta(id);
    cerrar('modalAccion');
  }, 'Eliminar');
}

/**
 * Abre el modal de acción correctiva.
 * @param {Object|null} accionObj - Si viene con datos, es edición; si no, es alta nueva ("sin parada").
 */
export function abrirAccion(accionObj = null) {
  const primeraLinea = lineasActivas()[0]?.id || 'GENERAL';
  if (accionObj) {
    document.getElementById('modalAccionTitulo').textContent = 'Modificar acción correctiva';
    document.getElementById('editAccionId').value = accionObj.id;
    document.getElementById('aLinea').value = accionObj.linea;
    document.getElementById('aHora').value = accionObj.hora;
    document.getElementById('aEquipo').value = accionObj.equipo;
    document.getElementById('aDetalle').value = accionObj.detalle;
    document.getElementById('aResponsable').value = accionObj.responsable || '';
    document.getElementById('btnEliminarAccionContainer').innerHTML = `<button type="button" class="btn bg-rose-600 text-white text-xs hover:bg-rose-700" onclick="eliminarAccionActual('${accionObj.id}')">Eliminar acción</button>`;
  } else {
    document.getElementById('modalAccionTitulo').textContent = 'Acción correctiva sin parada';
    document.getElementById('editAccionId').value = '';
    document.getElementById('aLinea').value = valor('lineaVista') === 'TODAS' ? primeraLinea : valor('lineaVista');
    document.getElementById('aHora').value = new Date().toTimeString().slice(0, 5);
    document.getElementById('aEquipo').value = '';
    document.getElementById('aDetalle').value = '';
    document.getElementById('aResponsable').value = '';
    document.getElementById('btnEliminarAccionContainer').innerHTML = '';
  }
  abrir('modalAccion');
}

/** Guarda (alta o edición) el registro de acción correctiva del formulario modal. */
export function guardarAccion(e) {
  e.preventDefault();
  const editId = valor('editAccionId');
  const item = {
    id: editId || String(Date.now()),
    linea: valor('aLinea'),
    hora: valor('aHora'),
    equipo: valor('aEquipo').trim(),
    detalle: valor('aDetalle').trim(),
    responsable: valor('aResponsable').trim()
  };
  const s = sesion();
  if (editId) {
    const idx = s.acciones.findIndex(x => x.id === editId);
    if (idx !== -1) s.acciones[idx] = item;
  } else {
    s.acciones.push(item);
  }
  s.actualizada = new Date().toISOString();
  persistir();
  cerrar('modalAccion');
  renderTodo();
}

/** Elimina una acción correctiva sin pedir confirmación adicional (ya se confirmó en eliminarAccionActual). */
export function eliminarAccionDirecta(id) {
  const s = sesion();
  s.acciones = s.acciones.filter(x => x.id !== id);
  persistir();
  renderTodo();
}

/** Abre el modal de acción correctiva en modo edición, buscando el registro por id. */
export function editarAccion(id) {
  const accion = sesion().acciones.find(x => x.id === id);
  if (!accion) return;
  abrirAccion(accion);
}

// ==========================================================
// EXPOSICIÓN A window
// ----------------------------------------------------------
// abrirAccion, guardarAccion: llamadas desde index.html.
// editarAccion, eliminarAccionDirecta, eliminarAccionActual:
//   llamadas desde onclick generado dentro de vistaDePlanta.js
//   (lista de acciones del turno) y de este mismo módulo.
// ==========================================================
window.abrirAccion = abrirAccion;
window.guardarAccion = guardarAccion;
window.editarAccion = editarAccion;
window.eliminarAccionDirecta = eliminarAccionDirecta;
window.eliminarAccionActual = eliminarAccionActual;