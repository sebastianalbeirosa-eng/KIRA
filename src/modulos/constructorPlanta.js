/* ========================================================== */
/* CONSTRUCTOR-PLANTA.JS — Alta y edición dinámica de planta   */
/* ========================================================== */
/*
  Permite crear/editar/reordenar/archivar líneas y equipos sin
  tocar código — reemplaza el viejo esquema hardcodeado L1/L2.

  NOTA DE ARQUITECTURA (dependencia circular controlada):
  sincronizarPlanta() vive acá porque solo se llama desde dentro
  de este módulo, pero necesita refrescarSelectoresLineas() de
  app.js. A su vez, app.js necesita renderConstructor() de acá
  para armar mostrarTab(). Es una dependencia circular entre
  app.js y este archivo, pero es SEGURA en ES6 modules porque
  ambas referencias se usan solo dentro de cuerpos de función
  (nunca al cargar el módulo), momento en el que ya están
  resueltas. Si algún día da problemas, la señal de alerta sería
  un error "cannot access before initialization" al arrancar.
*/

import { db, persistir, crearId } from '../nucleo/almacenamiento.js';
import { valor, esc, abrir, cerrar } from '../nucleo/utilidades.js';
import { lineaPorId, normalizarEquipoHistorico, actualizarIndiceEquipos, areaEquipo } from '../nucleo/estado.js';
import { renderTodo } from './vistaDePlanta.js';
import { refrescarSelectoresLineas } from '../app.js';
import { areaDelRol } from '../nucleo/roles.js';

/**
 * Equipos de una línea que el rol actual puede ver/editar en el Constructor.
 * Calidad ve solo equipos de calidad (Qualitron); producción solo los suyos;
 * admin/supervisor (areaDelRol()===null) ven todos. Así, si calidad elimina o
 * agrega equipos, no toca los de producción y viceversa.
 */
function equiposVisiblesConstructor(linea) {
  const area = areaDelRol();
  if (!area) return linea.equipos;
  return linea.equipos.filter(e => (e.area || 'produccion') === area);
}

// Recuerda qué línea está seleccionada en el panel del Constructor.
let lineaConstructorSeleccionada = '';

/** Dibuja la lista de líneas de producción configuradas, con sus controles de orden/edición/archivado. */
export function renderConstructor() {
  const lineas = db.planta.lineas;
  if (!lineaConstructorSeleccionada || !lineas.some(l => l.id === lineaConstructorSeleccionada)) {
    lineaConstructorSeleccionada = lineas[0]?.id || '';
  }

  document.getElementById('contadorLineas').textContent = lineas.length;
  document.getElementById('constructorLineas').innerHTML = lineas.length ? lineas.map((l, idx) => `
    <div class="border ${l.id === lineaConstructorSeleccionada ? 'border-sky-400 bg-sky-50' : 'border-slate-200 bg-white'} rounded p-2">
      <button class="w-full text-left" onclick="seleccionarLineaConstructor('${l.id}')">
        <div class="flex justify-between items-start gap-2">
          <div>
            <b class="text-xs text-slate-800">${esc(l.nombre)}</b>
            <div class="text-[10px] text-slate-500">${esc(l.descripcion || 'Sin descripción')}</div>
          </div>
          <span class="badge ${l.activa !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}">${l.activa !== false ? 'ACTIVA' : 'ARCHIVADA'}</span>
        </div>
      </button>
      <div class="flex flex-wrap gap-1 mt-2 no-print">
        <button class="btn bg-slate-100 border border-slate-300 text-slate-700 text-[10px] py-1 px-2" onclick="moverLinea('${l.id}',-1)" ${idx === 0 ? 'disabled' : ''}>Subir</button>
        <button class="btn bg-slate-100 border border-slate-300 text-slate-700 text-[10px] py-1 px-2" onclick="moverLinea('${l.id}',1)" ${idx === lineas.length - 1 ? 'disabled' : ''}>Bajar</button>
        <button class="btn bg-sky-50 border border-sky-200 text-sky-700 text-[10px] py-1 px-2" onclick="abrirEditorLinea('${l.id}')">Editar</button>
        <button class="btn ${l.activa !== false ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'} border text-[10px] py-1 px-2" onclick="alternarLinea('${l.id}')">${l.activa !== false ? 'Eliminar' : 'Restaurar'}</button>
      </div>
    </div>
  `).join('') : '<p class="text-xs text-slate-500 italic">No hay líneas configuradas.</p>';

  renderEquiposConstructor();
}

/** Cambia la línea seleccionada en el panel del Constructor y refresca su lista de equipos. */
export function seleccionarLineaConstructor(id) {
  lineaConstructorSeleccionada = id;
  renderConstructor();
}

/** Dibuja la tabla de equipos de la línea actualmente seleccionada en el Constructor. */
export function renderEquiposConstructor() {
  const linea = lineaPorId(lineaConstructorSeleccionada);
  const cont = document.getElementById('constructorEquipos');
  const btn = document.getElementById('btnAgregarEquipo');
  if (!linea) {
    document.getElementById('tituloEquiposConstructor').textContent = 'Equipos de la línea';
    document.getElementById('detalleLineaConstructor').textContent = 'Seleccione una línea para administrar sus equipos.';
    btn.disabled = true;
    cont.innerHTML = '';
    return;
  }

  // El rol calidad no administra equipos (los maneja producción): usa el
  // Constructor solo para crear/gestionar líneas donde luego carga su planilla.
  if (areaDelRol() === 'calidad') {
    document.getElementById('tituloEquiposConstructor').textContent = `Equipos · ${linea.nombre}`;
    document.getElementById('detalleLineaConstructor').textContent = 'Los equipos de la línea los administra producción. Calidad usa las líneas para cargar su planilla.';
    btn.disabled = true;
    btn.classList.add('hidden');
    cont.innerHTML = '<p class="text-xs text-slate-500 italic p-3">Esta línea ya queda disponible en "Área monitoreada" para cargar la planilla de calidad.</p>';
    return;
  }

  // Solo los equipos del área del rol (producción ve los suyos).
  const visibles = equiposVisiblesConstructor(linea);
  document.getElementById('tituloEquiposConstructor').textContent = `Equipos · ${linea.nombre}`;
  document.getElementById('detalleLineaConstructor').textContent = `${visibles.length} equipos configurados · el orden coincide con el sinóptico.`;
  btn.disabled = linea.activa === false;

  cont.innerHTML = visibles.length ? `
    <table class="table w-full text-xs text-slate-800">
      <thead><tr><th>Orden</th><th>Equipo</th><th>Tipo</th><th>Estado</th><th class="no-print">Acciones</th></tr></thead>
      <tbody>${visibles.map((e, idx) => `
        <tr>
          <td class="whitespace-nowrap font-bold">EQ-${String(idx + 1).padStart(2, '0')}</td>
          <td><b>${esc(e.nombre)}</b></td>
          <td>${esc(e.tipo || 'General')}</td>
          <td><span class="badge ${e.activo !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}">${e.activo !== false ? 'ACTIVO' : 'ARCHIVADO'}</span></td>
          <td class="no-print whitespace-nowrap">
            <button class="text-slate-600 font-bold mr-2" onclick="moverEquipo('${linea.id}','${e.id}',-1)" ${idx === 0 ? 'disabled' : ''}>↑</button>
            <button class="text-slate-600 font-bold mr-2" onclick="moverEquipo('${linea.id}','${e.id}',1)" ${idx === visibles.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="text-sky-700 font-bold mr-2" onclick="abrirEditorEquipo('${e.id}')">Editar</button>
            <button class="${e.activo !== false ? 'text-rose-700' : 'text-emerald-700'} font-bold" onclick="alternarEquipo('${linea.id}','${e.id}')">${e.activo !== false ? 'Eliminar' : 'Restaurar'}</button>
          </td>
        </tr>
      `).join('')}</tbody>
    </table>
  ` : '<p class="text-xs text-slate-500 italic p-3">Esta línea todavía no tiene equipos de esta área.</p>';
}

/** Abre el modal del Constructor en modo "línea" (alta si id vacío, edición si viene con id). */
export function abrirEditorLinea(id = '') {
  const linea = id ? lineaPorId(id) : null;
  document.getElementById('cModo').value = 'linea';
  document.getElementById('cId').value = linea?.id || '';
  document.getElementById('cLineaId').value = '';
  document.getElementById('cNombre').value = linea?.nombre || '';
  document.getElementById('cDescripcion').value = linea?.descripcion || '';
  document.getElementById('tituloModalConstructor').textContent = linea ? 'Editar línea de producción' : 'Agregar línea de producción';
  document.getElementById('campoDescripcionConstructor').classList.remove('hidden');
  document.getElementById('campoTipoConstructor').classList.add('hidden');
  abrir('modalConstructor');
}

/** Abre el modal del Constructor en modo "equipo" (alta si id vacío, edición si viene con id). */
export function abrirEditorEquipo(id = '') {
  const linea = lineaPorId(lineaConstructorSeleccionada);
  if (!linea || linea.activa === false) return;
  const equipo = id ? linea.equipos.find(e => e.id === id) : null;
  document.getElementById('cModo').value = 'equipo';
  document.getElementById('cId').value = equipo?.id || '';
  document.getElementById('cLineaId').value = linea.id;
  document.getElementById('cNombre').value = equipo?.nombre || '';
  document.getElementById('cDescripcion').value = '';
  document.getElementById('cTipo').value = equipo?.tipo || 'General';
  document.getElementById('tituloModalConstructor').textContent = equipo ? `Editar equipo · ${linea.nombre}` : `Agregar equipo · ${linea.nombre}`;
  document.getElementById('campoDescripcionConstructor').classList.add('hidden');
  document.getElementById('campoTipoConstructor').classList.remove('hidden');
  abrir('modalConstructor');
}

/** Guarda (alta o edición) una línea o equipo del formulario modal del Constructor. */
export function guardarElementoPlanta(e) {
  e.preventDefault();
  const modo = valor('cModo');
  const id = valor('cId');
  const nombre = valor('cNombre').trim();
  if (!nombre) return;

  if (modo === 'linea') {
    if (id) {
      const linea = lineaPorId(id);
      linea.nombre = nombre;
      linea.descripcion = valor('cDescripcion').trim();
    } else {
      const nueva = { id: crearId('LINEA'), nombre, descripcion: valor('cDescripcion').trim(), activa: true, equipos: [] };
      db.planta.lineas.push(nueva);
      lineaConstructorSeleccionada = nueva.id;
    }
  } else {
    const linea = lineaPorId(valor('cLineaId'));
    if (!linea) return;
    if (id) {
      const equipo = linea.equipos.find(x => x.id === id);
      equipo.nombre = nombre;
      equipo.tipo = valor('cTipo');
    } else {
      // El equipo nuevo hereda el área del rol que lo crea (calidad o
      // producción). Para admin (sin área fija) se deduce del nombre.
      const area = areaDelRol() || areaEquipo(nombre);
      linea.equipos.push({ id: crearId('EQ'), nombre, tipo: valor('cTipo'), area, activo: true });
    }
  }

  cerrar('modalConstructor');
  sincronizarPlanta();
}

/** Mueve una línea de producción una posición hacia arriba o abajo en el orden. */
export function moverLinea(id, delta) {
  const arr = db.planta.lineas;
  const i = arr.findIndex(l => l.id === id), destino = i + delta;
  if (i < 0 || destino < 0 || destino >= arr.length) return;
  [arr[i], arr[destino]] = [arr[destino], arr[i]];
  sincronizarPlanta();
}

/**
 * Mueve un equipo una posición hacia arriba o abajo dentro de su línea.
 * El movimiento es relativo a los equipos VISIBLES del área del rol: se
 * intercambia con el vecino visible más cercano, para que reordenar en el
 * panel de calidad no altere la posición de los equipos de producción.
 */
export function moverEquipo(lineaId, equipoId, delta) {
  const linea = lineaPorId(lineaId);
  const arr = linea?.equipos;
  if (!arr) return;
  const visibles = equiposVisiblesConstructor(linea);
  const vIdx = visibles.findIndex(e => e.id === equipoId);
  const vDest = vIdx + delta;
  if (vIdx < 0 || vDest < 0 || vDest >= visibles.length) return;
  // Traducir posiciones visibles a índices reales dentro de linea.equipos.
  const i = arr.findIndex(e => e.id === equipoId);
  const destino = arr.findIndex(e => e.id === visibles[vDest].id);
  if (i < 0 || destino < 0) return;
  [arr[i], arr[destino]] = [arr[destino], arr[i]];
  sincronizarPlanta();
}

/** Verifica si una línea tiene paradas o acciones registradas en algún turno histórico. */
export function lineaTieneHistorial(id) {
  return Object.values(db.sesiones).some(s =>
    (s.paradas || []).some(p => p.linea === id) ||
    (s.acciones || []).some(a => a.linea === id)
  );
}

/** Verifica si un equipo tiene paradas registradas en algún turno histórico. */
export function equipoTieneHistorial(lineaId, equipo) {
  return Object.values(db.sesiones).some(s =>
    (s.paradas || []).some(p => p.linea === lineaId && (p.equipoId === equipo.id || normalizarEquipoHistorico(p.equipo) === equipo.nombre))
  );
}

/**
 * Activa/archiva/elimina una línea. Si tiene historial, se archiva (para no perder
 * datos); si no tiene historial, se elimina directamente de la configuración.
 * NOTA: usa confirm() nativo en vez de mostrarConfirmacionKira — así estaba en el
 * código original. Podría unificarse en una futura pasada de pulido de UX.
 */
export function alternarLinea(id) {
  const linea = lineaPorId(id);
  if (!linea) return;
  if (linea.activa === false) {
    linea.activa = true;
  } else {
    const conHistorial = lineaTieneHistorial(id);
    const texto = conHistorial
      ? 'Esta línea tiene historial. Se archivará y dejará de aparecer en la operación, pero sus registros se conservarán. ¿Continuar?'
      : 'Esta línea no tiene historial y se eliminará de la configuración. ¿Continuar?';
    if (!confirm(texto)) return;
    if (conHistorial) linea.activa = false;
    else {
      db.planta.lineas = db.planta.lineas.filter(l => l.id !== id);
      lineaConstructorSeleccionada = db.planta.lineas[0]?.id || '';
    }
  }
  sincronizarPlanta();
}

/** Activa/archiva/elimina un equipo, con la misma lógica de conservación de historial que alternarLinea(). */
export function alternarEquipo(lineaId, equipoId) {
  const linea = lineaPorId(lineaId);
  const equipo = linea?.equipos.find(e => e.id === equipoId);
  if (!linea || !equipo) return;
  if (equipo.activo === false) {
    equipo.activo = true;
  } else {
    const conHistorial = equipoTieneHistorial(lineaId, equipo);
    const texto = conHistorial
      ? 'Este equipo tiene historial. Se archivará, pero sus registros se conservarán. ¿Continuar?'
      : 'Este equipo no tiene historial y se eliminará de la configuración. ¿Continuar?';
    if (!confirm(texto)) return;
    if (conHistorial) equipo.activo = false;
    else linea.equipos = linea.equipos.filter(e => e.id !== equipoId);
  }
  sincronizarPlanta();
}

/**
 * Sincroniza todo el sistema tras un cambio en el modelo de planta: reconstruye
 * el índice de equipos, repuebla los selectores de línea, persiste y refresca
 * tanto el propio Constructor como el dashboard operativo.
 */
export function sincronizarPlanta() {
  actualizarIndiceEquipos();
  refrescarSelectoresLineas();
  persistir();
  renderConstructor();
  renderTodo();
}

// ==========================================================
// EXPOSICIÓN A window
// ----------------------------------------------------------
// Todas estas funciones se llaman desde onclick generado dentro
// de este mismo módulo (botones de línea/equipo), salvo
// guardarElementoPlanta que además es onsubmit en index.html.
// ==========================================================
window.seleccionarLineaConstructor = seleccionarLineaConstructor;
window.abrirEditorLinea = abrirEditorLinea;
window.abrirEditorEquipo = abrirEditorEquipo;
window.guardarElementoPlanta = guardarElementoPlanta;
window.moverLinea = moverLinea;
window.moverEquipo = moverEquipo;
window.alternarLinea = alternarLinea;
window.alternarEquipo = alternarEquipo;