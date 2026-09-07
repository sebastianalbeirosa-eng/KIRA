/* ========================================================== */
/* GRAFICOS-Y-ANALISIS.JS — Paretos y evolución por período    */
/* ========================================================== */
/*
  Usa Chart.js (global `Chart`, cargado por CDN/vendor en index.html).

  El Análisis tiene un SELECTOR DE PERÍODO con 4 modos:
    - 'turno'   : el turno actual (sesión seleccionada).
    - 'dia'     : acumulado de los 3 turnos de la fecha (jornada 24 h).
    - 'semanal' : lunes a domingo de la semana actual, evolución día por día.
    - 'mensual' : día 1 al fin del mes actual, evolución día por día.

  Turno y Día muestran PARETOS (top 6). Semanal y Mensual muestran gráficos
  de EVOLUCIÓN día por día (una barra/punto por fecha).

  La línea se filtra con el selector "Área monitoreada" (#lineaVista).
*/

import { esc, valor } from '../nucleo/utilidades.js';
import { sesion, lineasActivas, nombreLinea } from '../nucleo/estado.js';
import { db } from '../nucleo/almacenamiento.js';
import { todasParadas, todasDefectos } from './historicos.js';

// Instancias de Chart.js activas, para destruirlas antes de recrear.
const charts = {};

// Modo (período) actual del Análisis.
let modoAnalisis = 'turno';

// Plugin propio: dibuja el valor numérico arriba de cada barra.
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

/** Calcula un techo con 15% de margen sobre el máximo de los datasets de barras. */
export function techoConMargen(datasets) {
  let max = 0;
  datasets.forEach(ds => {
    if (ds.type && ds.type !== 'bar') return;
    (ds.data || []).forEach(v => { if (typeof v === 'number' && v > max) max = v; });
  });
  return max === 0 ? undefined : Math.ceil(max * 1.15);
}

/** Crea (o recrea) un gráfico de Chart.js en el canvas indicado. */
export function chart(id, type, data, options = {}, sufijoEtiquetas = '') {
  if (charts[id]) charts[id].destroy();
  const canvas = document.getElementById(id);
  if (!canvas) return;
  charts[id] = new Chart(canvas, {
    type, data, options: {
      responsive: true, maintainAspectRatio: false,
      scales: type === 'doughnut' ? {} : { x: { ticks: { color: '#475569' } }, y: { ticks: { color: '#475569' }, beginAtZero: true } },
      ...options,
      // 'plugins' se mergea aparte para no perder legend/etiquetasBarras cuando
      // el llamador pasa su propio plugins (ej. tooltip personalizado).
      plugins: {
        legend: { labels: { color: '#475569', font: { size: 10 } } },
        etiquetasBarras: { sufijo: sufijoEtiquetas },
        ...(options.plugins || {})
      }
    }
  });
}

/* ==========================================================
   HELPERS DE FECHA / RANGO
   ========================================================== */

/** 'YYYY-MM-DD' de una fecha Date, en hora local. */
function fechaISO(d) {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 10);
}

/** Rango [desde, hasta] (YYYY-MM-DD) de la semana (lunes a domingo) que contiene a la fecha base. */
function rangoSemana(fechaBase) {
  const d = new Date(fechaBase + 'T00:00:00');
  const dow = (d.getDay() + 6) % 7; // 0 = lunes
  const lunes = new Date(d); lunes.setDate(d.getDate() - dow);
  const domingo = new Date(lunes); domingo.setDate(lunes.getDate() + 6);
  return { desde: fechaISO(lunes), hasta: fechaISO(domingo) };
}

/** Rango [desde, hasta] (YYYY-MM-DD) del mes calendario (día 1 al último) que contiene a la fecha base. */
function rangoMes(fechaBase) {
  const d = new Date(fechaBase + 'T00:00:00');
  const primero = new Date(d.getFullYear(), d.getMonth(), 1);
  const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { desde: fechaISO(primero), hasta: fechaISO(ultimo) };
}

/** Lista de fechas 'YYYY-MM-DD' entre desde y hasta (inclusive). */
function listaFechas(desde, hasta) {
  const out = [];
  const d = new Date(desde + 'T00:00:00');
  const fin = new Date(hasta + 'T00:00:00');
  while (d <= fin) { out.push(fechaISO(d)); d.setDate(d.getDate() + 1); }
  return out;
}

/** Etiqueta corta de fecha para el eje X: 'DD/MM'. */
function etiquetaFechaCorta(iso) {
  const [, m, dd] = iso.split('-');
  return `${dd}/${m}`;
}

/** Rango del período activo según el modo. Turno/Día usan la fecha seleccionada. */
function rangoDelModo() {
  const fecha = valor('fecha');
  if (modoAnalisis === 'semanal') return rangoSemana(fecha);
  if (modoAnalisis === 'mensual') return rangoMes(fecha);
  return { desde: fecha, hasta: fecha };
}

/* ==========================================================
   CAPA DE DATOS POR PERÍODO
   ----------------------------------------------------------
   Devuelven registros ya filtrados por período + línea seleccionada.
   ========================================================== */

/** Paradas del período activo, filtradas por la línea del header. */
function paradasDelPeriodo() {
  const l = valor('lineaVista');
  if (modoAnalisis === 'turno') {
    return sesion().paradas
      .filter(x => l === 'TODAS' || x.linea === l)
      .map(x => ({ ...x, fecha: valor('fecha') }));
  }
  const { desde, hasta } = rangoDelModo();
  return todasParadas().filter(x => x.fecha >= desde && x.fecha <= hasta && (l === 'TODAS' || x.linea === l));
}

/** Defectos del período activo, filtrados por línea. */
function defectosDelPeriodo() {
  const l = valor('lineaVista');
  if (modoAnalisis === 'turno') {
    const s = sesion();
    return (s.defectos || [])
      .filter(x => l === 'TODAS' || x.linea === l)
      .map(x => ({ ...x, fecha: valor('fecha'), turno: s.turno }));
  }
  const { desde, hasta } = rangoDelModo();
  return todasDefectos().filter(x => x.fecha >= desde && x.fecha <= hasta && (l === 'TODAS' || x.linea === l));
}

/**
 * m² quemados por línea en una fecha+turno concretos: se toma la ÚLTIMA toma
 * real de lecturasQuemado (el valor acumulado más alto con hora).
 */
function m2QuemadoDeSesion(ses, lineaId) {
  const o = ses?.objetivos?.porLinea?.[lineaId];
  if (!o || !Array.isArray(o.lecturasQuemado)) return 0;
  const conValor = o.lecturasQuemado.filter(t => t && t.hora && t.real > 0);
  if (!conValor.length) return 0;
  // La última (mayor hora) representa el acumulado del turno.
  return conValor.sort((a, b) => (a.hora || '').localeCompare(b.hora || '')).pop().real || 0;
}

/** m² quemados por línea en el período activo (suma de turnos/días). Devuelve {lineaId: m2}. */
function quemadoPorLineaEnPeriodo() {
  const l = valor('lineaVista');
  const lineas = l === 'TODAS' ? lineasActivas().map(x => x.id) : [l];
  const acum = {};
  lineas.forEach(id => { acum[id] = 0; });

  if (modoAnalisis === 'turno') {
    const s = sesion();
    lineas.forEach(id => { acum[id] += m2QuemadoDeSesion(s, id); });
    return acum;
  }
  const { desde, hasta } = rangoDelModo();
  Object.entries(db.sesiones || {}).forEach(([key, ses]) => {
    const [fecha] = key.split('|');
    if (fecha < desde || fecha > hasta) return;
    lineas.forEach(id => { acum[id] += m2QuemadoDeSesion(ses, id); });
  });
  return acum;
}

/* ==========================================================
   PARETOS (modos Turno y Día)
   ========================================================== */

/** Ordena entradas [clave, valor] desc y toma hasta 6, incluyendo empates en el 6º puesto. */
function top6ConEmpates(entradas) {
  const orden = [...entradas].sort((a, b) => b[1] - a[1]);
  if (orden.length <= 6) return orden;
  const corte = orden[5][1]; // valor del 6º
  return orden.filter((e, i) => i < 6 || e[1] === corte);
}

function renderParetos() {
  const regs = paradasDelPeriodo();

  // --- Pareto de causas/motivos + vacío ---
  const causas = {}, vacioCausas = {};
  regs.forEach(x => {
    causas[x.motivo] = (causas[x.motivo] || 0) + x.minutos;
    vacioCausas[x.motivo] = (vacioCausas[x.motivo] || 0) + (x.vacio || 0);
  });
  const ordenC = top6ConEmpates(Object.entries(causas));
  const totalC = ordenC.reduce((a, x) => a + x[1], 0);
  let acC = 0;
  const acumC = ordenC.map(x => { acC += x[1]; return totalC ? +(acC / totalC * 100).toFixed(1) : 0; });
  const dsPareto = [
    { type: 'bar', label: 'Min. parada', data: ordenC.map(x => x[1]), backgroundColor: '#0ea5e9', yAxisID: 'y' },
    { type: 'bar', label: 'Min. vacío horno', data: ordenC.map(x => vacioCausas[x[0]] || 0), backgroundColor: '#f59e0b', yAxisID: 'y' },
    { type: 'line', label: '% acumulado', data: acumC, borderColor: '#dc2626', yAxisID: 'y1' }
  ];
  chart('chartPareto', 'bar', { labels: ordenC.map(x => x[0]), datasets: dsPareto }, {
    scales: {
      x: { ticks: { color: '#475569' } },
      y: { beginAtZero: true, ticks: { color: '#475569' }, max: techoConMargen(dsPareto) },
      y1: { position: 'right', min: 0, max: 100, grid: { display: false }, ticks: { color: '#dc2626', callback: v => v + '%' } }
    }
  });

  // --- Top 6 máquinas con más paradas + vacío ---
  const porEq = {}, vacioEq = {};
  regs.forEach(x => {
    porEq[x.equipo] = (porEq[x.equipo] || 0) + x.minutos;
    vacioEq[x.equipo] = (vacioEq[x.equipo] || 0) + (x.vacio || 0);
  });
  const top6 = top6ConEmpates(Object.entries(porEq));
  const dsTop6 = [
    { label: 'Min. parada', data: top6.map(x => x[1]), backgroundColor: '#0ea5e9' },
    { label: 'Min. vacío horno', data: top6.map(x => vacioEq[x[0]] || 0), backgroundColor: '#f59e0b' }
  ];
  chart('chartTopMaquinas', 'bar', { labels: top6.map(x => x[0]), datasets: dsTop6 }, {
    scales: { x: { ticks: { color: '#475569' } }, y: { beginAtZero: true, ticks: { color: '#475569' }, max: techoConMargen(dsTop6) } }
  });

  // --- Pareto de defectos (top 6, % promedio) ---
  const defectosRegs = defectosDelPeriodo();
  const sumaP = {}, cantP = {};
  defectosRegs.forEach(x => {
    sumaP[x.nombre] = (sumaP[x.nombre] || 0) + x.porcentaje;
    cantP[x.nombre] = (cantP[x.nombre] || 0) + 1;
  });
  const promDef = Object.keys(sumaP).map(n => [n, +(sumaP[n] / cantP[n]).toFixed(2)]);
  const top6Def = top6ConEmpates(promDef);
  const totalDef = top6Def.reduce((a, x) => a + x[1], 0);
  let acD = 0;
  const acumDef = top6Def.map(x => { acD += x[1]; return totalDef ? +(acD / totalDef * 100).toFixed(1) : 0; });
  const dsDef = [
    { type: 'bar', label: '% promedio', data: top6Def.map(x => x[1]), backgroundColor: '#dc2626', yAxisID: 'y' },
    { type: 'line', label: '% acumulado', data: acumDef, borderColor: '#7c3aed', yAxisID: 'y1' }
  ];
  chart('chartParetoDefectos', 'bar', { labels: top6Def.map(x => x[0]), datasets: dsDef }, {
    scales: {
      x: { ticks: { color: '#475569' } },
      y: { beginAtZero: true, ticks: { color: '#475569', callback: v => v + '%' }, max: techoConMargen(dsDef) },
      y1: { position: 'right', min: 0, max: 100, grid: { display: false }, ticks: { color: '#7c3aed', callback: v => v + '%' } }
    }
  }, '%');

  // --- Quemado por línea (m²) ---
  const quemado = quemadoPorLineaEnPeriodo();
  const idsQ = Object.keys(quemado);
  const dsQ = [{ label: 'm² quemados', data: idsQ.map(id => Math.round(quemado[id])), backgroundColor: '#10b981' }];
  chart('chartQuemadoLinea', 'bar', { labels: idsQ.map(id => nombreLinea(id)), datasets: dsQ }, {
    scales: { x: { ticks: { color: '#475569' } }, y: { beginAtZero: true, ticks: { color: '#475569' }, max: techoConMargen(dsQ) } }
  });

  // --- Hallazgos ---
  const topEq = Object.entries(porEq).sort((a, b) => b[1] - a[1])[0];
  const topC = ordenC[0];
  const el = document.getElementById('hallazgos');
  if (el) {
    el.innerHTML = [
      ['Equipo prioritario', topEq ? `${topEq[0]} acumula ${topEq[1]} min.` : 'Sin datos.'],
      ['Causa prioritaria', topC ? `${topC[0]} representa ${totalC ? (topC[1] / totalC * 100).toFixed(1) : 0}% del total.` : 'Sin causas.'],
      ['Total parada', `${regs.reduce((a, x) => a + x.minutos, 0)} min de parada y ${regs.reduce((a, x) => a + (x.vacio || 0), 0)} min de vacío en el período.`]
    ].map(x => `<div class="bg-slate-50 border border-slate-200 p-3 rounded"><b class="text-xs text-sky-700">${x[0]}</b><p class="mt-1 text-sm text-slate-700">${esc(x[1])}</p></div>`).join('');
  }
}

/* ==========================================================
   EVOLUCIÓN DÍA POR DÍA (modos Semanal y Mensual)
   ========================================================== */

function renderEvolucion() {
  const l = valor('lineaVista');
  const { desde, hasta } = rangoDelModo();
  const fechas = listaFechas(desde, hasta);
  const etiquetas = fechas.map(etiquetaFechaCorta);
  // Línea concreta bajo análisis. Cada línea es independiente: nunca se mezclan.
  // (Si por un dato viejo llegara 'TODAS', se toma la primera línea activa.)
  const lineaSel = (l && l !== 'TODAS') ? l : (lineasActivas()[0]?.id || l);
  const lineas = [lineaSel];

  // Ticks del eje X compartidos por los gráficos de barras diarias.
  const ejeXDiario = { ticks: { color: '#475569', autoSkip: false, maxRotation: 60, minRotation: 0 } };

  // --- Datos base por día ---
  const paradas = todasParadas().filter(x => x.fecha >= desde && x.fecha <= hasta && (l === 'TODAS' || x.linea === l));
  const defectos = todasDefectos().filter(x => x.fecha >= desde && x.fecha <= hasta && (l === 'TODAS' || x.linea === l));

  // Para cada fecha precalculamos: totales, máquina top (parada), motivo top y defecto top.
  const detallePorDia = fechas.map(f => {
    const delDia = paradas.filter(x => x.fecha === f);
    const totalParada = delDia.reduce((a, x) => a + x.minutos, 0);
    const totalVacio = delDia.reduce((a, x) => a + (x.vacio || 0), 0);

    // Máquina top por minutos de parada + su vacío.
    const porEq = {};
    delDia.forEach(x => {
      if (!porEq[x.equipo]) porEq[x.equipo] = { min: 0, vacio: 0 };
      porEq[x.equipo].min += x.minutos;
      porEq[x.equipo].vacio += (x.vacio || 0);
    });
    const maqTop = Object.entries(porEq).sort((a, b) => b[1].min - a[1].min)[0] || null;

    // Motivo top por minutos + su vacío.
    const porMot = {};
    delDia.forEach(x => {
      const m = x.motivo || '(sin motivo)';
      if (!porMot[m]) porMot[m] = { min: 0, vacio: 0 };
      porMot[m].min += x.minutos;
      porMot[m].vacio += (x.vacio || 0);
    });
    const motTop = Object.entries(porMot).sort((a, b) => b[1].min - a[1].min)[0] || null;

    // Defecto top del día por % (el más alto).
    const defDia = defectos.filter(x => x.fecha === f);
    const defTop = defDia.length
      ? defDia.slice().sort((a, b) => b.porcentaje - a.porcentaje)[0]
      : null;

    // Quemado del día (m², sumando líneas del scope).
    let quemado = 0;
    Object.entries(db.sesiones || {}).forEach(([key, ses]) => {
      if (key.split('|')[0] !== f) return;
      lineas.forEach(id => { quemado += m2QuemadoDeSesion(ses, id); });
    });

    // Calidad global del día = PROMEDIO DE LOS 3 TURNOS de LA LÍNEA seleccionada.
    // Cada línea es un proceso independiente: nunca se mezclan líneas entre sí.
    // Se toma la calidad de esta línea en cada turno del día (los que tengan
    // dato) y se promedian los turnos, para que Mañana/Tarde/Noche pesen igual.
    const calsTurno = [];
    Object.entries(db.sesiones || {}).forEach(([key, ses]) => {
      if (key.split('|')[0] !== f) return;
      const c = Number(ses?.objetivos?.porLinea?.[lineaSel]?.realCalidad);
      if (c > 0) calsTurno.push(c);
    });
    const calidad = calsTurno.length
      ? +(calsTurno.reduce((a, b) => a + b, 0) / calsTurno.length).toFixed(1)
      : null;

    return { fecha: f, totalParada, totalVacio, maqTop, motTop, defTop, quemado: Math.round(quemado), calidad };
  });

  // ---------- 1) PARADAS Y VACÍO POR DÍA (dos barras) ----------
  const dsP = [
    { label: 'Min. parada', data: detallePorDia.map(d => d.totalParada), backgroundColor: '#0ea5e9' },
    { label: 'Min. vacío horno', data: detallePorDia.map(d => d.totalVacio), backgroundColor: '#f59e0b' }
  ];
  chart('chartEvolParadas', 'bar', { labels: etiquetas, datasets: dsP }, {
    scales: { x: ejeXDiario, y: { beginAtZero: true, ticks: { color: '#475569' }, max: techoConMargen(dsP) } },
    plugins: {
      tooltip: {
        callbacks: {
          afterBody: (items) => {
            const d = detallePorDia[items[0].dataIndex];
            if (!d || !d.maqTop) return 'Sin paradas registradas.';
            const [nombre, v] = d.maqTop;
            return `Máquina que más paró: ${nombre}\n  ${v.min} min parada · ${v.vacio} min vacío`;
          }
        }
      }
    }
  });

  // ---------- 2) MOTIVO PRINCIPAL POR DÍA ----------
  const dsMot = [{ label: 'Min. del motivo principal', data: detallePorDia.map(d => d.motTop ? d.motTop[1].min : 0), backgroundColor: '#6366f1' }];
  chart('chartEvolMotivos', 'bar', { labels: etiquetas, datasets: dsMot }, {
    scales: { x: ejeXDiario, y: { beginAtZero: true, ticks: { color: '#475569' }, max: techoConMargen(dsMot) } },
    plugins: {
      tooltip: {
        callbacks: {
          afterBody: (items) => {
            const d = detallePorDia[items[0].dataIndex];
            if (!d || !d.motTop) return 'Sin paradas registradas.';
            const [nombre, v] = d.motTop;
            return `Motivo: ${nombre}\n  ${v.min} min parada · ${v.vacio} min vacío`;
          }
        }
      }
    }
  });

  // ---------- 3) QUEMADO POR DÍA (m²) ----------
  const dsQ = [{ label: 'm² quemados', data: detallePorDia.map(d => d.quemado), backgroundColor: '#10b981' }];
  chart('chartEvolQuemado', 'bar', { labels: etiquetas, datasets: dsQ }, {
    scales: { x: ejeXDiario, y: { beginAtZero: true, ticks: { color: '#475569' }, max: techoConMargen(dsQ) } }
  });

  // ---------- 4) CALIDAD GLOBAL POR DÍA (línea %) ----------
  chart('chartEvolCalidad', 'line', {
    labels: etiquetas,
    datasets: [{ label: 'Calidad global %', data: detallePorDia.map(d => d.calidad), borderColor: '#059669', backgroundColor: 'rgba(5,150,105,0.1)', spanGaps: true, tension: 0.2 }]
  }, {
    scales: { x: ejeXDiario, y: { ticks: { color: '#475569', callback: v => v + '%' } } }
  });

  // ---------- 5) DEFECTO PRINCIPAL POR DÍA (% del más alto) ----------
  const dsD = [{ label: '% defecto máx.', data: detallePorDia.map(d => d.defTop ? +d.defTop.porcentaje.toFixed(2) : 0), backgroundColor: '#dc2626' }];
  chart('chartEvolDefectos', 'bar', { labels: etiquetas, datasets: dsD }, {
    scales: { x: ejeXDiario, y: { beginAtZero: true, ticks: { color: '#475569', callback: v => v + '%' }, max: techoConMargen(dsD) } },
    plugins: {
      tooltip: {
        callbacks: {
          afterBody: (items) => {
            const d = detallePorDia[items[0].dataIndex];
            if (!d || !d.defTop) return 'Sin defectos registrados.';
            return `Defecto que más impactó: ${d.defTop.nombre}`;
          }
        }
      }
    }
  }, '%');

  // ---------- LECTURA PARA PLAN DE ACCIÓN (mini-análisis del período) ----------
  renderHallazgosEvolucion(paradas, defectos, detallePorDia);
}

/**
 * Arma las tarjetas de "lectura para plan de acción" del período histórico
 * (semanal/mensual): máquina y causa que más impactaron en todo el período,
 * el día más crítico, el defecto preponderante y el total quemado.
 */
function renderHallazgosEvolucion(paradas, defectos, detallePorDia) {
  const el = document.getElementById('hallazgosEvolucion');
  if (!el) return;

  // Máquina que más paró en todo el período.
  const porEq = {};
  paradas.forEach(x => { porEq[x.equipo] = (porEq[x.equipo] || 0) + x.minutos; });
  const maqTop = Object.entries(porEq).sort((a, b) => b[1] - a[1])[0];

  // Causa/motivo que más minutos generó en el período.
  const porMot = {};
  paradas.forEach(x => { const m = x.motivo || '(sin motivo)'; porMot[m] = (porMot[m] || 0) + x.minutos; });
  const motTop = Object.entries(porMot).sort((a, b) => b[1] - a[1])[0];

  // Día más crítico por minutos de parada.
  const diaPeor = [...detallePorDia].sort((a, b) => b.totalParada - a.totalParada)[0];

  // Defecto preponderante del período (mayor % promedio).
  const sumaP = {}, cantP = {};
  defectos.forEach(x => { sumaP[x.nombre] = (sumaP[x.nombre] || 0) + x.porcentaje; cantP[x.nombre] = (cantP[x.nombre] || 0) + 1; });
  const defTop = Object.keys(sumaP)
    .map(n => [n, +(sumaP[n] / cantP[n]).toFixed(2)])
    .sort((a, b) => b[1] - a[1])[0];

  const totalParada = paradas.reduce((a, x) => a + x.minutos, 0);
  const totalVacio = paradas.reduce((a, x) => a + (x.vacio || 0), 0);
  const totalQuemado = detallePorDia.reduce((a, d) => a + d.quemado, 0);

  const tarjetas = [
    ['Máquina prioritaria', maqTop ? `${maqTop[0]} acumuló ${maqTop[1]} min de parada en el período.` : 'Sin paradas en el período.'],
    ['Causa prioritaria', motTop ? `"${motTop[0]}" generó ${motTop[1]} min (el motivo más costoso del período).` : 'Sin causas registradas.'],
    ['Día más crítico', diaPeor && diaPeor.totalParada > 0 ? `${etiquetaFechaCorta(diaPeor.fecha)} con ${diaPeor.totalParada} min de parada.` : 'Sin un día destacado.'],
    ['Defecto preponderante', defTop ? `"${defTop[0]}" con ${defTop[1]}% promedio en el período.` : 'Sin defectos registrados.'],
    ['Totales de parada', `${totalParada} min de parada y ${totalVacio} min de vacío acumulados.`],
    ['Producción del período', `${totalQuemado.toLocaleString('es-AR')} m² quemados en total.`]
  ];

  el.innerHTML = tarjetas.map(x =>
    `<div class="bg-slate-50 border border-slate-200 p-3 rounded"><b class="text-xs text-sky-700">${x[0]}</b><p class="mt-1 text-sm text-slate-700">${esc(x[1])}</p></div>`
  ).join('');
}

/* ==========================================================
   ENTRY POINT
   ========================================================== */

/** Dibuja el Análisis según el período activo (paretos o evolución). */
export function renderAnalisis() {
  const esEvolucion = (modoAnalisis === 'semanal' || modoAnalisis === 'mensual');
  document.getElementById('bloqueParetos')?.classList.toggle('hidden', esEvolucion);
  document.getElementById('bloqueEvolucion')?.classList.toggle('hidden', !esEvolucion);

  // Etiqueta del rango.
  const lbl = document.getElementById('analisisRangoLabel');
  if (lbl) {
    if (modoAnalisis === 'turno') lbl.textContent = `Turno ${sesion().turno} · ${valor('fecha')}`;
    else if (modoAnalisis === 'dia') lbl.textContent = `Día completo · ${valor('fecha')}`;
    else { const r = rangoDelModo(); lbl.textContent = `${r.desde} → ${r.hasta}`; }
  }

  if (esEvolucion) renderEvolucion();
  else renderParetos();
}

/** Cambia el período del Análisis y refresca. */
export function cambiarModoAnalisis(modo) {
  modoAnalisis = ['turno', 'dia', 'semanal', 'mensual'].includes(modo) ? modo : 'turno';
  const botones = { turno: 'btnAnalisisTurno', dia: 'btnAnalisisDia', semanal: 'btnAnalisisSemanal', mensual: 'btnAnalisisMensual' };
  Object.entries(botones).forEach(([m, id]) => {
    const b = document.getElementById(id);
    if (b) b.className = `btn text-xs py-1.5 ${m === modoAnalisis ? 'bg-sky-700 text-white' : 'bg-white border border-slate-300 text-slate-700'}`;
  });
  renderAnalisis();
}

// ==========================================================
// EXPOSICIÓN A window
// ==========================================================
window.cambiarModoAnalisis = cambiarModoAnalisis;
