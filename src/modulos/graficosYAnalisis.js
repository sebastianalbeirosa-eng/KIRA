/* ========================================================== */
/* GRAFICOS-Y-ANALISIS.JS — Pareto, turnos y tendencias        */
/* ========================================================== */
/*
  Usa Chart.js (cargado por CDN en index.html como variable global
  `Chart`, no como módulo ES6 — por eso no aparece en los imports).
*/

import { esc } from '../nucleo/utilidades.js';
import { sesion } from '../nucleo/estado.js';
import { datosAnalisis, defectosAnalisis, metricas, setAnalisisModo } from './vistaDePlanta.js';

// Registro de instancias de Chart.js activas, para poder destruirlas
// y recrearlas cada vez que se refresca el análisis (evita gráficos
// "fantasma" superpuestos).
const charts = {};

// Plugin propio de Chart.js: dibuja el valor numérico arriba de cada barra.
const pluginEtiquetasBarras = {
  id: 'etiquetasBarras',
  afterDatasetsDraw(chartInstance) {
    const { ctx } = chartInstance;
    const sufijo = chartInstance.options.plugins?.etiquetasBarras?.sufijo || '';
    chartInstance.data.datasets.forEach((dataset, datasetIndex) => {
      if (dataset.type && dataset.type !== 'bar') return;
      const meta = chartInstance.getDatasetMeta(datasetIndex);
      if (meta.hidden) return;
      meta.data.forEach((barra, index) => {
        const valorNumerico = dataset.data[index];
        if (valorNumerico === undefined || valorNumerico === null) return;
        // Solo etiquetar valores numéricos. Los gráficos de línea con datos
        // {x, y} (como los de calidad) no deben ser rotulados por este plugin
        // de barras; si no, imprimirían "[object Object]".
        if (typeof valorNumerico !== 'number') return;
        ctx.save();
        ctx.fillStyle = '#1e293b';
        ctx.font = 'bold 10px Segoe UI, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(valorNumerico + sufijo, barra.x, barra.y - 3);
        ctx.restore();
      });
    });
  }
};
Chart.register(pluginEtiquetasBarras);

/** Calcula un techo con 15% de margen sobre el valor máximo de los datasets, para que las barras no toquen el borde del gráfico. */
export function techoConMargen(datasets) {
  let max = 0;
  datasets.forEach(ds => {
    if (ds.type && ds.type !== 'bar') return;
    (ds.data || []).forEach(v => { if (typeof v === 'number' && v > max) max = v; });
  });
  return max === 0 ? undefined : Math.ceil(max * 1.15);
}

/** Crea (o recrea) un gráfico de Chart.js en el canvas indicado, con estilo unificado de KIRA. */
export function chart(id, type, data, options = {}, sufijoEtiquetas = '') {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(document.getElementById(id), {
    type, data, options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#475569', font: { size: 10 } } },
        etiquetasBarras: { sufijo: sufijoEtiquetas }
      },
      scales: type === 'doughnut' ? {} : { x: { ticks: { color: '#475569' } }, y: { ticks: { color: '#475569' }, beginAtZero: true } },
      ...options
    }
  });
}

/** Dibuja el gráfico de las 5 máquinas con más minutos de parada (pestaña Dashboard). */
export function renderCharts() {
  const regs = datosAnalisis(), porEq = {}, vacioEq = {};
  regs.forEach(x => {
    porEq[x.equipo] = (porEq[x.equipo] || 0) + x.minutos;
    vacioEq[x.equipo] = (vacioEq[x.equipo] || 0) + x.vacio;
  });
  const top5 = Object.entries(porEq).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const datasetsTop5 = [
    { label: 'Minutos de parada', data: top5.map(x => x[1]), backgroundColor: '#0ea5e9' },
    { label: 'Minutos de vacío de horno', data: top5.map(x => vacioEq[x[0]] || 0), backgroundColor: '#f59e0b' }
  ];

  chart('chartTopMaquinas', 'bar', {
    labels: top5.map(x => x[0]),
    datasets: datasetsTop5
  }, {
    scales: { x: { ticks: { color: '#475569' } }, y: { ticks: { color: '#475569' }, beginAtZero: true, max: techoConMargen(datasetsTop5) } }
  });
}

/**
 * Dibuja toda la pestaña de Análisis: Pareto de causas de parada (con vacío
 * de horno superpuesto), distribución por turno, Pareto de defectos de
 * calidad, defectos por turno, y las tarjetas de "hallazgos" automáticos.
 */
export function renderAnalisis() {
  renderCharts();
  const regs = datosAnalisis(), causas = {}, vacioCausas = {}, turnos = { Mañana: 0, Tarde: 0, Noche: 0 }, vacioTurnos = { Mañana: 0, Tarde: 0, Noche: 0 }, equiposAgg = {};
  regs.forEach(x => {
    causas[x.motivo] = (causas[x.motivo] || 0) + x.minutos;
    vacioCausas[x.motivo] = (vacioCausas[x.motivo] || 0) + x.vacio;
    turnos[x.turno] = (turnos[x.turno] || 0) + x.minutos;
    vacioTurnos[x.turno] = (vacioTurnos[x.turno] || 0) + x.vacio;
    equiposAgg[x.equipo] = (equiposAgg[x.equipo] || 0) + x.minutos;
  });
  const orden = Object.entries(causas).sort((a, b) => b[1] - a[1]), total = orden.reduce((a, x) => a + x[1], 0);
  let ac = 0;
  const acum = orden.map(x => { ac += x[1]; return total ? +(ac / total * 100).toFixed(1) : 0; });

  const datasetsPareto = [
    { type: 'bar', label: 'Minutos de parada', data: orden.map(x => x[1]), backgroundColor: '#0ea5e9', yAxisID: 'y' },
    { type: 'bar', label: 'Minutos de vacío de horno', data: orden.map(x => vacioCausas[x[0]] || 0), backgroundColor: '#f59e0b', yAxisID: 'y' },
    { type: 'line', label: '% acumulado', data: acum, borderColor: '#dc2626', yAxisID: 'y1' }
  ];

  chart('chartPareto', 'bar', {
    labels: orden.map(x => x[0]),
    datasets: datasetsPareto
  }, {
    scales: {
      x: { ticks: { color: '#475569' } },
      y: { beginAtZero: true, ticks: { color: '#475569' }, max: techoConMargen(datasetsPareto) },
      y1: { position: 'right', min: 0, max: 100, grid: { display: false }, ticks: { color: '#dc2626', callback: v => v + '%' } }
    }
  });

  const datasetsTurnos = [
    { label: 'Minutos de parada', data: Object.values(turnos), backgroundColor: '#0ea5e9' },
    { label: 'Minutos de vacío de horno', data: Object.values(vacioTurnos), backgroundColor: '#f59e0b' }
  ];

  chart('chartTurnos', 'bar', {
    labels: Object.keys(turnos),
    datasets: datasetsTurnos
  }, {
    scales: { x: { ticks: { color: '#475569' } }, y: { ticks: { color: '#475569' }, beginAtZero: true, max: techoConMargen(datasetsTurnos) } }
  });

  const defectosRegs = defectosAnalisis();
  const sumaPorc = {}, cantidadPorc = {};
  defectosRegs.forEach(x => {
    sumaPorc[x.nombre] = (sumaPorc[x.nombre] || 0) + x.porcentaje;
    cantidadPorc[x.nombre] = (cantidadPorc[x.nombre] || 0) + 1;
  });
  const promediosDefectos = Object.keys(sumaPorc).map(nombre => [nombre, +(sumaPorc[nombre] / cantidadPorc[nombre]).toFixed(2)]);
  const top6Defectos = promediosDefectos.sort((a, b) => b[1] - a[1]).slice(0, 6);
  const totalDefectos = top6Defectos.reduce((a, x) => a + x[1], 0);
  let acDef = 0;
  const acumDefectos = top6Defectos.map(x => { acDef += x[1]; return totalDefectos ? +(acDef / totalDefectos * 100).toFixed(1) : 0; });

  const datasetsParetoDefectos = [
    { type: 'bar', label: '% promedio sobre producción', data: top6Defectos.map(x => x[1]), backgroundColor: '#dc2626', yAxisID: 'y' },
    { type: 'line', label: '% acumulado', data: acumDefectos, borderColor: '#7c3aed', yAxisID: 'y1' }
  ];

  chart('chartParetoDefectos', 'bar', {
    labels: top6Defectos.map(x => x[0]),
    datasets: datasetsParetoDefectos
  }, {
    scales: {
      x: { ticks: { color: '#475569' } },
      y: { beginAtZero: true, ticks: { color: '#475569', callback: v => v + '%' }, max: techoConMargen(datasetsParetoDefectos) },
      y1: { position: 'right', min: 0, max: 100, grid: { display: false }, ticks: { color: '#7c3aed', callback: v => v + '%' } }
    }
  }, '%');

  const promPorTurnoDefecto = {};
  defectosRegs.forEach(x => {
    if (!promPorTurnoDefecto[x.nombre]) {
      promPorTurnoDefecto[x.nombre] = { Mañana: { suma: 0, cant: 0 }, Tarde: { suma: 0, cant: 0 }, Noche: { suma: 0, cant: 0 } };
    }
    const bucket = promPorTurnoDefecto[x.nombre][x.turno];
    if (bucket) { bucket.suma += x.porcentaje; bucket.cant += 1; }
  });

  const promedioTurno = (nombre, turno) => {
    const b = promPorTurnoDefecto[nombre]?.[turno];
    return (b && b.cant) ? +(b.suma / b.cant).toFixed(2) : 0;
  };

  const datasetsDefectosTurno = [
    { label: 'Mañana', data: top6Defectos.map(x => promedioTurno(x[0], 'Mañana')), backgroundColor: '#0ea5e9' },
    { label: 'Tarde', data: top6Defectos.map(x => promedioTurno(x[0], 'Tarde')), backgroundColor: '#f59e0b' },
    { label: 'Noche', data: top6Defectos.map(x => promedioTurno(x[0], 'Noche')), backgroundColor: '#7c3aed' }
  ];

  chart('chartDefectosPorTurno', 'bar', {
    labels: top6Defectos.map(x => x[0]),
    datasets: datasetsDefectosTurno
  }, {
    scales: { x: { ticks: { color: '#475569' } }, y: { beginAtZero: true, ticks: { color: '#475569', callback: v => v + '%' }, max: techoConMargen(datasetsDefectosTurno) } }
  }, '%');

  const topEq = Object.entries(equiposAgg).sort((a, b) => b[1] - a[1])[0], topC = orden[0], m = metricas();
  document.getElementById('hallazgos').innerHTML = [
    ['Equipo prioritario', topEq ? `${topEq[0]} acumula ${topEq[1]} min.` : 'Sin datos históricos.'],
    ['Causa prioritaria', topC ? `${topC[0]} representa ${total ? (topC[1] / total * 100).toFixed(1) : 0}% del total.` : 'Sin causas registradas.'],
    ['Estado del turno', `Disponibilidad actual ${m.disponibilidad.toFixed(1)}%, vacío ${m.vacio} min y ${sesion().acciones.length} acciones.`]
  ].map(x => `<div class="bg-slate-50 border border-slate-200 p-3 rounded"><b class="text-xs text-sky-700">${x[0]}</b><p class="mt-1 text-sm text-slate-700">${esc(x[1])}</p></div>`).join('');
}

/** Cambia entre modo "turno actual" y "últimos 7 días" en la pestaña de Análisis. */
export function cambiarModoAnalisis(modo) {
  setAnalisisModo(modo);
  document.getElementById('btnAnalisisTurno').className = `btn text-xs py-1.5 ${modo === 'turno' ? 'bg-sky-700 text-white' : 'bg-white border border-slate-300 text-slate-700'}`;
  document.getElementById('btnAnalisisSemanal').className = `btn text-xs py-1.5 ${modo === 'semanal' ? 'bg-sky-700 text-white' : 'bg-white border border-slate-300 text-slate-700'}`;
  renderAnalisis();
}

// ==========================================================
// EXPOSICIÓN A window
// ----------------------------------------------------------
// cambiarModoAnalisis: se llama desde onclick="..." en index.html
// (botones "Turno actual" / "Últimos 7 días").
// ==========================================================
window.cambiarModoAnalisis = cambiarModoAnalisis;