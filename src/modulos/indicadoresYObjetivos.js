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
import { abrir, cerrar } from '../nucleo/utilidades.js';
import { sesion, lineasActivas, asegurarObjetivosSesion } from '../nucleo/estado.js';
import { mostrarAlertaKira } from '../nucleo/alertasKira.js';
import { renderTodo, renderVistaPlanta } from './vistaDePlanta.js';

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
    const lecturas = o.lecturasQuemado || [{ hora: '', real: '' }, { hora: '', real: '' }, { hora: '', real: '' }];
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
        
        <div class="grid grid-cols-1 lg:grid-cols-[200px_1fr_180px] gap-4 items-start">
          <!-- Objetivo de quemado -->
          <div>
            <label class="text-[10px] font-bold text-slate-600 uppercase">Objetivo quemado (m²/turno)</label>
            <input type="number" id="quemadoObj_${l.id}" step="1" value="${o.quemadoObj || 0}" placeholder="Ej: 2765" class="field mt-1">
          </div>

          <!-- Tomas reales de quemado -->
          <div>
            <label class="text-[10px] font-bold text-slate-600 uppercase mb-2 block">Tomas reales de quemado</label>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
              ${lecturas.map((x, i) => `
                <div class="p-2 bg-amber-50 border ${p.borde} rounded">
                  <div class="text-[9px] font-black ${p.texto} uppercase mb-1">Toma ${i + 1}</div>
                  <input type="time" id="quemadoHora_${l.id}_${i}" value="${x.hora || ''}" class="field text-xs mb-1">
                  <input type="number" id="quemadoReal_${l.id}_${i}" step="1" min="0" value="${x.real || ''}" placeholder="m² reales" class="field text-xs">
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Rendimiento final -->
          <div>
            <label class="text-[10px] font-bold ${p.texto} uppercase">Rendimiento final</label>
            <div id="rendReal_${l.id}" class="mt-1 p-3 bg-slate-200 text-slate-800 font-black text-xs rounded text-center">— (Auto)</div>
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

    o.quemadoObj = parseFloat(document.getElementById(`quemadoObj_${l.id}`)?.value) || 0;
    o.lecturasQuemado = [0, 1, 2].map(i => ({
      hora: document.getElementById(`quemadoHora_${l.id}_${i}`)?.value || '',
      real: parseFloat(document.getElementById(`quemadoReal_${l.id}_${i}`)?.value) || 0
    }));
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

// ==========================================================
// EXPOSICIÓN A window
// ----------------------------------------------------------
// abrirIndicadores, guardarObjetivos: llamadas desde index.html.
// ==========================================================
window.abrirIndicadores = abrirIndicadores;
window.guardarObjetivos = guardarObjetivos;
window.cargarDefectosHoraActual = cargarDefectosHoraActual;