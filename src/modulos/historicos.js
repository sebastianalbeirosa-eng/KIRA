/* ========================================================== */
/* HISTORICOS.JS — Tablas históricas de paradas/acciones/defectos */
/* ========================================================== */
/*
  Reúne los registros de TODAS las sesiones (todos los turnos
  guardados, no solo el actual) para armar las 3 tablas históricas
  con filtros por fecha/línea/turno/producto/formato/texto libre.
*/

import { db, persistir } from '../nucleo/almacenamiento.js';
import { valor, esc, fmtFecha } from '../nucleo/utilidades.js';
import { nombreLinea } from '../nucleo/estado.js';
import { mostrarConfirmacionKira } from '../nucleo/alertasKira.js';
import { renderTodo } from './vistaDePlanta.js';

/** Devuelve TODAS las paradas de TODAS las sesiones guardadas, con fecha/turno/producto/formato ya resueltos. */
export function todasParadas() {
  return Object.entries(db.sesiones).flatMap(([key, s]) => {
    const [fecha, turno] = key.split('|');
    const prodLinea = s.productoPorLinea || {};
    return s.paradas.map(x => ({
      ...x,
      fecha,
      turno,
      producto: prodLinea[x.linea]?.producto || '',
      formato: prodLinea[x.linea]?.formato || ''
    }));
  });
}

/** Devuelve TODAS las acciones correctivas de TODAS las sesiones guardadas. */
export function todasAcciones() {
  return Object.entries(db.sesiones).flatMap(([key, s]) => {
    const [fecha, turno] = key.split('|');
    return (s.acciones || []).map(x => ({ ...x, fecha, turno }));
  });
}

/** Devuelve TODOS los defectos de calidad de TODAS las sesiones guardadas. */
export function todasDefectos() {
  return Object.entries(db.sesiones).flatMap(([key, s]) => {
    const [fecha, turno] = key.split('|');
    return (s.defectos || []).map(x => ({ ...x, fecha, turno }));
  });
}

/** Dibuja las 3 tablas históricas (paradas, acciones, defectos) según los filtros activos en pantalla. */
export function renderHistorico() {
  const desde = valor('histDesde');
  const hasta = valor('histHasta');
  const linea = valor('histLinea');
  const turnoFiltro = valor('histTurno');
  const productoFiltro = valor('histProducto').trim().toLowerCase();
  const formatoFiltro = valor('histFormato').trim().toLowerCase();
  const buscar = valor('histBuscar').trim().toLowerCase();

  const regs = todasParadas().filter(x => {
    if (desde && x.fecha < desde) return false;
    if (hasta && x.fecha > hasta) return false;
    if (linea && x.linea !== linea) return false;
    if (turnoFiltro && x.turno !== turnoFiltro) return false;
    if (productoFiltro && !x.producto.toLowerCase().includes(productoFiltro)) return false;
    if (formatoFiltro && !x.formato.toLowerCase().includes(formatoFiltro)) return false;
    if (buscar) {
      const campos = `${x.producto} ${x.formato} ${x.equipo} ${x.motivo} ${x.obs || ''}`.toLowerCase();
      if (!campos.includes(buscar)) return false;
    }
    return true;
  }).sort((a, b) => (b.fecha + b.turno).localeCompare(a.fecha + a.turno));

  document.getElementById('tablaHistorico').innerHTML = regs.length ? regs.map(x => `
    <tr>
      <td class="text-center">${fmtFecha(x.fecha)}</td>
      <td class="text-center">${esc(x.turno)}</td>
      <td class="text-center">${esc(nombreLinea(x.linea))}</td>
      <td class="text-center">${esc(x.producto || '—')}</td>
      <td class="text-center">${esc(x.formato || '—')}</td>
      <td class="text-center"><b>${esc(x.equipo)}</b></td>
      <td class="text-center">${x.minutos} min</td>
      <td class="text-center">${x.vacio} min</td>
      <td class="text-center">${esc(x.motivo)}</td>
      <td>${esc(x.obs || '')}</td>
      <td class="no-print text-center"><button class="accion-editable text-rose-600 font-bold hover:underline" onclick="eliminarParada('${x.fecha}','${esc(x.turno)}','${x.id}')">Eliminar</button></td>
    </tr>
  `).join('') : '<tr><td colspan="11" class="text-center text-slate-500">Sin registros para el filtro seleccionado.</td></tr>';

  const regsAcciones = todasAcciones().filter(x => {
    if (desde && x.fecha < desde) return false;
    if (hasta && x.fecha > hasta) return false;
    if (linea && x.linea !== linea) return false;
    if (turnoFiltro && x.turno !== turnoFiltro) return false;
    if (buscar) {
      const campos = `${x.equipo} ${x.detalle} ${x.responsable || ''}`.toLowerCase();
      if (!campos.includes(buscar)) return false;
    }
    return true;
  }).sort((a, b) => (b.fecha + b.turno).localeCompare(a.fecha + a.turno));

  document.getElementById('tablaHistoricoAcciones').innerHTML = regsAcciones.length ? regsAcciones.map(x => `
    <tr>
      <td class="text-center">${fmtFecha(x.fecha)}</td>
      <td class="text-center">${esc(x.turno)}</td>
      <td class="text-center">${esc(nombreLinea(x.linea))}</td>
      <td class="text-center">${esc(x.hora)}</td>
      <td class="text-center"><b>${esc(x.equipo)}</b></td>
      <td>${esc(x.detalle)}</td>
      <td class="text-center">${esc(x.responsable || '—')}</td>
      <td class="no-print text-center"><button class="accion-editable text-rose-600 font-bold hover:underline" onclick="eliminarAccionHistorico('${x.fecha}','${esc(x.turno)}','${x.id}')">Eliminar</button></td>
    </tr>
  `).join('') : '<tr><td colspan="8" class="text-center text-slate-500">Sin registros para el filtro seleccionado.</td></tr>';

  const regsDefectos = todasDefectos().filter(x => {
    if (desde && x.fecha < desde) return false;
    if (hasta && x.fecha > hasta) return false;
    if (linea && x.linea !== linea) return false;
    if (turnoFiltro && x.turno !== turnoFiltro) return false;
    if (buscar) {
      const campos = `${x.nombre} ${x.accion || ''} ${x.obs || ''}`.toLowerCase();
      if (!campos.includes(buscar)) return false;
    }
    return true;
  }).sort((a, b) => (b.fecha + b.turno).localeCompare(a.fecha + a.turno));

  document.getElementById('tablaHistoricoDefectos').innerHTML = regsDefectos.length ? regsDefectos.map(x => `
    <tr>
      <td class="text-center">${fmtFecha(x.fecha)}</td>
      <td class="text-center">${esc(x.turno)}</td>
      <td class="text-center">${esc(nombreLinea(x.linea))}</td>
      <td class="text-center"><b>${esc(x.nombre)}</b></td>
      <td class="text-center">${x.porcentaje}%</td>
      <td>${esc(x.accion || '')}</td>
      <td>${esc(x.obs || '')}</td>
      <td class="no-print text-center"><button class="accion-editable text-rose-600 font-bold hover:underline" onclick="eliminarDefectoHistorico('${x.fecha}','${esc(x.turno)}','${x.id}')">Eliminar</button></td>
    </tr>
  `).join('') : '<tr><td colspan="8" class="text-center text-slate-500">Sin registros para el filtro seleccionado.</td></tr>';
}

/** Elimina permanentemente una parada del histórico (afecta a la sesión de esa fecha/turno específica, no solo a la actual). */
export function eliminarParada(fecha, turno, id) {
  mostrarConfirmacionKira('¿Eliminar este registro de forma permanente?', 'Eliminar del Histórico', () => {
    const s = db.sesiones[`${fecha}|${turno}`];
    if (s) {
      s.paradas = s.paradas.filter(x => x.id !== id);
      persistir();
      renderHistorico();
      renderTodo();
    }
  }, 'Eliminar');
}

/** Elimina permanentemente una acción correctiva del histórico. */
export function eliminarAccionHistorico(fecha, turno, id) {
  mostrarConfirmacionKira('¿Eliminar este registro de forma permanente?', 'Eliminar del Histórico', () => {
    const s = db.sesiones[`${fecha}|${turno}`];
    if (s) {
      s.acciones = s.acciones.filter(x => x.id !== id);
      persistir();
      renderHistorico();
      renderTodo();
    }
  }, 'Eliminar');
}

/** Elimina permanentemente un defecto de calidad del histórico. */
export function eliminarDefectoHistorico(fecha, turno, id) {
  mostrarConfirmacionKira('¿Eliminar este registro de forma permanente?', 'Eliminar del Histórico', () => {
    const s = db.sesiones[`${fecha}|${turno}`];
    if (s) {
      s.defectos = s.defectos.filter(x => x.id !== id);
      persistir();
      renderHistorico();
      renderTodo();
    }
  }, 'Eliminar');
}

// ==========================================================
// EXPOSICIÓN A window
// ----------------------------------------------------------
// renderHistorico: se llama desde oninput="..." (buscador) y
// onclick="..." (botón "Aplicar filtros") en index.html.
// eliminarParada, eliminarAccionHistorico, eliminarDefectoHistorico:
// se llaman desde onclick generado dentro de este mismo módulo
// (botones "Eliminar" de cada fila de las tablas históricas).
// ==========================================================
window.renderHistorico = renderHistorico;
window.eliminarParada = eliminarParada;
window.eliminarAccionHistorico = eliminarAccionHistorico;
window.eliminarDefectoHistorico = eliminarDefectoHistorico;