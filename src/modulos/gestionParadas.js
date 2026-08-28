/* ========================================================== */
/* GESTION-PARADAS.JS — CRUD de paradas de máquina            */
/* ========================================================== */
/*
  Maneja el modal de registro de paradas, el panel de gestión
  por equipo (accesible desde el mapa de calor de Vista de Planta),
  y el guardado/eliminación de registros de tiempo muerto.

  Depende de renderTodo() (modulos/vistaDePlanta.js), todavía
  pendiente de cortar — hasta entonces este módulo no corre solo.
*/

import { db, persistir } from '../nucleo/almacenamiento.js';
import { valor, numero, esc, abrir, cerrar } from '../nucleo/utilidades.js';
import { sesion, lineasActivas, nombreLinea, equipoPorId, equipoPorNombre } from '../nucleo/estado.js';
import { cargarEquipos, cargarMotivos, guardarMotivoSiEsNuevo, actualizarSubEquipoSelect } from './clasificacionEquipos.js';
import { mostrarAlertaKira, mostrarConfirmacionKira } from '../nucleo/alertasKira.js';

import { renderTodo } from './vistaDePlanta.js';

// ==========================================================
// ESTADO LOCAL DEL MÓDULO
// ----------------------------------------------------------
// Variables que recuerdan sobre qué equipo se está gestionando
// en el panel "Gestión de Equipo" (modal modalMaquinaGestion).
// ==========================================================
let currentGestLine = '';
let currentGestEquipo = '';
let currentGestEquipoId = '';

/**
 * Abre el modal de registro/edición de una parada.
 * @param {string} linea - Línea preseleccionada (opcional)
 * @param {string} equipo - Equipo preseleccionado (opcional)
 * @param {Object|null} paradaObj - Si viene con datos, es edición; si no, es alta nueva
 */
export function abrirParada(linea = '', equipo = '', paradaObj = null) {
  const primeraLinea = lineasActivas()[0]?.id || 'GENERAL';
  const l = linea || (valor('lineaVista') === 'TODAS' ? primeraLinea : valor('lineaVista'));
  document.getElementById('pLinea').value = l;
  document.getElementById('pLineaDisplay').value = nombreLinea(l);

  cargarEquipos(l, equipo);

  if (paradaObj) {
    // CASO: MODIFICANDO UN REGISTRO EXISTENTE
    document.getElementById('modalParadaTitulo').textContent = 'Modificar registro de parada';
    document.getElementById('editParadaId').value = paradaObj.id;
    document.getElementById('pHora').value = paradaObj.hora || new Date().toTimeString().slice(0, 5);

    let baseEq = equipoPorId(l, paradaObj.equipoId)?.nombre || paradaObj.equipo;
    const equipoRegistrado = paradaObj.equipo || '';
    let subVal = '1';
    if (equipoRegistrado.includes('SIMA 1')) { baseEq = 'Maxi SIMA'; subVal = '1'; }
    else if (equipoRegistrado.includes('SIMA 2')) { baseEq = 'Maxi SIMA'; subVal = '2'; }
    else if (equipoRegistrado.includes('SITI 1')) { baseEq = 'Maxi SITI'; subVal = '1'; }
    else if (equipoRegistrado.includes('SITI 2')) { baseEq = 'Maxi SITI'; subVal = '2'; }

    document.getElementById('pEquipo').value = baseEq;
    actualizarSubEquipoSelect();
    if (document.getElementById('pSubEquipo')) document.getElementById('pSubEquipo').value = subVal;

    cargarMotivos();
    const motivoInput = document.getElementById('pMotivo');
    motivoInput.value = paradaObj.motivo || ''; // Carga el motivo real de este registro
    document.getElementById('pMinutos').value = paradaObj.minutos;
    document.getElementById('pVacio').value = paradaObj.vacio;
    document.getElementById('pEventos').value = paradaObj.eventos;
    document.getElementById('pObs').value = paradaObj.obs || '';

    document.getElementById('btnEliminarContainer').innerHTML = `<button type="button" class="btn bg-rose-600 text-white text-xs hover:bg-rose-700" onclick="eliminarParadaActual('${paradaObj.id}')">Eliminar parada</button>`;
  } else {
    // CASO: NUEVA PARADA (Aquí aseguramos el reseteo limpio)
    document.getElementById('modalParadaTitulo').textContent = 'Registrar parada';
    document.getElementById('editParadaId').value = '';
    document.getElementById('pHora').value = new Date().toTimeString().slice(0, 5);

    // LIMPIEZA EXPLÍCITA DEL MOTIVO ANTERIOR
    const motivoInput = document.getElementById('pMotivo');
    if (motivoInput) motivoInput.value = '';

    document.getElementById('pMinutos').value = '';
    document.getElementById('pVacio').value = '';
    document.getElementById('pEventos').value = 1;
    document.getElementById('pObs').value = '';
    document.getElementById('btnEliminarContainer').innerHTML = '';
  }

  // Actualizar también la lista de motivos sugeridos según la máquina seleccionada
  cargarMotivos();

  abrir('modalParada');
}

/** Abre el panel de gestión de paradas para un equipo específico (desde el mapa de calor). */
export function abrirGestionEquipo(linea, equipoBaseCodificado, equipoId = '') {
  const equipoBase = decodeURIComponent(equipoBaseCodificado);
  currentGestLine = linea;
  currentGestEquipo = equipoBase;
  currentGestEquipoId = equipoId || equipoPorNombre(linea, equipoBase)?.id || '';
  document.getElementById('gestEquipoTitulo').textContent = `Equipo: ${equipoBase} (${nombreLinea(linea)})`;
  renderListaParadasEquipo();
  abrir('modalMaquinaGestion');
}

/** Dibuja la lista de paradas registradas para el equipo actualmente en gestión. */
export function renderListaParadasEquipo() {
  const regs = sesion().paradas.filter(x => {
    if (x.linea !== currentGestLine) return false;
    if (currentGestEquipoId && x.equipoId) return x.equipoId === currentGestEquipoId;
    let eqClean = x.equipo;
    if (eqClean.includes('Maxi SIMA') || eqClean.includes('Maxi SITI')) {
      eqClean = eqClean.replace(/ [12]$/, '');
    }
    return eqClean === currentGestEquipo;
  });

  const container = document.getElementById('listaParadasEquipo');
  if (!regs.length) {
    container.innerHTML = `<p class="text-xs text-slate-500 italic p-2">No hay paradas registradas para este equipo en el turno actual.</p>`;
    return;
  }

  container.innerHTML = regs.map(x => `
    <div class="flex justify-between items-center bg-white p-2 border border-slate-200 rounded shadow-sm text-xs">
      <div>
        <b>${esc(x.equipo)}</b> — ${x.minutos} min (Vacío: ${x.vacio} min)<br>
        <span class="text-slate-500">Motivo: ${esc(x.motivo)}</span>
        ${x.obs ? `<br><span class="text-slate-400 italic">Obs: ${esc(x.obs)}</span>` : ''}
      </div>
      <div class="flex gap-1">
        <button class="btn bg-sky-600 text-white text-[10px] py-1 px-2 hover:bg-sky-700" onclick="editarParadaEquipo('${x.id}')">Editar</button>
        <button class="btn bg-rose-600 text-white text-[10px] py-1 px-2 hover:bg-rose-700" onclick="eliminarParadaDirecta('${x.id}')">Eliminar</button>
      </div>
    </div>
  `).join('');
}

/** Cierra el panel de gestión de equipo y abre el modal de parada en modo edición. */
export function editarParadaEquipo(id) {
  const parada = sesion().paradas.find(x => x.id === id);
  if (!parada) return;
  cerrar('modalMaquinaGestion');
  abrirParada(parada.linea, parada.equipo, parada);
}

/** Abre una parada nueva pre-cargando la línea/equipo del panel de gestión actual. */
export function abrirParadaDesdeEquipoGest() {
  cerrar('modalMaquinaGestion');
  abrirParada(currentGestLine, currentGestEquipo);
}

/** Guarda (alta o edición) el registro de parada del formulario modal. */
export function guardarParada(e) {
  e.preventDefault();

  const editId = document.getElementById('editParadaId').value;
  const linea = valor('pLinea');
  let equipo = document.getElementById('pEquipo').value;
  const motivo = valor('pMotivo').trim();
  const hora = valor('pHora'); // Captura de la hora ingresada

  if (!motivo) {
    mostrarAlertaKira('Debe ingresar un motivo de parada.', 'Campo Requerido', 'error', () => {
      document.getElementById('pMotivo')?.focus();
    });
    return;
  }

  guardarMotivoSiEsNuevo(motivo);

  const subContainer = document.getElementById('subEquipoContainer');
  if (!subContainer.classList.contains('hidden')) {
    const subVal = document.getElementById('pSubEquipo').value;
    equipo = `${equipo} ${subVal}`;
  }

  const item = {
    id: editId || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
    fecha: valor('fecha'),
    turno: valor('turno'),
    linea: linea,
    hora: hora, // Se incluye la hora en el registro
    equipo: equipo,
    equipoId: document.getElementById('pEquipo').selectedOptions[0]?.dataset.equipoId || '',
    motivo,
    minutos: numero('pMinutos'),
    vacio: numero('pVacio'),
    eventos: numero('pEventos'),
    obs: valor('pObs').trim(),
    creado: new Date().toISOString()
  };

  const s = sesion();
  if (editId) {
    const idx = s.paradas.findIndex(x => x.id === editId);
    if (idx !== -1) s.paradas[idx] = item;
  } else {
    s.paradas.push(item);
  }

  s.actualizada = new Date().toISOString();
  persistir();
  cerrar('modalParada');
  renderTodo();
}

/*
  GESTIÓN DE ELIMINACIÓN DE PARADAS
*/

/** Pide confirmación antes de eliminar una parada (desde el modal de edición). */
export function eliminarParadaActual(id) {
  mostrarConfirmacionKira('¿Eliminar este registro de parada?', 'Eliminar Parada', () => {
    eliminarParadaDirecta(id);
    cerrar('modalParada');
  }, 'Eliminar');
}

/** Elimina una parada directamente (usado desde el panel de gestión por equipo, sin doble confirmación). */
export function eliminarParadaDirecta(id) {
  const s = sesion();
  s.paradas = s.paradas.filter(x => x.id !== id);
  s.actualizada = new Date().toISOString();
  persistir();
  renderTodo();
  if (typeof renderListaParadasEquipo === 'function') {
    renderListaParadasEquipo();
  }
}

// ==========================================================
// EXPOSICIÓN A window
// ----------------------------------------------------------
// abrirParada y abrirParadaDesdeEquipoGest: llamadas desde index.html.
// guardarParada: onsubmit del formulario en index.html.
// abrirGestionEquipo: llamada desde onclick generado en renderMaquinas()
//   (modulos/vistaDePlanta.js).
// editarParadaEquipo, eliminarParadaDirecta, eliminarParadaActual:
//   llamadas desde onclick generado dentro de este mismo módulo.
// ==========================================================
window.abrirParada = abrirParada;
window.abrirGestionEquipo = abrirGestionEquipo;
window.editarParadaEquipo = editarParadaEquipo;
window.abrirParadaDesdeEquipoGest = abrirParadaDesdeEquipoGest;
window.guardarParada = guardarParada;
window.eliminarParadaActual = eliminarParadaActual;
window.eliminarParadaDirecta = eliminarParadaDirecta;