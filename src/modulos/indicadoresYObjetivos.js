/* ========================================================== */
/* INDICADORES-Y-OBJETIVOS.JS — Objetivos vs. real por línea   */
/* ========================================================== */
/*
  Modal donde el supervisor carga los objetivos del turno
  (calidad, producción, vacío, rendimiento de quemado) y los
  valores reales medidos. Alimenta directamente los KPIs
  industriales que se ven en Vista de Planta.
*/

import { persistir } from '../nucleo/almacenamiento.js';
import { abrir, cerrar, esc } from '../nucleo/utilidades.js';
import {
  sesion, lineasActivas, asegurarObjetivosSesion,
  formatosHornoGuardados, guardarFormatosHorno
} from '../nucleo/estado.js';
import { mostrarAlertaKira } from '../nucleo/alertasKira.js';
import { renderTodo, renderVistaPlanta } from './vistaDePlanta.js';
import {
  listarFormatos, obtenerFormato, agregarFormato, fijarCatalogoFormatos,
  m2PorHoraPorId, proyectarProduccionTurno, rendimientoEnToma, CICLO_MIN, CICLO_MAX
} from '../nucleo/horno.js';

// Al cargar el módulo, sincronizar el catálogo de formatos del horno con lo
// que haya guardado el usuario (formatos personalizados persistidos).
const formatosPersistidos = formatosHornoGuardados();
if (formatosPersistidos) fijarCatalogoFormatos(formatosPersistidos);

/** Opciones <option> de formatos para los selects de cada toma. */
function opcionesFormato(seleccionado) {
  return ['<option value="">Formato…</option>']
    .concat(listarFormatos().map(f =>
      `<option value="${f.id}" ${f.id === seleccionado ? 'selected' : ''}>${esc(f.nombre)}</option>`))
    .join('');
}

/** Opciones <option> de ciclos (minutos) para los selects de cada toma. */
function opcionesCiclo(seleccionado) {
  const opts = ['<option value="">Ciclo…</option>'];
  for (let c = CICLO_MIN; c <= CICLO_MAX; c++) {
    opts.push(`<option value="${c}" ${Number(seleccionado) === c ? 'selected' : ''}>${c} min</option>`);
  }
  return opts.join('');
}

/**
 * HTML de una fila de evento de producción. El evento 'inicial' es el producto
 * con el que arranca el turno; 'producto' es un cambio de producto; 'ciclo' es
 * un cambio de velocidad del horno (mismo producto, se deshabilita el nombre).
 */
function htmlEventoProduccion(lineaId, ev, i, palette) {
  const esInicial = ev.tipo === 'inicial';
  const esCiclo = ev.tipo === 'ciclo';
  const titulo = esInicial ? 'Producto inicial del turno'
    : esCiclo ? `Cambio de ciclo #${i}` : `Cambio de producto #${i}`;
  const colorCabecera = esInicial ? 'text-amber-800 bg-amber-100'
    : esCiclo ? 'text-indigo-700 bg-indigo-50' : 'text-emerald-700 bg-emerald-50';
  const botonQuitar = esInicial ? '' :
    `<button type="button" onclick="quitarEventoProduccion('${lineaId}', ${i})" class="text-[10px] text-rose-500 hover:text-rose-700 font-bold px-1">✕ quitar</button>`;

  // En un cambio de ciclo el producto y el formato se heredan del evento
  // previo; solo se edita el ciclo. Por eso esos campos quedan ocultos.
  const camposProducto = esCiclo ? '' : `
    <div>
      <label class="text-[8px] font-bold text-slate-500 uppercase">Producto</label>
      <input type="text" id="evProd_${lineaId}_${i}" value="${esc(ev.producto || '')}" placeholder="Ej: BARRACAS" class="field text-xs p-1" onchange="recalcularProyeccion('${lineaId}')">
    </div>
    <div>
      <label class="text-[8px] font-bold text-slate-500 uppercase">Formato</label>
      <select id="evFormato_${lineaId}_${i}" class="field text-xs p-1" onchange="recalcularProyeccion('${lineaId}')">${opcionesFormato(ev.formatoId || '')}</select>
    </div>`;

  return `
    <div class="p-2 border ${palette.borde} rounded space-y-1" data-evento-tipo="${ev.tipo}">
      <div class="flex items-center justify-between">
        <span class="text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${colorCabecera}">${titulo}</span>
        ${botonQuitar}
      </div>
      <div class="grid grid-cols-2 gap-1">
        <div>
          <label class="text-[8px] font-bold text-slate-500 uppercase">Hora</label>
          <input type="time" id="evHora_${lineaId}_${i}" value="${ev.hora || ''}" class="field text-xs p-1" onchange="recalcularProyeccion('${lineaId}')" ${esInicial ? '' : ''}>
        </div>
        <div>
          <label class="text-[8px] font-bold text-slate-500 uppercase">Ciclo (min)</label>
          <select id="evCiclo_${lineaId}_${i}" class="field text-xs p-1" onchange="recalcularProyeccion('${lineaId}')">${opcionesCiclo(ev.ciclo || '')}</select>
        </div>
        ${camposProducto}
      </div>
      <div id="evRitmo_${lineaId}_${i}" class="text-[9px] font-bold text-amber-700 text-center bg-amber-100 rounded py-0.5">— m²/h</div>
    </div>`;
}

/** Dibuja el formulario de objetivos/reales para cada línea activa, dentro del modal de indicadores. */
export function renderObjetivosModal() {
  const s = sesion();
  const paletas = [
    { texto: 'text-sky-800', borde: 'border-sky-300', bg: 'bg-sky-50/50' },
    { texto: 'text-emerald-800', borde: 'border-emerald-300', bg: 'bg-emerald-50/50' },
    { texto: 'text-amber-800', borde: 'border-amber-300', bg: 'bg-amber-50/50' },
    { texto: 'text-purple-800', borde: 'border-purple-300', bg: 'bg-purple-50/50' },
    { texto: 'text-rose-800', borde: 'border-rose-300', bg: 'bg-rose-50/50' },
    { texto: 'text-indigo-800', borde: 'border-indigo-300', bg: 'bg-indigo-50/50' }
  ];

  const defaultHoras = {
    Mañana: ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00'],
    Tarde: ['14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'],
    Noche: ['22:00', '23:00', '00:00', '01:00', '02:00', '03:00', '04:00', '05:00']
  }[s.turno || 'Mañana'] || ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00'];

  document.getElementById('objetivosLineasContainer').innerHTML = lineasActivas().map((l, idx) => {
    const p = paletas[idx % paletas.length];
    const o = s.objetivos.porLinea[l.id];
    const lecturas = (Array.isArray(o.lecturasQuemado) && o.lecturasQuemado.length)
      ? o.lecturasQuemado
      : [{ hora: '', real: 0 }, { hora: '', real: 0 }, { hora: '', real: 0 }];
    const eventos = (Array.isArray(o.eventosProduccion) && o.eventosProduccion.length)
      ? o.eventosProduccion
      : [{ tipo: 'inicial', hora: '', producto: '', formatoId: '', ciclo: 0 }];
    const lecturasCal = (o.lecturasCalidad && o.lecturasCalidad.length === 8)
      ? o.lecturasCalidad
      : Array(8).fill(null).map((_, i) => ({ hora: defaultHoras[i], global: null, parcial: null }));

    return `<div class="obj-section p-4 bg-slate-50 border border-slate-200 rounded mb-4">
      <h4 class="font-bold ${p.texto} border-b-2 border-slate-300 pb-2 mb-4 text-base">${l.nombre} — Objetivos vs Real del Turno</h4>

      <!-- SECCIÓN 1: CALIDAD -->
      <div class="bg-white border-2 border-sky-200 rounded-lg p-4 mb-4">
        <h5 class="text-xs font-black text-sky-700 uppercase mb-3 flex items-center gap-2">
          <span class="w-1 h-4 bg-sky-600 rounded"></span>
          Calidad — Objetivo y Evolución Hora a Hora
        </h5>
        
        <div class="grid grid-cols-1 gap-4">
          <!-- Objetivo de calidad -->
          <div class="flex items-end gap-3">
            <div class="w-40">
              <label class="text-[10px] font-bold text-slate-600 uppercase">Calidad Obj. (%)</label>
              <input type="number" id="objCalidad_${l.id}" step="0.01" value="${o.calidad}" class="field mt-1">
            </div>
            <div class="flex-1">
              <label class="text-[10px] font-black ${p.texto} uppercase mb-2 block">
                Evolución hora a hora (Global % / Parcial %)
              </label>
            </div>
          </div>

          <!-- Grid de lecturas hora a hora -->
          <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            ${lecturasCal.map((x, i) => `
              <div class="p-2 bg-slate-50 border ${p.borde} rounded text-center">
                <div class="text-[9px] font-black ${p.texto} uppercase mb-1">H${i + 1}</div>
                <input type="time" id="calHora_${l.id}_${i}" value="${x.hora || defaultHoras[i] || ''}" class="field text-[10px] p-1 text-center mb-1">
                <input type="number" step="0.01" id="calGlobal_${l.id}_${i}" value="${x.global !== null && x.global !== undefined && !isNaN(x.global) ? x.global : ''}" placeholder="Global %" class="field text-[10px] p-1 text-center mb-1 bg-sky-50">
                <input type="number" step="0.01" id="calParcial_${l.id}_${i}" value="${x.parcial !== null && x.parcial !== undefined && !isNaN(x.parcial) ? x.parcial : ''}" placeholder="Parcial %" class="field text-[10px] p-1 text-center bg-emerald-50">
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- SECCIÓN 2: QUEMADO / RENDIMIENTO -->
      <div class="bg-white border-2 border-amber-200 rounded-lg p-4 mb-4">
        <h5 class="text-xs font-black text-amber-700 uppercase mb-3 flex items-center gap-2">
          <span class="w-1 h-4 bg-amber-600 rounded"></span>
          Quemado y Rendimiento
        </h5>
        
        <!-- EVENTOS DE PRODUCCIÓN: producto inicial + cambios de producto/ciclo -->
        <div class="mb-4">
          <div class="flex items-center justify-between mb-2">
            <label class="text-[10px] font-bold text-slate-600 uppercase">Producto y ciclo del horno durante el turno</label>
            <div class="flex gap-2">
              <button type="button" onclick="agregarEventoProduccion('${l.id}','producto')" class="btn bg-emerald-600 text-white hover:bg-emerald-700 text-[10px] px-2 py-1">+ Cambio de producto</button>
              <button type="button" onclick="agregarEventoProduccion('${l.id}','ciclo')" class="btn bg-indigo-600 text-white hover:bg-indigo-700 text-[10px] px-2 py-1">+ Modificar ciclo</button>
            </div>
          </div>
          <div id="eventosContainer_${l.id}" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            ${eventos.map((ev, i) => htmlEventoProduccion(l.id, ev, i, p)).join('')}
          </div>
          <p class="text-[9px] text-slate-500 italic mt-1">Cargá el producto con el que arranca el turno. Agregá un cambio solo cuando cambie el producto o la velocidad (ciclo) del horno; ahí se marca el quiebre en el gráfico de calidad y se recalcula el objetivo.</p>
        </div>

        <!-- TOMAS DE m² REALES (solo hora + valor) -->
        <div class="mb-4">
          <label class="text-[10px] font-bold text-slate-600 uppercase mb-2 block">Tomas de m² quemados (real medido)</label>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
            ${lecturas.map((x, i) => `
              <div class="p-2 bg-amber-50 border ${p.borde} rounded">
                <div class="text-[9px] font-black ${p.texto} uppercase mb-1">Toma ${i + 1}</div>
                <div class="grid grid-cols-2 gap-1">
                  <div>
                    <label class="text-[8px] font-bold text-slate-500 uppercase">Hora</label>
                    <input type="time" id="quemadoHora_${l.id}_${i}" value="${x.hora || ''}" class="field text-xs p-1" onchange="recalcularProyeccion('${l.id}')">
                  </div>
                  <div>
                    <label class="text-[8px] font-bold text-slate-500 uppercase">m² reales</label>
                    <input type="number" id="quemadoReal_${l.id}_${i}" step="1" min="0" value="${x.real || ''}" placeholder="m²" class="field text-xs p-1" onchange="recalcularProyeccion('${l.id}')">
                  </div>
                </div>
                <div id="tomaRend_${l.id}_${i}" class="text-[9px] font-bold text-slate-500 text-center mt-1">rend: —</div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Panel de producción proyectada / objetivo dinámico y rendimiento -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div class="p-3 bg-amber-50 border ${p.borde} rounded">
            <div class="text-[10px] font-black text-amber-700 uppercase mb-1">Producción proyectada del turno (8 h)</div>
            <div id="prodProyectada_${l.id}" class="text-lg font-black text-slate-800">— m²</div>
            <div id="prodDetalle_${l.id}" class="text-[9px] text-slate-500 mt-1 leading-tight"></div>
          </div>
          <div class="p-3 bg-slate-100 border border-slate-200 rounded">
            <div class="text-[10px] font-black text-slate-600 uppercase mb-1">Rendimiento (última toma)</div>
            <div id="rendReal_${l.id}" class="text-sm font-black text-slate-800">— (Auto)</div>
            <button type="button" onclick="abrirGestorFormatos()" class="text-[9px] text-sky-600 hover:text-sky-800 underline mt-2">+ Agregar / editar formatos del horno</button>
          </div>
        </div>
      </div>

      <!-- SECCIÓN 3: PRODUCCIÓN Y VACÍO -->
      <div class="bg-white border-2 border-purple-200 rounded-lg p-4 mb-4">
        <h5 class="text-xs font-black text-purple-700 uppercase mb-3 flex items-center gap-2">
          <span class="w-1 h-4 bg-purple-600 rounded"></span>
          Producción y Tiempos de Vacío
        </h5>
        
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <!-- Producción objetivo -->
          <div>
            <label class="text-[10px] font-bold text-slate-600 uppercase">Producción Obj. (m²)</label>
            <input type="number" id="objProd_${l.id}" value="${o.produccion}" class="field mt-1">
          </div>

          <!-- Producción real -->
          <div>
            <label class="text-[10px] font-bold ${p.texto} uppercase">Producción Real (m²)</label>
            <input type="number" id="realProd_${l.id}" value="${o.realProd || ''}" placeholder="Ej: 5400" class="field mt-1 ${p.borde} ${p.bg}">
          </div>

          <!-- Vacío máximo -->
          <div>
            <label class="text-[10px] font-bold text-slate-600 uppercase">Vacío Máx. (min)</label>
            <input type="number" id="objVacio_${l.id}" value="${o.vacioMax}" class="field mt-1">
            <label class="text-[10px] font-bold text-slate-600 uppercase mt-2 block">Vacío Real Turno</label>
            <div id="realVacio_${l.id}" class="mt-1 p-2 bg-slate-200 text-slate-800 font-black text-xs rounded text-center">0 min (Auto)</div>
          </div>
        </div>
      </div>

      <!-- SECCIÓN 4: DEFECTOS -->
      <div class="bg-white border-2 border-rose-200 rounded-lg p-4">
        <h5 class="text-xs font-black text-rose-700 uppercase mb-3 flex items-center gap-2">
          <span class="w-1 h-4 bg-rose-600 rounded"></span>
          Control de Defectos
        </h5>
        
        <div class="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-4 items-end">
          <!-- Objetivo de defectos -->
          <div>
            <label class="text-[10px] font-bold text-slate-600 uppercase">Defectos Máx. (%)</label>
            <input type="number" id="objDefectos_${l.id}" step="0.01" value="${o.defectosMax || 8}" placeholder="Ej: 8.00" class="field mt-1">
          </div>

          <!-- Carga única de defectos -->
          <div>
            <label class="text-[10px] font-bold text-rose-700 uppercase mb-2 block">
              Carga única de defectos para evolución hora a hora
            </label>
            <div class="flex items-end gap-3">
              <div class="w-32">
                <label class="text-[9px] font-bold text-slate-600 uppercase">Hora de carga</label>
                <input type="time" id="defectosHora_${l.id}" value="${o.defectosHora || ''}" class="field mt-1 text-center">
              </div>
              <button type="button" onclick="cargarDefectosHoraActual('${l.id}')" class="btn bg-rose-600 text-white hover:bg-rose-700 text-xs px-4 py-2 whitespace-nowrap">
                Tomar defectos actuales
              </button>
              <p class="text-[9px] text-slate-500 italic flex-1">Los defectos registrados en el turno se cargarán automáticamente con su % actual a la hora indicada.</p>
            </div>
          </div>
        </div>
      </div>

    </div>`;
  }).join('');
}

/** Abre el modal de indicadores, mostrando los acumulados actuales de vacío y rendimiento por línea. */
export function abrirIndicadores() {
  const s = sesion();
  asegurarObjetivosSesion(s);
  renderObjetivosModal();

  lineasActivas().forEach(l => {
    const paradasLinea = s.paradas.filter(x => x.linea === l.id);

    const totalVacio = paradasLinea.reduce((a, x) => a + (x.vacio || 0), 0);
    const elVacio = document.getElementById(`realVacio_${l.id}`);
    if (elVacio) elVacio.innerText = `${totalVacio} min (Acumulado)`;

    const o = s.objetivos.porLinea[l.id];
    const lecturas = o.lecturasQuemado || [];
    const ultima = [...lecturas].reverse().find(x => x.hora && x.real > 0);
    const elRend = document.getElementById(`rendReal_${l.id}`);
    if (elRend) {
      elRend.innerText = ultima ? `${ultima.real} m² — última toma ${ultima.hora}` : 'Sin tomas registradas';
    }

    // Mostrar la proyección de producción con los datos ya cargados.
    recalcularProyeccion(l.id);
  });

  abrir('modalIndicadores');
}

/** Guarda todos los objetivos y valores reales cargados en el modal de indicadores, para todas las líneas activas. */
export function guardarObjetivos() {
  const s = sesion();
  asegurarObjetivosSesion(s);

  const defaultHoras = {
    Mañana: ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00'],
    Tarde: ['14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'],
    Noche: ['22:00', '23:00', '00:00', '01:00', '02:00', '03:00', '04:00', '05:00']
  }[s.turno || 'Mañana'] || ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00'];

  lineasActivas().forEach(l => {
    const o = s.objetivos.porLinea[l.id];

    o.calidad = parseFloat(document.getElementById(`objCalidad_${l.id}`)?.value) || o.calidad;
    o.defectosMax = parseFloat(document.getElementById(`objDefectos_${l.id}`)?.value) || o.defectosMax || 8;
    o.rendimientoObj = parseFloat(document.getElementById(`rendObj_${l.id}`)?.value) || o.rendimientoObj;
    o.produccion = parseFloat(document.getElementById(`objProd_${l.id}`)?.value) || o.produccion;
    o.vacioMax = parseFloat(document.getElementById(`objVacio_${l.id}`)?.value) || o.vacioMax;

    o.defectosHora = document.getElementById(`defectosHora_${l.id}`)?.value || o.defectosHora || '';

    o.lecturasCalidad = [0, 1, 2, 3, 4, 5, 6, 7].map(i => {
      const h = document.getElementById(`calHora_${l.id}_${i}`)?.value || defaultHoras[i] || '';
      const gVal = document.getElementById(`calGlobal_${l.id}_${i}`)?.value;
      const pVal = document.getElementById(`calParcial_${l.id}_${i}`)?.value;
      return {
        hora: h,
        global: (gVal !== '' && gVal !== null && gVal !== undefined && !isNaN(parseFloat(gVal))) ? parseFloat(gVal) : null,
        parcial: (pVal !== '' && pVal !== null && pVal !== undefined && !isNaN(parseFloat(pVal))) ? parseFloat(pVal) : null
      };
    });

    // Calcular calidad global y parcial a partir del último valor de las lecturas hora a hora
    const ultimaLecturaGlobal = [...o.lecturasCalidad].reverse().find(x => x.global !== null);
    o.realCalidad = ultimaLecturaGlobal ? ultimaLecturaGlobal.global : 0;

    const ultimaLecturaParcial = [...o.lecturasCalidad].reverse().find(x => x.parcial !== null);
    o.calidadParcial = ultimaLecturaParcial ? ultimaLecturaParcial.parcial : 0;
    o.horaCalidadParcial = ultimaLecturaParcial ? ultimaLecturaParcial.hora : '';

    o.realProd = parseFloat(document.getElementById(`realProd_${l.id}`)?.value) || 0;

    // Eventos de producción (producto inicial + cambios) leídos del DOM.
    o.eventosProduccion = leerEventosDom(l.id, o.eventosProduccion);

    // Tomas de m² reales: solo hora + valor.
    o.lecturasQuemado = [0, 1, 2].map(i => ({
      hora: document.getElementById(`quemadoHora_${l.id}_${i}`)?.value || '',
      real: parseFloat(document.getElementById(`quemadoReal_${l.id}_${i}`)?.value) || 0
    }));

    // Objetivo dinámico y quiebres a partir de los eventos.
    const tramos = tramosDeEventos(o.eventosProduccion);
    const proy = proyectarProduccionTurno(tramos, s.turno || 'Mañana');
    o.produccionProyectada = Math.round(proy.totalProyectado);
    o.quiebresProducto = proy.quiebres;
  });

  persistir();
  cerrar('modalIndicadores');
  renderTodo();
  if (!document.getElementById('vistaPlanta').classList.contains('hidden')) renderVistaPlanta();

  mostrarAlertaKira('¡Objetivos y datos reales del turno guardados y evaluados correctamente!', 'Control de Objetivos', 'exito');
}

/**
 * Toma una instantánea de los defectos actuales de la línea y los guarda para el historial.
 */
function cargarDefectosHoraActual(lineaId) {
  const s = sesion();
  const o = s.objetivos.porLinea[lineaId];
  
  // Obtener la hora del input
  const hora = document.getElementById(`defectosHora_${lineaId}`)?.value;
  if (!hora) {
    mostrarAlertaKira('Por favor ingresa una hora para la carga de defectos', 'Carga de Defectos', 'advertencia');
    return;
  }

  // Obtener defectos actuales de esta línea
  const defectosLinea = s.defectos.filter(d => d.linea === lineaId);
  
  if (defectosLinea.length === 0) {
    mostrarAlertaKira('No hay defectos registrados en esta línea', 'Carga de Defectos', 'advertencia');
    return;
  }

  // Inicializar array de lecturas de defectos si no existe
  if (!o.lecturasDefectos) {
    o.lecturasDefectos = [];
  }

  // Crear snapshot de los defectos en esta hora
  const snapshot = {
    hora: hora,
    defectos: defectosLinea.map(d => ({
      nombre: d.nombre,
      porcentaje: d.porcentaje
    }))
  };

  // Agregar al historial (evitar duplicados de hora)
  const existente = o.lecturasDefectos.findIndex(l => l.hora === hora);
  if (existente >= 0) {
    o.lecturasDefectos[existente] = snapshot;
  } else {
    o.lecturasDefectos.push(snapshot);
    // Ordenar por hora
    o.lecturasDefectos.sort((a, b) => a.hora.localeCompare(b.hora));
  }

  persistir();
  mostrarAlertaKira(`Defectos cargados para las ${hora}. Total: ${defectosLinea.length} defectos registrados.`, 'Carga de Defectos', 'exito');
}

/**
 * Lee los eventos de producción desde el DOM para una línea. Cada evento es
 * {tipo, hora, producto, formatoId, ciclo}. Los cambios de ciclo heredan
 * producto y formato del evento anterior (no tienen esos inputs visibles).
 * @param {string} lineaId
 * @param {Array} eventosPrevios  usado para saber cuántos eventos hay
 */
function leerEventosDom(lineaId, eventosPrevios) {
  const cantidad = Array.isArray(eventosPrevios) && eventosPrevios.length ? eventosPrevios.length : 1;
  const eventos = [];
  for (let i = 0; i < cantidad; i++) {
    const cont = document.querySelector(`#eventosContainer_${lineaId} [data-evento-tipo]:nth-child(${i + 1})`);
    const tipo = cont?.getAttribute('data-evento-tipo') || (i === 0 ? 'inicial' : 'producto');
    const hora = document.getElementById(`evHora_${lineaId}_${i}`)?.value || '';
    const ciclo = parseInt(document.getElementById(`evCiclo_${lineaId}_${i}`)?.value, 10) || 0;
    // producto/formato: en cambios de ciclo no hay inputs → se resuelven luego.
    const producto = document.getElementById(`evProd_${lineaId}_${i}`)?.value?.trim() ?? null;
    const formatoId = document.getElementById(`evFormato_${lineaId}_${i}`)?.value ?? null;
    eventos.push({ tipo, hora, ciclo, producto, formatoId });
  }

  // Resolver herencia: un cambio de ciclo (sin producto/formato propios) toma
  // el producto y formato vigentes del evento anterior.
  let ultimoProducto = '', ultimoFormato = '';
  eventos.forEach(ev => {
    if (ev.producto === null || ev.producto === undefined) ev.producto = ultimoProducto;
    if (ev.formatoId === null || ev.formatoId === undefined) ev.formatoId = ultimoFormato;
    if (ev.producto) ultimoProducto = ev.producto;
    if (ev.formatoId) ultimoFormato = ev.formatoId;
  });

  return eventos;
}

/**
 * Convierte la lista de eventos en tramos aptos para proyectarProduccionTurno.
 * Cada tramo necesita hora, formatoId, ciclo y producto.
 */
function tramosDeEventos(eventos) {
  if (!Array.isArray(eventos)) return [];
  return eventos
    .filter(ev => ev.hora && ev.formatoId && Number(ev.ciclo) > 0)
    .map(ev => ({
      hora: ev.hora,
      formatoId: ev.formatoId,
      ciclo: Number(ev.ciclo),
      producto: ev.producto || ''
    }));
}

/**
 * Recalcula en vivo el objetivo dinámico del turno, el ritmo de cada evento y
 * el rendimiento de cada toma (real acumulado vs objetivo acumulado a su hora).
 */
function recalcularProyeccion(lineaId) {
  const s = sesion();
  const turno = s.turno || 'Mañana';
  const o = s.objetivos?.porLinea?.[lineaId];

  const eventos = leerEventosDom(lineaId, o?.eventosProduccion);
  const tramos = tramosDeEventos(eventos);

  // Ritmo (m²/h) de cada evento.
  eventos.forEach((ev, i) => {
    const el = document.getElementById(`evRitmo_${lineaId}_${i}`);
    if (!el) return;
    if (ev.formatoId && Number(ev.ciclo) > 0) {
      el.textContent = `${m2PorHoraPorId(ev.formatoId, ev.ciclo).toFixed(1)} m²/h`;
    } else {
      el.textContent = '— m²/h';
    }
  });

  // Proyección / objetivo dinámico del turno.
  const proy = proyectarProduccionTurno(tramos, turno);
  const elProd = document.getElementById(`prodProyectada_${lineaId}`);
  const elDet = document.getElementById(`prodDetalle_${lineaId}`);

  if (elProd) {
    elProd.textContent = proy.totalProyectado > 0
      ? `${Math.round(proy.totalProyectado).toLocaleString('es-AR')} m²`
      : '— m²';
  }
  if (elDet) {
    if (proy.tramos.length === 0) {
      elDet.textContent = 'Cargá hora, formato y ciclo en el producto inicial.';
    } else {
      elDet.innerHTML = proy.tramos.map(t => {
        const fmt = obtenerFormato(t.formatoId);
        const nombreFmt = fmt ? fmt.nombre : t.formatoId;
        const prod = t.producto ? ` · ${esc(t.producto)}` : '';
        return `<div>${t.hora} — ${nombreFmt} c${t.ciclo}${prod}: ${Math.round(t.minutos)} min × ${t.m2h.toFixed(0)} m²/h = <b>${Math.round(t.m2Tramo)} m²</b></div>`;
      }).join('') + (proy.quiebres.length
        ? `<div class="text-amber-600 mt-1">⚠ ${proy.quiebres.length} quiebre(s): ${proy.quiebres.map(q => q.tipo).join(', ')}.</div>`
        : '');
    }
  }

  // Rendimiento de cada toma: real acumulado hasta su hora vs objetivo
  // acumulado a esa misma hora.
  const tomas = [0, 1, 2].map(i => ({
    hora: document.getElementById(`quemadoHora_${lineaId}_${i}`)?.value || '',
    real: parseFloat(document.getElementById(`quemadoReal_${lineaId}_${i}`)?.value) || 0
  }));

  // Acumular m² reales por hora (las tomas suelen ser lecturas acumuladas;
  // acá tomamos el valor cargado como el acumulado real hasta esa hora).
  let ultimaRend = null, ultimaHora = '';
  tomas.forEach((t, i) => {
    const el = document.getElementById(`tomaRend_${lineaId}_${i}`);
    if (!el) return;
    if (t.hora && t.real > 0 && tramos.length) {
      const rend = rendimientoEnToma(t.real, tramos, turno, t.hora);
      if (rend !== null) {
        el.textContent = `rend: ${rend.toFixed(1)}%`;
        el.className = `text-[9px] font-bold text-center mt-1 ${rend >= 85 ? 'text-emerald-600' : rend >= 80 ? 'text-amber-600' : 'text-rose-600'}`;
        ultimaRend = rend; ultimaHora = t.hora;
      } else {
        el.textContent = 'rend: —';
      }
    } else {
      el.textContent = 'rend: —';
      el.className = 'text-[9px] font-bold text-slate-500 text-center mt-1';
    }
  });

  const elRend = document.getElementById(`rendReal_${lineaId}`);
  if (elRend) {
    elRend.textContent = ultimaRend !== null
      ? `${ultimaRend.toFixed(1)}% — ${ultimaHora} hs`
      : '— (Auto)';
  }
}

/**
 * Agrega un evento de producción (cambio de producto o de ciclo) a una línea.
 * Persiste primero lo cargado en el DOM para no perderlo al re-renderizar.
 */
function agregarEventoProduccion(lineaId, tipo) {
  const s = sesion();
  const o = s.objetivos.porLinea[lineaId];
  o.eventosProduccion = leerEventosDom(lineaId, o.eventosProduccion);
  o.eventosProduccion.push({ tipo, hora: '', producto: '', formatoId: '', ciclo: 0 });
  renderObjetivosModal();
  recalcularProyeccion(lineaId);
}

/** Quita el evento en la posición dada (nunca el inicial, índice 0). */
function quitarEventoProduccion(lineaId, indice) {
  if (indice <= 0) return;
  const s = sesion();
  const o = s.objetivos.porLinea[lineaId];
  o.eventosProduccion = leerEventosDom(lineaId, o.eventosProduccion);
  o.eventosProduccion.splice(indice, 1);
  renderObjetivosModal();
  recalcularProyeccion(lineaId);
}

/**
 * Abre un prompt simple para agregar un formato nuevo al horno (lado1, lado2,
 * piezas por fila). El sistema queda abierto a formatos futuros sin tocar código.
 */
function abrirGestorFormatos() {
  const lados = prompt(
    'Nuevo formato del horno.\nIngresá: lado1(cm), lado2(cm), piezas por fila\nEjemplo: 60,60,4',
    ''
  );
  if (!lados) return;
  const partes = lados.split(/[,;\s]+/).map(x => parseFloat(x.replace(',', '.')));
  const [l1, l2, pf] = partes;
  if (!(l1 > 0) || !(l2 > 0) || !(pf > 0)) {
    mostrarAlertaKira('Datos inválidos. Formato esperado: lado1, lado2, piezas por fila (ej: 60,60,4).', 'Formatos del horno', 'advertencia');
    return;
  }
  try {
    const nuevo = agregarFormato({ lado1: l1, lado2: l2, piezasFila: pf });
    guardarFormatosHorno(listarFormatos());
    renderObjetivosModal();
    lineasActivas().forEach(l => recalcularProyeccion(l.id));
    mostrarAlertaKira(`Formato ${nuevo.nombre} agregado (${nuevo.piezasFila} piezas/fila).`, 'Formatos del horno', 'exito');
  } catch (e) {
    mostrarAlertaKira(e.message || 'No se pudo agregar el formato.', 'Formatos del horno', 'advertencia');
  }
}

// ==========================================================
// EXPOSICIÓN A window
// ----------------------------------------------------------
// abrirIndicadores, guardarObjetivos: llamadas desde index.html.
// ==========================================================
window.abrirIndicadores = abrirIndicadores;
window.guardarObjetivos = guardarObjetivos;
window.cargarDefectosHoraActual = cargarDefectosHoraActual;
window.recalcularProyeccion = recalcularProyeccion;
window.abrirGestorFormatos = abrirGestorFormatos;
window.agregarEventoProduccion = agregarEventoProduccion;
window.quitarEventoProduccion = quitarEventoProduccion;