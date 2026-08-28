/* ========================================================== */
/* GESTION-DEFECTOS.JS — CRUD de defectos de calidad           */
/* ========================================================== */
/*
  Control de calidad: registro de defectos detectados en el turno
  (nombre, % sobre producción, acción tomada). Depende de renderTodo()
  (modulos/vistaDePlanta.js) para refrescar el dashboard tras cada cambio.
*/

import { persistir } from '../nucleo/almacenamiento.js';
import { valor, numero, esc, abrir, cerrar } from '../nucleo/utilidades.js';
import { sesion, lineasActivas, nombreLinea } from '../nucleo/estado.js';
import { mostrarConfirmacionKira } from '../nucleo/alertasKira.js';

import { renderTodo } from './vistaDePlanta.js';

/** Garantiza que la sesión tenga el arreglo de defectos inicializado. */
export function asegurarDefectosSesion(s) {
  if (!Array.isArray(s.defectos)) s.defectos = [];
}

/**
 * Abre el modal de registro/edición de un defecto de calidad.
 * @param {Object|null} defectoObj - Si viene con datos, es edición; si no, es alta nueva.
 */
export function abrirDefecto(defectoObj = null) {
  const primeraLinea = lineasActivas()[0]?.id || 'GENERAL';
  if (defectoObj) {
    document.getElementById('modalDefectoTitulo').textContent = 'Modificar defecto de calidad';
    document.getElementById('editDefectoId').value = defectoObj.id;
    document.getElementById('dLinea').value = defectoObj.linea;
    document.getElementById('dNombre').value = defectoObj.nombre;
    document.getElementById('dPorcentaje').value = defectoObj.porcentaje;
    document.getElementById('dAccion').value = defectoObj.accion || '';
    document.getElementById('dObs').value = defectoObj.obs || '';
    document.getElementById('btnEliminarDefectoContainer').innerHTML = `<button type="button" class="btn bg-rose-600 text-white text-xs hover:bg-rose-700" onclick="eliminarDefectoActual('${defectoObj.id}')">Eliminar defecto</button>`;
  } else {
    document.getElementById('modalDefectoTitulo').textContent = 'Registrar defecto de calidad';
    document.getElementById('editDefectoId').value = '';
    document.getElementById('dLinea').value = valor('lineaVista') === 'TODAS' ? primeraLinea : valor('lineaVista');
    document.getElementById('dNombre').value = '';
    document.getElementById('dPorcentaje').value = '';
    document.getElementById('dAccion').value = '';
    document.getElementById('dObs').value = '';
    document.getElementById('btnEliminarDefectoContainer').innerHTML = '';
  }
  abrir('modalDefecto');
}

/** Guarda (alta o edición) el registro de defecto del formulario modal. */
export function guardarDefecto(e) {
  e.preventDefault();
  const s = sesion();
  asegurarDefectosSesion(s);
  const editId = valor('editDefectoId');
  const item = {
    id: editId || String(Date.now()),
    linea: valor('dLinea'),
    nombre: valor('dNombre').trim(),
    porcentaje: numero('dPorcentaje'),
    accion: valor('dAccion').trim(),
    obs: valor('dObs').trim()
  };
  if (editId) {
    const idx = s.defectos.findIndex(x => x.id === editId);
    if (idx !== -1) s.defectos[idx] = item;
  } else {
    s.defectos.push(item);
  }
  s.actualizada = new Date().toISOString();
  persistir();
  cerrar('modalDefecto');
  renderTodo();
}

/** Pide confirmación antes de eliminar un defecto (desde la lista de defectos recientes). */
export function eliminarDefecto(id) {
  mostrarConfirmacionKira('¿Eliminar este registro de defecto?', 'Eliminar Defecto', () => {
    eliminarDefectoDirecta(id);
  }, 'Eliminar');
}

/** Elimina un defecto directamente, sin abrir/cerrar el modal (ya se confirmó en eliminarDefecto / eliminarDefectoActual). */
export function eliminarDefectoDirecta(id) {
  const s = sesion();
  asegurarDefectosSesion(s);
  s.defectos = s.defectos.filter(x => x.id !== id);
  persistir();
  renderTodo();
}

/** Pide confirmación antes de eliminar el defecto actualmente abierto en el modal de edición. */
export function eliminarDefectoActual(id) {
  mostrarConfirmacionKira('¿Eliminar este registro de defecto?', 'Eliminar Defecto', () => {
    eliminarDefectoDirecta(id);
    cerrar('modalDefecto');
  }, 'Eliminar');
}

/** Abre el modal de defecto en modo edición, buscando el registro por id. */
export function editarDefecto(id) {
  const s = sesion();
  asegurarDefectosSesion(s);
  const defecto = s.defectos.find(x => x.id === id);
  if (!defecto) return;
  abrirDefecto(defecto);
}

/** Dibuja la lista de defectos de calidad recientes del turno. */
export function renderDefectos() {
  const s = sesion();
  asegurarDefectosSesion(s);
  const lineaFiltro = valor('lineaVista');
  const d = [...s.defectos]
    .filter(x => lineaFiltro === 'TODAS' || x.linea === lineaFiltro)
    .reverse();
  document.getElementById('cantidadDefectos').textContent = d.length;
  document.getElementById('defectosRecientes').innerHTML = d.length ? d.map(x => `
    <div class="flex justify-between items-start border-b border-slate-200 pb-2 bg-white p-2 rounded shadow-xs">
      <div>
        <div class="flex justify-between font-bold text-slate-800 gap-2"><b>${esc(x.nombre)}</b><span class="text-slate-400 text-[11px]">${esc(nombreLinea(x.linea))}</span></div>
        <div class="text-[12px] text-rose-700 font-black mt-0.5">${x.porcentaje}% sobre producción</div>
        ${x.accion ? `<div class="text-[13px] text-emerald-700 mt-0.5"><b>Acción:</b> ${esc(x.accion)}</div>` : ''}
        ${x.obs ? `<div class="text-[10px] text-slate-400 italic mt-0.5">Obs: ${esc(x.obs)}</div>` : ''}
      </div>
      <div class="flex gap-1 no-print">
        <button class="text-sky-600 font-bold text-[10px] hover:underline" onclick="editarDefecto('${x.id}')">Editar</button>
        <button class="text-rose-500 font-bold text-[10px] hover:underline" onclick="eliminarDefecto('${x.id}')">Eliminar</button>
      </div>
    </div>
  `).join('') : '<p class="text-slate-500 italic text-xs">No hay defectos de calidad registrados en este turno.</p>';
}

// ==========================================================
// EXPOSICIÓN A window
// ----------------------------------------------------------
// abrirDefecto, guardarDefecto: llamadas desde index.html.
// editarDefecto, eliminarDefecto, eliminarDefectoActual,
// eliminarDefectoDirecta: llamadas desde onclick generado
// dentro de este mismo módulo (renderDefectos) y desde
// el modal de edición.
// ==========================================================
window.abrirDefecto = abrirDefecto;
window.guardarDefecto = guardarDefecto;
window.editarDefecto = editarDefecto;
window.eliminarDefecto = eliminarDefecto;
window.eliminarDefectoActual = eliminarDefectoActual;
window.eliminarDefectoDirecta = eliminarDefectoDirecta;