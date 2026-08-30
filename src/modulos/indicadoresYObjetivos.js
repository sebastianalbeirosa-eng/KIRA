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

  document.getElementById('objetivosLineasContainer').innerHTML = lineasActivas().map((l, idx) => {
    const p = paletas[idx % paletas.length];
    const o = s.objetivos.porLinea[l.id];
    const lecturas = o.lecturasQuemado || [{ hora: '', real: '' }, { hora: '', real: '' }, { hora: '', real: '' }];

    return `<div class="obj-section p-3 bg-slate-50 border border-slate-200 rounded">
      <h4 class="font-bold ${p.texto} border-b border-slate-200 pb-1 mb-2">${l.nombre} — Objetivos vs Real del Turno</h4>

      <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
       <div>
  <label class="text-[10px] font-bold text-slate-600 uppercase">
    Calidad Obj. (%)
  </label>
  <input
    type="number"
    id="objCalidad_${l.id}"
    step="0.01"
    value="${o.calidad}"
    class="field mt-1"
  >

  <label class="text-[10px] font-bold ${p.texto} uppercase mt-2 block">
    Calidad Global (%)
  </label>
  <input
    type="number"
    id="realCalidad_${l.id}"
    step="0.01"
    value="${o.realCalidad || ''}"
    placeholder="Ej: 89.00"
    class="field mt-1 ${p.borde} ${p.bg}"
  >

  <label class="text-[10px] font-bold ${p.texto} uppercase mt-2 block">
    Calidad Parcial (%)
  </label>
  <div class="grid grid-cols-[1fr_90px] gap-2 mt-1">
    <input
      type="number"
      id="calidadParcial_${l.id}"
      step="0.01"
      value="${o.calidadParcial || ''}"
      placeholder="Ej: 91.00"
      class="field ${p.borde} ${p.bg}"
    >

    <input
      type="time"
      id="horaCalidadParcial_${l.id}"
      value="${o.horaCalidadParcial || ''}"
      class="field ${p.borde} ${p.bg}"
    >
  </div>
</div>

        <div>
          <label class="text-[10px] font-bold text-slate-600 uppercase">Objetivo quemado (m²/turno)</label>
          <input type="number" id="quemadoObj_${l.id}" step="1" value="${o.quemadoObj || 0}" placeholder="Ej: 2765" class="field mt-1">
          <label class="text-[10px] font-bold ${p.texto} uppercase mt-2 block">Rendimiento final</label>
          <div id="rendReal_${l.id}" class="mt-1 p-2 bg-slate-200 text-slate-800 font-black text-xs rounded text-center">— (Auto)</div>
        </div>

        <div class="md:col-span-2">
          <label class="text-[10px] font-bold text-slate-600 uppercase">Tomas reales de quemado</label>
          <div class="grid grid-cols-3 gap-2 mt-1">
            ${lecturas.map((x, i) => `
              <div class="p-2 bg-white border ${p.borde} rounded">
                <div class="text-[9px] font-black ${p.texto} uppercase mb-1">Toma ${i + 1}</div>
                <input type="time" id="quemadoHora_${l.id}_${i}" value="${x.hora || ''}" class="field mb-1">
                <input type="number" id="quemadoReal_${l.id}_${i}" step="1" min="0" value="${x.real || ''}" placeholder="m² reales" class="field">
              </div>
            `).join('')}
          </div>
        </div>

        <div>
          <label class="text-[10px] font-bold text-slate-600 uppercase">Producción Obj. (m²)</label>
          <input type="number" id="objProd_${l.id}" value="${o.produccion}" class="field mt-1">
          <label class="text-[10px] font-bold ${p.texto} uppercase mt-2 block">Producción Real (m²)</label>
          <input type="number" id="realProd_${l.id}" value="${o.realProd || ''}" placeholder="Ej: 5400" class="field mt-1 ${p.borde} ${p.bg}">
        </div>

        <div>
          <label class="text-[10px] font-bold text-slate-600 uppercase">Vacío Máx. (min)</label>
          <input type="number" id="objVacio_${l.id}" value="${o.vacioMax}" class="field mt-1">
          <label class="text-[10px] font-bold text-slate-600 uppercase mt-2 block">Vacío Real Turno</label>
          <div id="realVacio_${l.id}" class="mt-1 p-2 bg-slate-200 text-slate-800 font-black text-xs rounded text-center">0 min (Auto)</div>
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

  lineasActivas().forEach(l => {
    const o = s.objetivos.porLinea[l.id];

    o.calidad = parseFloat(document.getElementById(`objCalidad_${l.id}`)?.value) || o.calidad;
    o.rendimientoObj = parseFloat(document.getElementById(`rendObj_${l.id}`)?.value) || o.rendimientoObj;
    o.produccion = parseFloat(document.getElementById(`objProd_${l.id}`)?.value) || o.produccion;
    o.vacioMax = parseFloat(document.getElementById(`objVacio_${l.id}`)?.value) || o.vacioMax;

    o.realCalidad = parseFloat(document.getElementById(`realCalidad_${l.id}`)?.value) || 0;
    o.calidadParcial = parseFloat(document.getElementById(`calidadParcial_${l.id}`)?.value) || 0;
    o.horaCalidadParcial = document.getElementById(`horaCalidadParcial_${l.id}`)?.value || '';

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

// ==========================================================
// EXPOSICIÓN A window
// ----------------------------------------------------------
// abrirIndicadores, guardarObjetivos: llamadas desde index.html.
// ==========================================================
window.abrirIndicadores = abrirIndicadores;
window.guardarObjetivos = guardarObjetivos;