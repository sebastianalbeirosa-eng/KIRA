/* ========================================================== */
/* VISTA-DE-PLANTA.JS — KPIs, mapa de calor y métricas         */
/* ========================================================== */
/*
  El módulo más grande de KIRA: calcula todas las métricas del
  turno (disponibilidad, calidad, EGE, etc.) y dibuja tanto el
  dashboard operativo (kpis, máquinas, acciones) como la Vista
  de Planta (mapa de calor con semáforos por equipo).

  Dependencias resueltas: notasTurno.js, gestionDefectos.js e
  historicos.js ya están cortados. Este archivo ahora corre completo.
  (Dependencia circular con historicos.js: ese módulo también
  importa renderTodo desde acá. Es inofensiva, ver nota en
  constructorPlanta.js para el detalle de por qué no rompe nada.)
*/

import { valor, esc, hoyLocal } from '../nucleo/utilidades.js';
import {
  sesion, lineasActivas, lineaPorId, nombreLinea,
  asegurarObjetivosSesion, asegurarProduccionSesion, TURNO_MIN
} from '../nucleo/estado.js';

import { asegurarNotaTurno } from './notasTurno.js';
import { asegurarDefectosSesion, renderDefectos } from './gestionDefectos.js';
import { renderAnalisis } from './graficosYAnalisis.js';
import { todasParadas, todasDefectos } from './historicos.js';

// Variable de estado del módulo: define si el Análisis muestra el turno
// actual o los últimos 7 días. Se lee desde graficosYAnalisis.js también.
export let analisisModo = 'turno';

/**
 * Cambia analisisModo. Existe como función (y no como reasignación directa
 * desde otro módulo) porque en ES6 modules las variables importadas son de
 * solo lectura: graficosYAnalisis.js no puede escribir "analisisModo = x"
 * directo, tiene que pasar por este setter.
 */
export function setAnalisisModo(modo) {
  analisisModo = modo;
}

// Umbrales de criticidad para el semáforo del mapa de calor.
export const UMBRAL_PARADA = { critico: 100, alto: 60, medio: 20 };
export const UMBRAL_VACIO = { critico: 50, alto: 30, medio: 10 };
export const UMBRAL_DEFECTO = { critico: 2.1, alto: 1.6, medio: 1.1 };

/** Devuelve las paradas del turno actual, filtradas por la línea seleccionada en pantalla. */
export function datosVista() {
  const l = valor('lineaVista');
  return sesion().paradas.filter(x => l === 'TODAS' || x.linea === l);
}

/** Calcula el rango de fechas de los últimos 7 días (para el modo de análisis semanal). */
export function rangoSemanal() {
  const hasta = hoyLocal();
  const d = new Date();
  d.setDate(d.getDate() - 6);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  const desde = d.toISOString().slice(0, 10);
  return { desde, hasta };
}

/** Devuelve las paradas a analizar según el modo activo (turno actual o últimos 7 días). */
export function datosAnalisis() {
  if (analisisModo === 'semanal') {
    const { desde, hasta } = rangoSemanal();
    const l = valor('lineaVista');
    return todasParadas().filter(x => x.fecha >= desde && x.fecha <= hasta && (l === 'TODAS' || x.linea === l));
  }
  return datosVista();
}

/** Devuelve los defectos a analizar según el modo activo (turno actual o últimos 7 días). */
export function defectosAnalisis() {
  const l = valor('lineaVista');
  if (analisisModo === 'semanal') {
    const { desde, hasta } = rangoSemanal();
    return todasDefectos().filter(x => x.fecha >= desde && x.fecha <= hasta && (l === 'TODAS' || x.linea === l));
  }
  const s = sesion();
  asegurarDefectosSesion(s);
  const turnoActual = valor('turno');
  return s.defectos
    .filter(x => l === 'TODAS' || x.linea === l)
    .map(x => ({ ...x, turno: turnoActual }));
}

/** Calcula las métricas agregadas (parada, vacío, eventos, disponibilidad) para un set de registros dado. */
export function metricas(regs = datosVista()) {
  const parada = regs.reduce((a, x) => a + x.minutos, 0);
  const vacio = regs.reduce((a, x) => a + x.vacio, 0);
  const eventos = regs.reduce((a, x) => a + x.eventos, 0);
  const disponibilidad = Math.max(0, 100 - (parada / TURNO_MIN * 100));
  const i = sesion().indicadores;
  return { parada, vacio, eventos, disponibilidad, productivos: Math.max(0, TURNO_MIN - parada), calidad: i.calidad, productividad: i.productividad };
}

/** Dibuja las tarjetas KPI del dashboard operativo principal (pestaña "Dashboard"). */
export function renderKpis() {
  const s = sesion();
  asegurarObjetivosSesion(s);

  const lineaFiltro = document.getElementById('lineaVista')?.value || 'TODAS';

  let m, objCal, objProd, objVacio, realCal, parcialCal, horaParcial, realProd;

  // ------------------------------------------------------
  // DATOS DE UNA LÍNEA ESPECÍFICA
  // ------------------------------------------------------
  if (lineaFiltro !== 'TODAS' && lineaPorId(lineaFiltro)) {
    const paradasLinea = s.paradas.filter(x => x.linea === lineaFiltro);
    m = metricas(paradasLinea);
    const o = s.objetivos.porLinea[lineaFiltro];
    objCal = o.calidad;
    objProd = o.produccion;
    objVacio = o.vacioMax;
    realCal = o.realCalidad || 0;
    parcialCal = o.calidadParcial || 0;
    horaParcial = o.horaCalidadParcial || '';
    realProd = o.realProd || 0;

  // ------------------------------------------------------
  // DATOS DE TODAS LAS LÍNEAS
  // ------------------------------------------------------
  } else {
    m = metricas(s.paradas);
    const activas = lineasActivas();
    const objs = activas.map(l => s.objetivos.porLinea[l.id]);

    objCal = objs.length ? objs.reduce((a, o) => a + o.calidad, 0) / objs.length : 0;
    objProd = objs.reduce((a, o) => a + o.produccion, 0);
    objVacio = objs.reduce((a, o) => a + o.vacioMax, 0);
    realCal = objs.length ? objs.reduce((a, o) => a + (o.realCalidad || 0), 0) / objs.length : 0;
    parcialCal = objs.length ? objs.reduce((a, o) => a + (o.calidadParcial || 0), 0) / objs.length : 0;

    // Para "TODAS", mostramos la última hora registrada.
    const horasParcial = objs.map(o => o.horaCalidadParcial).filter(Boolean).sort();
    horaParcial = horasParcial.length ? horasParcial[horasParcial.length - 1] : '';
    realProd = objs.reduce((a, o) => a + (o.realProd || 0), 0);
  }

  // DISPONIBILIDAD
  const dispVal = m.disponibilidad;
  const dispColor = dispVal >= 90 ? 'text-emerald-700' : 'text-rose-700';
  const dispTag = dispVal >= 90 ? '▲ ÓPTIMO' : '▼ BAJA';

  // CALIDAD (desvío entre calidad parcial y calidad global)
  const desvioCalidad = parcialCal - realCal;
  let calColor, calTag;
  if (desvioCalidad > 0) {
    calColor = 'text-emerald-700';
    calTag = `↑ +${desvioCalidad.toFixed(2)}%${horaParcial ? ` · ${horaParcial} hs` : ''}`;
  } else if (desvioCalidad < 0) {
    calColor = 'text-rose-700';
    calTag = `↓ ${desvioCalidad.toFixed(2)}%${horaParcial ? ` · ${horaParcial} hs` : ''}`;
  } else {
    calColor = 'text-slate-700';
    calTag = `→ 0.00%${horaParcial ? ` · ${horaParcial} hs` : ''}`;
  }

  // PRODUCTIVIDAD
  const prodOk = realProd >= objProd;
  const prodDiff = objProd - realProd;
  const prodColor = prodOk ? 'text-emerald-700' : 'text-rose-700';
  const prodTag = prodOk ? `▲ +${realProd - objProd}m²` : `▼ Faltan ${prodDiff}m²`;

  // VACÍO
  const vacioOk = m.vacio <= objVacio;
  const vacioColor = vacioOk ? 'text-sky-700' : 'text-rose-700';

  // TARJETAS KPI
  const cards = [
    ['Tiempo productivo', `${m.productivos} min`, 'text-emerald-700', 'OPERACIÓN'],
    ['Minutos de parada', `${m.parada} min`, m.parada > 48 ? 'text-rose-700' : 'text-amber-700', 'PÉRDIDA'],
    ['Vacío de horno', `${m.vacio} min`, vacioColor, `MÁX. ${objVacio}m`],
    ['Eventos', m.eventos, 'text-sky-700', 'REGISTROS'],
    ['Disponibilidad', `${dispVal.toFixed(1)}%`, dispColor, dispTag],
    ['Calidad', `${realCal.toFixed(2)}%`, calColor, calTag, parcialCal],
    ['Productividad', `${realProd} m²`, prodColor, prodTag],
    ['Acciones', sesion().acciones.length, 'text-amber-700', 'CORRECTIVAS']
  ];

  const container = document.getElementById('kpis');
  if (!container) return;

  container.innerHTML = cards.map(c => {
    const esCalidad = c[0] === 'Calidad';
    const tagColor = c[3].includes('↓') || c[3].includes('Faltan')
      ? 'text-rose-600'
      : c[3].includes('↑') ? 'text-emerald-600' : 'text-slate-400';

    return `
      <div class="panel p-3 border-t-2 border-t-slate-400 bg-white">
        <div class="flex justify-between gap-2">
          <div class="text-[9px] uppercase font-black text-slate-500">${c[0]}</div>
          <div class="text-[8px] font-black ${tagColor}">${c[3]}</div>
        </div>
        <div class="text-xl font-black ${c[2]}">${c[1]}</div>
        ${esCalidad ? `
          <div class="mt-1 text-[9px] font-bold text-slate-500">
            Parcial Qualitron:
            <span class="text-slate-700">${Number(c[4] || 0).toFixed(2)}%</span>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

/** Dibuja el diagrama de proceso (bloques por máquina) del dashboard operativo. */
export function renderMaquinas() {
  const linea = valor('lineaVista');
  const lineas = linea === 'TODAS' ? lineasActivas().map(l => l.id) : [linea];
  const s = sesion();
  asegurarProduccionSesion(s);
  document.getElementById('maquinas').innerHTML = lineas.map(l => {
    const lineaConfig = lineaPorId(l);
    if (!lineaConfig) return '';
    const baseEquips = lineaConfig.equipos.filter(e => e.activo !== false);

    const bloques = baseEquips.map((eqConfig, idx) => {
      const eqBase = eqConfig.nombre;
      const regs = sesion().paradas.filter(x => {
        if (x.linea !== l) return false;
        if (x.equipoId) return x.equipoId === eqConfig.id;
        let cleanX = x.equipo;
        if (cleanX.includes('Maxi SIMA') || cleanX.includes('Maxi SITI')) {
          cleanX = cleanX.replace(/ [12]$/, '');
        }
        return cleanX === eqBase;
      });
      const mins = regs.reduce((a, x) => a + x.minutos, 0);
      const vacio = regs.reduce((a, x) => a + x.vacio, 0);
      const clase = mins > 40 ? 'critical' : mins > 15 ? 'warn' : '';
      const estado = mins > 40 ? 'DETENCIÓN CRÍTICA' : mins > 15 ? 'EN ADVERTENCIA' : 'OPERATIVO';

      return `
        <button class="machine ${clase}" onclick="abrirGestionEquipo('${l}', '${encodeURIComponent(eqBase)}', '${eqConfig.id}')">
          <div class="flex justify-between items-start gap-2">
            <span class="text-[8px] font-black text-slate-400">EQ-${String(idx + 1).padStart(2, '0')}</span>
            <span class="status-dot"></span>
          </div>
          <div class="font-black text-[11px] mt-1 min-h-[30px]">${esc(eqBase)}</div>
          <div class="border-t border-slate-200 mt-1 pt-1 grid grid-cols-2 gap-1">
            <div><span class="block text-[7px] font-bold text-slate-400">PARADA</span><b class="text-sm">${mins}</b><small> min</small></div>
            <div><span class="block text-[7px] font-bold text-slate-400">VACÍO</span><b class="text-sm text-sky-700">${vacio}</b><small> min</small></div>
          </div>
          <div class="text-[7px] font-black mt-1 ${clase === 'critical' ? 'text-rose-700' : clase === 'warn' ? 'text-amber-700' : 'text-emerald-700'}">${estado}</div>
        </button>
      `;
    }).join('');

    const total = s.paradas.filter(x => x.linea === l).reduce((a, x) => a + x.minutos, 0);
    const prod = s.productoPorLinea[l] || { producto: '', formato: '' };
    return `
      <section class="scada-line mb-3">
        <div class="line-caption flex flex-wrap items-center justify-between">
          <div class="flex flex-wrap items-center gap-20">
            <span>${esc(lineaConfig.nombre)}${lineaConfig.descripcion ? ` · ${esc(lineaConfig.descripcion)}` : ''}</span>
            <div class="flex gap-2 no-print items-center">
              <label class="text-[9px] font-bold text-slate-500">Producto
                <input type="text" class="field mt-1 text-[11px]" style="padding:2px 6px;height:24px;width:180px;" value="${esc(prod.producto)}" placeholder="Ej: ARUSHA ARENA" onchange="guardarProduccionLinea('${l}','producto',this.value)">
              </label>
              <label class="text-[9px] font-bold text-slate-500">Formato
                <input type="text" class="field mt-1 text-[11px]" style="padding:2px 6px;height:24px;width:110px;" value="${esc(prod.formato)}" placeholder="Ej: 45x45" onchange="guardarProduccionLinea('${l}','formato',this.value)">
              </label>
            </div>
          </div>
          <span>Tiempo detenido: ${total} min</span>
        </div>
        <div class="process-track">${bloques}</div>
      </section>
    `;
  }).join('');
}

/** Dibuja la lista de acciones correctivas recientes del turno. */
export function renderAcciones() {
  const lineaFiltro = valor('lineaVista');
  const a = [...sesion().acciones]
    .filter(x => lineaFiltro === 'TODAS' || x.linea === lineaFiltro)
    .reverse();
  document.getElementById('cantidadAcciones').textContent = a.length;
  document.getElementById('accionesRecientes').innerHTML = a.length ? a.map(x => `
    <div class="flex justify-between items-start border-b border-slate-200 pb-2 bg-white p-2 rounded shadow-xs">
      <div>
        <div class="flex justify-between font-bold text-slate-800 gap-2"><b>${esc(x.equipo)}</b><span class="text-slate-400 text-[11px]">${esc(x.hora)} · ${esc(nombreLinea(x.linea))}</span></div>
        <div class="text-[13px] text-slate-600 mt-0.5">${esc(x.detalle)}</div>
        <div class="text-[9px] text-slate-400 mt-1">Resp: ${esc(x.responsable || 'No indicado')}</div>
      </div>
      <div class="flex gap-1 no-print">
        <button class="text-sky-600 font-bold text-[10px] hover:underline" onclick="editarAccion('${x.id}')">Editar</button>
        <button class="text-rose-500 font-bold text-[10px] hover:underline" onclick="eliminarAccionDirecta('${x.id}')">Eliminar</button>
      </div>
    </div>
  `).join('') : '<p class="text-slate-500 italic text-xs">No hay acciones correctivas registradas en este turno.</p>';
}

/** Refresca el dashboard operativo completo (KPIs + máquinas + acciones + defectos). */
export function renderTodo() {
  renderKpis();
  renderMaquinas();
  renderAcciones();
  renderDefectos();
}

/** Clasifica un valor numérico en un nivel de criticidad (bajo/medio/alto/crítico) según umbrales dados. */
export function nivelPorValor(valor, umbrales) {
  if (valor >= umbrales.critico) return { key: 3, label: 'CRÍTICO', badge: 'bg-rose-600 text-white', rowBg: 'bg-rose-100' };
  if (valor >= umbrales.alto) return { key: 2, label: 'ALTO', badge: 'bg-rose-300 text-rose-900', rowBg: 'bg-rose-50' };
  if (valor >= umbrales.medio) return { key: 1, label: 'MEDIO', badge: 'bg-amber-400 text-slate-900', rowBg: 'bg-amber-50' };
  return { key: 0, label: 'BAJO', badge: 'bg-emerald-400 text-slate-900', rowBg: 'bg-emerald-50' };
}

/** Cambia el área monitoreada (filtro de línea) y refresca todas las vistas visibles en pantalla. */
export function cambiarAreaMonitoreada() {
  renderTodo();
  if (!document.getElementById('vistaAnalisis').classList.contains('hidden')) renderAnalisis();
  if (!document.getElementById('vistaPlanta').classList.contains('hidden')) renderVistaPlanta();
}

/**
 * Dibuja la Vista de Planta completa: KPIs industriales (EGE, disponibilidad,
 * calidad, rendimiento), mapa de calor de máquinas y defectos, top motivos
 * de parada, últimas paradas y comentario automático de cierre de turno.
 */

/**
 * Calcula TODOS los KPIs industriales (parada, vacío, máquina crítica,
 * defecto preponderante, disponibilidad de equipos, rendimiento, calidad,
 * EGE) para una línea específica o para 'TODAS'. Es una función PURA: no
 * toca el DOM, solo lee de la sesión y devuelve números/strings ya
 * calculados. Por eso la puede usar tanto renderVistaPlanta() (pantalla)
 * como generarAsakai.js (reporte PDF) y ambos van a mostrar SIEMPRE el
 * mismo valor — antes, el ASAKAI leía el texto ya renderizado en el DOM
 * de #vpKpis, lo que fallaba si el usuario no había visitado antes la
 * pestaña "Vista de Planta" (bug ya corregido: ver generarAsakai.js).
 */
export function calcularKpisPlanta(l) {
  const s = sesion();
  asegurarNotaTurno(s);
  asegurarDefectosSesion(s);

  const paradasScope = s.paradas.filter(x => l === 'TODAS' || x.linea === l);
  const defectosScope = s.defectos.filter(x => l === 'TODAS' || x.linea === l);
  const m = metricas(paradasScope);
  const lineasIter = l === 'TODAS' ? lineasActivas() : [lineaPorId(l)].filter(Boolean);

  let filasMaquinas = [];
  let filasMapaCalor = [];
  lineasIter.forEach(lineaConfig => {
    lineaConfig.equipos.filter(e => e.activo !== false).forEach(eqConfig => {
      const regs = paradasScope.filter(x => {
        if (x.linea !== lineaConfig.id) return false;
        if (x.equipoId) return x.equipoId === eqConfig.id;
        let cleanX = x.equipo;
        if (cleanX.includes('Maxi SIMA') || cleanX.includes('Maxi SITI')) cleanX = cleanX.replace(/ [12]$/, '');
        return cleanX === eqConfig.nombre;
      });
      if (!regs.length) return;
      const mins = regs.reduce((a, x) => a + x.minutos, 0);
      const vacio = regs.reduce((a, x) => a + x.vacio, 0);
      const motivoPrincipal = [...regs].sort((a, b) => b.minutos - a.minutos)[0]?.motivo || '';
      filasMaquinas.push({ equipo: eqConfig.nombre, lineaNombre: lineaConfig.nombre, mins, vacio, motivo: motivoPrincipal });

      // MAPA DE CALOR: a diferencia de filasMaquinas (un total por
      // equipo), acá se agrupa por equipo + motivo. Si el equipo tuvo
      // paradas por 2 motivos distintos, aparecen 2 filas separadas;
      // si el mismo motivo se repitió varias veces (2+ eventos), esas
      // sí se suman en una sola fila.
      const porMotivo = {};
      regs.forEach(x => {
        const clave = x.motivo || '(sin motivo)';
        if (!porMotivo[clave]) porMotivo[clave] = { mins: 0, vacio: 0, observaciones: [] };
        porMotivo[clave].mins += x.minutos;
        porMotivo[clave].vacio += x.vacio;
        if (x.obs && x.obs.trim()) {
          porMotivo[clave].observaciones.push(x.obs.trim());
        }
      });
      Object.entries(porMotivo).forEach(([motivo, datos]) => {
        const obsTexto = datos.observaciones.length > 0 ? datos.observaciones.join(' | ') : '—';
        filasMapaCalor.push({ 
          equipo: eqConfig.nombre, 
          lineaNombre: lineaConfig.nombre, 
          mins: datos.mins, 
          vacio: datos.vacio, 
          motivo,
          observaciones: obsTexto
        });
      });
    });
  });
  filasMaquinas.sort((a, b) => b.mins - a.mins);
  filasMapaCalor.sort((a, b) => b.mins - a.mins);

  // ---------- CÁLCULO DE DEFECTO PREPONDERANTE ----------
  const defectosOrdenados = [...defectosScope].sort((a, b) => b.porcentaje - a.porcentaje);
  const defectoPreponderante = defectosOrdenados[0] || null;

  const pctParada = (m.parada / TURNO_MIN * 100).toFixed(1);
  const pctVacio = (m.vacio / TURNO_MIN * 100).toFixed(1);

  // ---------- MÁQUINA MÁS CRÍTICA ----------
  const maquinaCritica = filasMaquinas[0];
  const nivelCritica = nivelPorValor(maquinaCritica?.mins || 0, UMBRAL_PARADA);
  const valorCriticaColor = nivelCritica.key >= 2 ? 'text-rose-700' : (nivelCritica.key === 1 ? 'text-amber-600' : 'text-emerald-700');

  const totalEquiposScope = lineasIter.reduce((a, lc) => a + lc.equipos.filter(e => e.activo !== false).length, 0);
  const equiposConProblema = filasMaquinas.filter(f => {
    const nP = nivelPorValor(f.mins, UMBRAL_PARADA);
    const nV = nivelPorValor(f.vacio, UMBRAL_VACIO);
    return Math.max(nP.key, nV.key) >= 1;
  }).length;
  const disponibilidadEquipos = totalEquiposScope ? ((totalEquiposScope - equiposConProblema) / totalEquiposScope * 100) : 100;

  // ---------- DEFECTO PREPONDERANTE ----------
  const nivelDefecto = nivelPorValor(defectoPreponderante?.porcentaje || 0, UMBRAL_DEFECTO);
  const valorDefectoColor = nivelDefecto.key >= 2 ? 'text-rose-700' : (nivelDefecto.key === 1 ? 'text-amber-600' : 'text-emerald-700');

  // --- RENDIMIENTO: m² quemados vs objetivo proporcional a la hora ---
  asegurarObjetivosSesion(s);
  const inicioTurno = { Mañana: 5, Tarde: 13, Noche: 21 }[s.turno] ?? 5;

  function minutosDesdeInicio(hora) {
    if (!hora) return null;
    const [h, min] = hora.split(':').map(Number);
    let total = h * 60 + min;
    if (s.turno === 'Noche' && total < 5 * 60) total += 1440;
    let inicio = inicioTurno * 60;
    if (s.turno === 'Noche') inicio = 21 * 60;
    return Math.max(0, Math.min(TURNO_MIN, total - inicio));
  }

  let objetivoTotal = 0, realTotal = 0;
  const rendimientoTomas = [];

  lineasIter.forEach(lc => {
    const o = s.objetivos.porLinea[lc.id];
    if (!o || !o.quemadoObj) return;

    const lecturas = (o.lecturasQuemado || [])
      .filter(x => x.hora && x.real >= 0)
      .map(x => {
        const minutos = minutosDesdeInicio(x.hora);
        const objetivo = o.quemadoObj * (minutos / TURNO_MIN);
        const desvio = x.real - objetivo;
        const cumplimiento = objetivo > 0 ? (x.real / objetivo) * 100 : null;
        return { ...x, minutos, objetivo, desvio, cumplimiento };
      })
      .filter(x => x.minutos !== null)
      .sort((a, b) => a.minutos - b.minutos);

    if (!lecturas.length) return;

    rendimientoTomas.push({ linea: lc.id, lineaNombre: lc.nombre, objetivoTurno: o.quemadoObj, tomas: lecturas });

    const ultima = lecturas[lecturas.length - 1];
    objetivoTotal += ultima.objetivo;
    realTotal += ultima.real;
  });

  // ---------- CALIDAD ----------
  const calidadScope = lineasIter.map(lc => s.objetivos.porLinea[lc.id]).filter(Boolean);
  const calidadReal = calidadScope.length ? calidadScope.reduce((a, o) => a + (Number(o.realCalidad) || 0), 0) / calidadScope.length : 0;
  const calidadParcial = calidadScope.length ? calidadScope.reduce((a, o) => a + (Number(o.calidadParcial) || 0), 0) / calidadScope.length : 0;
  const calidadObjetivo = calidadScope.length ? calidadScope.reduce((a, o) => a + (Number(o.calidad) || 0), 0) / calidadScope.length : 0;
  const calidadDesvio = calidadParcial - calidadReal;

  const horasCalidad = calidadScope.map(o => o.horaCalidadParcial).filter(Boolean);
  const horaCalidad = horasCalidad.length ? horasCalidad[horasCalidad.length - 1] : '--';

  const calidadValorColor = calidadReal >= calidadObjetivo
    ? 'text-emerald-700'
    : (calidadReal >= calidadObjetivo - 5 ? 'text-amber-600' : 'text-rose-700');

  const calidadParcialSube = calidadParcial > calidadReal;
  const calidadParcialBaja = calidadParcial < calidadReal;
  const calidadDireccion = calidadParcialSube
    ? { color: 'text-emerald-600', stroke: '#059669', svg: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>' }
    : calidadParcialBaja
      ? { color: 'text-rose-600', stroke: '#dc2626', svg: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>' }
      : { color: 'text-slate-400', stroke: '#94a3b8', svg: '<path d="M5 12h14"/>' };

  const calidadDesvioClase = calidadDesvio >= 0 ? 'text-emerald-700' : 'text-rose-700';
  const calidadDesvioSigno = calidadDesvio > 0 ? '+' : '';
  const rendimientoPct = objetivoTotal > 0 ? (realTotal / objetivoTotal) * 100 : null;

  // EVALUACIÓN DE SEMÁFORO (VALORES) PARA CADA TARJETA KPI
  const paradaValorColor = m.parada <= 20 ? 'text-emerald-700' : (m.parada <= 60 ? 'text-amber-600' : 'text-rose-700');
  const vacioValorColor = m.vacio <= 10 ? 'text-emerald-700' : (m.vacio <= 30 ? 'text-amber-600' : 'text-rose-700');
  const eficienciaValorColor = m.disponibilidad >= 85 ? 'text-emerald-700' : (m.disponibilidad >= 80 ? 'text-amber-600' : 'text-rose-700');
  const dispEqValorColor = disponibilidadEquipos >= 85 ? 'text-emerald-700' : (disponibilidadEquipos >= 80 ? 'text-amber-600' : 'text-rose-700');
  const rendimientoValorColor = rendimientoPct === null ? 'text-slate-400' : (rendimientoPct >= 85 ? 'text-emerald-700' : (rendimientoPct >= 80 ? 'text-amber-600' : 'text-rose-700'));

  // CÁLCULO DE EGE (Eficiencia Global de los Equipos)
  // Fórmula industrial: Disponibilidad x Rendimiento x Calidad
  const dispFactor = Math.max(0, Math.min(100, m.disponibilidad)) / 100;
  const rendFactor = rendimientoPct !== null ? Math.max(0, Math.min(100, rendimientoPct)) / 100 : 1; // Si no hay rendimiento configurado, se toma como 1 (100%) por defecto para no falsear el cálculo
  const calFactor = Math.max(0, Math.min(100, calidadReal)) / 100;
  const egeTurno = dispFactor * rendFactor * calFactor * 100;
  const egeValorColor = egeTurno >= 85 ? 'text-emerald-700' : (egeTurno >= 75 ? 'text-amber-600' : 'text-rose-700');

  return {
    s, paradasScope, defectosScope, m, lineasIter, filasMaquinas, filasMapaCalor,
    defectosOrdenados, defectoPreponderante, pctParada, pctVacio,
    maquinaCritica, nivelCritica, valorCriticaColor,
    disponibilidadEquipos, dispEqValorColor, equiposConProblema, totalEquiposScope,
    nivelDefecto, valorDefectoColor,
    calidadReal, calidadParcial, calidadObjetivo, calidadDesvio, horaCalidad,
    calidadValorColor, calidadDireccion, calidadDesvioClase, calidadDesvioSigno,
    rendimientoPct, rendimientoValorColor,
    paradaValorColor, vacioValorColor, eficienciaValorColor,
    egeTurno, egeValorColor
  };
}

export function renderVistaPlanta() {
  const l = valor('lineaVista');
  const {
    s, paradasScope, defectosScope, m, lineasIter, filasMaquinas, filasMapaCalor,
    defectosOrdenados, defectoPreponderante, pctParada, pctVacio,
    maquinaCritica, nivelCritica, valorCriticaColor,
    equiposConProblema,
    nivelDefecto, valorDefectoColor,
    calidadReal, calidadParcial, calidadDesvio, horaCalidad,
    calidadValorColor, calidadDireccion, calidadDesvioClase, calidadDesvioSigno,
    rendimientoPct, rendimientoValorColor,
    paradaValorColor, vacioValorColor, eficienciaValorColor,
    egeTurno, egeValorColor
  } = calcularKpisPlanta(l);

  // INYECCIÓN DE HTML DE LAS TARJETAS KPIs
  document.getElementById('vpKpis').innerHTML = `
    <div class="panel p-3 min-h-[110px] border-t-2 border-t-slate-300 bg-white flex justify-between items-start">
      <div>
        <div class="text-[13px] uppercase font-black text-slate-500">Minutos de parada</div>
        <div class="text-2xl font-black ${paradaValorColor} mt-1">${m.parada} <span class="text-sm font-bold text-slate-400">min</span></div>
        <div class="text-[11px] text-slate-400 mt-1">% del turno: ${pctParada}%</div>
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="#e11d48" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="26" height="26"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>
    </div>

    <div class="panel p-3 min-h-[110px] border-t-2 border-t-slate-300 bg-white flex justify-between items-start">
      <div>
        <div class="text-[13px] uppercase font-black text-slate-500">Minutos de vacío (horno)</div>
        <div class="text-2xl font-black ${vacioValorColor} mt-1">${m.vacio} <span class="text-sm font-bold text-slate-400">min</span></div>
        <div class="text-[11px] text-slate-400 mt-1">% del turno: ${pctVacio}%</div>
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="26" height="26"><path d="M12 2c1 3-2 4-2 7a4 4 0 0 0 8 0c0-1-.5-2-1-3 1 1 2 3 2 5a7 7 0 0 1-14 0c0-4 3-5 4-9 0 0 2 1 3 0z"/></svg>
    </div>

    <div class="panel p-3 min-h-[110px] border-t-2 border-t-slate-300 bg-white flex justify-between items-start">
      <div>
        <div class="text-[13px] uppercase font-black text-slate-500">Máquina más crítica</div>
        <div class="text-base font-black ${valorCriticaColor} mt-1">${esc(maquinaCritica?.equipo || 'Sin datos')}</div>
        <div class="text-[16px] font-black ${valorCriticaColor} mt-1">${maquinaCritica?.mins || 0} min · ${nivelCritica.label}</div>
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="26" height="26"><path d="M12 2 2 20h20L12 2z"/><line x1="12" y1="9" x2="12" y2="14"/><circle cx="12" cy="17" r="0.6" fill="#dc2626" stroke="none"/></svg>
    </div>

    <div class="panel p-3 min-h-[110px] border-t-2 border-t-slate-300 bg-white flex justify-between items-start">
      <div>
        <div class="text-[13px] uppercase font-black text-slate-500">Defecto Preponderante</div>
        <div class="text-base font-black ${valorDefectoColor} mt-1">${esc(defectoPreponderante?.nombre || 'Sin defectos')}</div>
        <div class="text-[16px] font-black ${valorDefectoColor} mt-0.5">${defectoPreponderante ? defectoPreponderante.porcentaje + '%' : '0%'}${defectoPreponderante ? ` · ${nivelDefecto.label}` : ''}</div>
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="26" height="26"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    </div>

    <div class="panel p-3 min-h-[110px] border-t-2 border-t-slate-300 bg-white flex justify-between items-start">
      <div>
        <div class="text-[13px] uppercase font-black text-slate-500">Disponibilidad</div>
        <div class="text-2xl font-black ${eficienciaValorColor} mt-2">${m.disponibilidad.toFixed(1)}%</div>
        <div class="text-[11px] text-slate-400 mt-2">Estado de equipos: ${equiposConProblema} con problemas</div>
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="28" height="28"><rect x="3" y="8" width="4" height="8" rx="1"/><rect x="10" y="5" width="4" height="11" rx="1"/><rect x="17" y="10" width="4" height="6" rx="1"/></svg>
    </div>

    <div class="panel p-3 min-h-[110px] border-t-2 border-t-slate-300 bg-white flex justify-between items-start">
      <div>
        <div class="text-[13px] uppercase font-black text-slate-500">Rendimiento</div>
        <div class="text-2xl font-black ${rendimientoValorColor} mt-1">${rendimientoPct === null ? 'N/D' : rendimientoPct.toFixed(1) + '%'}</div>
        <div class="text-[11px] text-slate-400 mt-1">${rendimientoPct === null ? 'Configurar en Indicadores' : 'Objetivo: > 85%'}</div>
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="#4f46e5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="26" height="26"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
    </div>

    <div class="panel p-3 min-h-[110px] border-t-2 border-t-slate-300 bg-white flex justify-between items-start">
      <div>
        <div class="text-[13px] uppercase font-black text-slate-500">Calidad</div>
        <div class="text-2xl font-black ${calidadValorColor} mt-1">${calidadReal.toFixed(1)}%</div>
        <div class="text-[14px] text-slate-500 mt-1 flex items-center gap-1">Parcial: <b class="${calidadDireccion.color}">${calidadParcial.toFixed(1)}%</b><svg viewBox="0 0 24 24" fill="none" stroke="${calidadDireccion.stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">${calidadDireccion.svg}</svg></div>
        <div class="text-[13px] mt-1 ${calidadDesvioClase}">Desvío: <b>${calidadDesvioSigno}${calidadDesvio.toFixed(1)}%</b><span class="text-slate-400"> · ${horaCalidad} hs</span></div>
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="26" height="26"><path d="M20 6 9 17l-5-5"/></svg>
    </div>

    <div class="panel p-3 min-h-[110px] border-t-2 border-t-slate-300 bg-white flex justify-between items-start">
      <div>
        <div class="text-[13px] uppercase font-black text-slate-500">Eficiencia (EGE)</div>
        <div class="text-2xl font-black ${egeValorColor} mt-1">${egeTurno.toFixed(1)}%</div>
        <div class="text-[11px] text-slate-400 mt-1">Disp. × Rend. × Cal.</div>
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="26" height="26"><path d="M4 15a8 8 0 1 1 16 0"/><line x1="12" y1="15" x2="15.5" y2="10.5"/><circle cx="12" cy="15" r="1" fill="#059669" stroke="none"/></svg>
    </div>
  `;

  // Resto de la renderización del mapa de calor, tablas y resúmenes...
  document.getElementById('tablaMapaMaquinas').innerHTML = filasMapaCalor.length ? filasMapaCalor.map((f, i) => {
    const nivelP = nivelPorValor(f.mins, UMBRAL_PARADA);
    const nivelV = nivelPorValor(f.vacio, UMBRAL_VACIO);
    const nivelFinal = nivelP.key >= nivelV.key ? nivelP : nivelV;
    return `
      <tr class="${nivelFinal.rowBg}">
        <td class="text-center font-black text-slate-500">${i + 1}</td>
        <td><b>${esc(f.equipo)}</b></td>
        <td class="text-center"><span class="badge ${nivelP.badge}">${f.mins} min</span></td>
        <td class="text-center"><span class="badge ${nivelV.badge}">${f.vacio} min</span></td>
        <td style="padding-left: 1.5rem">${esc(f.motivo)}</td>
        <td class="text-slate-600 text-xs">${esc(f.observaciones || '—')}</td>
        <td class="text-center"><span class="badge ${nivelFinal.badge}">${nivelFinal.label}</span></td>
      </tr>`;
  }).join('') : '<tr><td colspan="7" class="text-center text-slate-500 p-3 italic">No hay paradas registradas en este turno.</td></tr>';

  document.getElementById('tablaMapaDefectos').innerHTML = defectosOrdenados.length ? defectosOrdenados.map((x, i) => {
    const nivel = nivelPorValor(x.porcentaje, UMBRAL_DEFECTO);
    return `
      <tr class="${nivel.rowBg}">
        <td class="text-center font-black text-slate-500">${i + 1}</td>
        <td><b>${esc(x.nombre)}</b></td>
        <td class="text-center"><span class="badge ${nivel.badge}">${x.porcentaje}%</span></td>
        <td>${esc(x.accion || '—')}</td>
        <td class="text-center"><span class="badge ${nivel.badge}">${nivel.label}</span></td>
      </tr>`;
  }).join('') : '<tr><td colspan="5" class="text-center text-slate-500 p-3 italic">No hay defectos de calidad registrados en este turno.</td></tr>';

  // Top motivos de parada - COMENTADO: tarjeta eliminada del HTML
  // const causasScope = {};
  // paradasScope.forEach(x => { causasScope[x.motivo] = (causasScope[x.motivo] || 0) + x.minutos; });
  // const topMotivos = Object.entries(causasScope).sort((a, b) => b[1] - a[1]).slice(0, 6);
  // const paletaDots = ['bg-rose-600', 'bg-orange-500', 'bg-amber-400', 'bg-lime-400', 'bg-sky-400', 'bg-slate-400'];
  // document.getElementById('topMotivosParada').innerHTML = topMotivos.length ? topMotivos.map((x, i) => `
  //   <div class="flex justify-between items-center text-xs">
  //     <span class="flex items-center gap-2"><span class="w-2 h-2 rounded-full ${paletaDots[i % paletaDots.length]}"></span>${esc(x[0])}</span>
  //     <b class="text-slate-700">${x[1]} min</b>
  //   </div>
  // `).join('') : '<p class="text-slate-500 italic text-xs">Sin datos.</p>';

  const ultimas = [...paradasScope].sort((a, b) => (b.hora || '').localeCompare(a.hora || '')).slice(0, 6);

  document.getElementById('tablaUltimasParadas').innerHTML = ultimas.length ? ultimas.map(x => {
    const horaMostrada = x.hora || (x.creado ? new Date(x.creado).toTimeString().slice(0, 5) : '—');
    return `<tr><td class="text-center font-bold text-sky-700">${horaMostrada}</td><td>${esc(x.equipo)}</td><td class="text-center">${x.minutos} min</td><td>${esc(x.motivo)}</td></tr>`;
  }).join('') : '<tr><td colspan="4" class="text-center text-slate-500 p-2 italic">Sin paradas registradas.</td></tr>';

  asegurarObjetivosSesion(s);
  const objVacioTotal = lineasIter.reduce((a, lc) => a + (s.objetivos.porLinea[lc.id]?.vacioMax || 0), 0);
  const defectoPrincipal = defectosOrdenados[0];

  const frasesAuto = [];
  if (maquinaCritica) {
    // Desglose por motivo de ESTA máquina específica (filasMapaCalor ya
    // viene agrupado por equipo+motivo — ver el fix del mapa de calor).
    const motivosDeLaCritica = filasMapaCalor
      .filter(f => f.equipo === maquinaCritica.equipo && f.lineaNombre === maquinaCritica.lineaNombre)
      .sort((a, b) => b.mins - a.mins);

    if (motivosDeLaCritica.length > 1) {
      const detalle = motivosDeLaCritica.map(f => `${esc(f.motivo)} ${f.mins} min`).join(', ');
      frasesAuto.push(`Turno con afectación destacada en <b>${esc(maquinaCritica.equipo)}</b> por ${detalle}, llevando un acumulado de ${maquinaCritica.mins} min.`);
    } else {
      frasesAuto.push(`Turno con afectación destacada en <b>${esc(maquinaCritica.equipo)}</b> por "${esc(maquinaCritica.motivo)}" (${maquinaCritica.mins} min).`);
    }
  } else {
    frasesAuto.push('Sin paradas relevantes registradas en este turno.');
  }
  if (m.vacio > objVacioTotal) {
    frasesAuto.push(`Generación de vacío en horno por encima del objetivo (${m.vacio} min vs. ${objVacioTotal} min objetivo).`);
  }
  if (defectoPrincipal) {
    frasesAuto.push(`Defecto de calidad más relevante: <b>${esc(defectoPrincipal.nombre)}</b> (${defectoPrincipal.porcentaje}%).`);
  }
  if (m.disponibilidad < 85) {
    frasesAuto.push('Se recomienda seguimiento y generar plan de acción.');
  } else {
    frasesAuto.push('Disponibilidad dentro de objetivo, sin acciones urgentes pendientes.');
  }
  document.getElementById('vpComentarioAuto').innerHTML = frasesAuto.join(' ');

  document.getElementById('vpNotaTurno').value = s.notaTurno || '';
  document.getElementById('vpSupervisorNombre').textContent = s.supervisor || 'No asignado';

  // Renderizar gráficos de calidad
  renderizarGraficosCalidad(l, lineasIter, s);
  
  // Renderizar gráfico de evolución de defectos
  renderizarGraficoEvolucionDefectos(l, defectosScope, s);
}

/**
 * Renderiza los gráficos de evolución de calidad global y parcial.
 * Se llama desde renderVistaPlanta() para mostrar la evolución hora a hora.
 */
function renderizarGraficosCalidad(lineaSeleccionada, lineasIter, s) {
  try {
    // Obtener los datos de calidad de todas las líneas activas
    const lineasConDatos = lineasIter
      .map(lc => ({ 
        linea: lc, 
        objetivos: s.objetivos?.porLinea?.[lc.id] 
      }))
      .filter(x => x.objetivos && Array.isArray(x.objetivos.lecturasCalidad) && x.objetivos.lecturasCalidad.length > 0);

    // Si la línea seleccionada es TODAS, agregar datos de todas las líneas
    // Si no, mostrar solo la línea seleccionada
    let lineasAMostrar = lineasConDatos;
    
    if (lineaSeleccionada !== 'TODAS') {
      lineasAMostrar = lineasConDatos.filter(x => x.linea.id === lineaSeleccionada);
    }

    // Si no hay datos, limpiar los canvas y retornar
    if (lineasAMostrar.length === 0) {
      ['chartCalidadGlobal', 'chartCalidadParcial'].forEach(canvasId => {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        
        const chartKey = canvasId + 'Chart';
        if (window[chartKey]) {
          window[chartKey].destroy();
          window[chartKey] = null;
        }
        
        // Limpiar canvas
        canvas.style.display = 'none';
        setTimeout(() => { canvas.style.display = 'block'; }, 10);
      });
      return;
    }

    // Preparar datos para gráfico global
    renderizarGraficoCalidad(
      'chartCalidadGlobal',
      'global',
      lineasAMostrar,
      s
    );

    // Preparar datos para gráfico parcial
    renderizarGraficoCalidad(
      'chartCalidadParcial',
      'parcial',
      lineasAMostrar,
      s
    );
  } catch (error) {
    console.error('Error al renderizar gráficos de calidad:', error);
  }
}

/**
 * Renderiza un gráfico específico de calidad (global o parcial).
 * Los segmentos cambian de color dinámicamente: verde cuando están sobre el objetivo, rojo cuando están debajo.
 * Se interpolan puntos adicionales donde la línea cruza el objetivo para un cambio de color preciso.
 */
function renderizarGraficoCalidad(canvasId, tipoCalidad, lineasConDatos, s) {
  try {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    // Desactivar globalmente el plugin datalabels si existe
    if (window.Chart && window.Chart.defaults && window.Chart.defaults.set) {
      window.Chart.defaults.set('plugins.datalabels', {
        display: false
      });
    }

    // Destruir gráfico anterior si existe
    const chartKey = canvasId + 'Chart';
    if (window[chartKey]) {
      window[chartKey].destroy();
      window[chartKey] = null;
    }

    // Extraer datos de todas las líneas y calcular el máximo y mínimo valor medido
    const datasets = [];
    let maxValorMedido = 0;
    let minValorMedido = 100;
    let horasOriginales = [];
    let indicesOriginales = []; // Guardar los índices de los puntos originales
    
    lineasConDatos.forEach((item, idx) => {
      const { linea, objetivos } = item;
      const lecturas = objetivos?.lecturasCalidad || [];
      const objetivo = objetivos?.calidad || 0;

      if (!Array.isArray(lecturas) || lecturas.length === 0) return;

      // Extraer horas y valores de calidad originales
      const valoresOriginales = lecturas.map(l => {
        if (tipoCalidad === 'global') {
          return l?.global !== null && l?.global !== undefined ? l.global : null;
        } else {
          return l?.parcial !== null && l?.parcial !== undefined ? l.parcial : null;
        }
      });

      if (idx === 0) {
        horasOriginales = lecturas.map(l => l?.hora || '');
        console.log(`[${tipoCalidad}] Lecturas:`, lecturas);
        console.log(`[${tipoCalidad}] Horas:`, horasOriginales);
        console.log(`[${tipoCalidad}] Valores originales:`, valoresOriginales);
      }

      // Interpolar puntos adicionales donde la línea cruza el objetivo
      const valoresInterpolados = [];
      const horasInterpoladas = [];
      const indicesOriginalesTemp = [];
      
      for (let i = 0; i < valoresOriginales.length; i++) {
        const valorActual = valoresOriginales[i];
        valoresInterpolados.push(valorActual);
        horasInterpoladas.push(horasOriginales[i]);
        indicesOriginalesTemp.push(valoresInterpolados.length - 1); // Marcar este índice como original
        
        // Si hay un siguiente punto, verificar si hay cruce del objetivo
        if (i < valoresOriginales.length - 1) {
          const valorSiguiente = valoresOriginales[i + 1];
          
          if (valorActual !== null && valorSiguiente !== null) {
            // Detectar cruce del objetivo
            const cruzaObjetivo = (valorActual < objetivo && valorSiguiente >= objetivo) || 
                                  (valorActual >= objetivo && valorSiguiente < objetivo);
            
            if (cruzaObjetivo) {
              // Calcular el punto exacto de cruce mediante interpolación lineal
              const t = (objetivo - valorActual) / (valorSiguiente - valorActual);
              
              // Insertar un punto en el cruce (valor = objetivo)
              valoresInterpolados.push(objetivo);
              horasInterpoladas.push(null); // null para el punto interpolado
            }
          }
        }
      }

      if (idx === 0) {
        indicesOriginales = indicesOriginalesTemp;
      }

      // Calcular el máximo y mínimo valor medido
      const valoresValidos = valoresInterpolados.filter(v => v !== null);
      if (valoresValidos.length > 0) {
        const maxLocal = Math.max(...valoresValidos);
        const minLocal = Math.min(...valoresValidos);
        maxValorMedido = Math.max(maxValorMedido, maxLocal);
        minValorMedido = Math.min(minValorMedido, minLocal);
      }

      // Configuración del dataset con colores dinámicos por segmento
      datasets.push({
        label: linea?.nombre || `Línea ${idx + 1}`,
        data: valoresInterpolados,
        borderColor: 'rgb(52, 211, 153)', // Color por defecto (verde)
        backgroundColor: 'rgb(52, 211, 153)',
        borderWidth: 3,
        fill: false,
        tension: 0, // Sin curvatura para que los colores coincidan exactamente
        pointRadius: function(context) {
          // Ocultar puntos interpolados, mostrar solo los originales
          const indice = context.dataIndex;
          return indicesOriginales.includes(indice) ? 5 : 0;
        },
        pointBackgroundColor: function(context) {
          const valor = context.parsed.y;
          if (valor === null || valor === undefined) return 'rgb(203, 213, 225)';
          return valor >= objetivo ? 'rgb(52, 211, 153)' : 'rgb(253, 164, 175)';
        },
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointHoverRadius: function(context) {
          const indice = context.dataIndex;
          return indicesOriginales.includes(indice) ? 7 : 0;
        },
        pointHoverBackgroundColor: function(context) {
          const indice = context.dataIndex;
          if (!indicesOriginales.includes(indice)) return 'transparent';
          const valor = context.parsed.y;
          if (valor === null || valor === undefined) return 'rgb(203, 213, 225)';
          return valor >= objetivos?.calidad ? 'rgb(52, 211, 153)' : 'rgb(253, 164, 175)';
        },
        datalabels: {
          display: false // Desactivar completamente las etiquetas de datos en los puntos
        },
        // Esta es la clave: segment permite colorear cada segmento de línea individualmente
        segment: {
          borderColor: function(context) {
            const valor0 = context.p0.parsed.y;
            const valor1 = context.p1.parsed.y;
            
            if (valor0 === null || valor1 === null) return 'rgb(203, 213, 225)';
            
            // Ahora que tenemos puntos interpolados en los cruces, 
            // cada segmento está completamente de un lado del objetivo
            const promedioSegmento = (valor0 + valor1) / 2;
            return promedioSegmento >= objetivo ? 'rgb(52, 211, 153)' : 'rgb(253, 164, 175)';
          }
        }
      });
    });

    if (datasets.length === 0) return;

    // Generar etiquetas para el eje X (solo mostrar horas originales)
    const primeraLinea = lineasConDatos[0]?.objetivos?.lecturasCalidad || [];
    const etiquetasX = datasets[0].data.map((_, i) => {
      // Solo mostrar etiqueta si es un punto original
      if (indicesOriginales.includes(i)) {
        const indiceOriginal = indicesOriginales.indexOf(i);
        return primeraLinea[indiceOriginal]?.hora || '';
      }
      return ''; // Etiqueta vacía para puntos interpolados
    });

    // Calcular rango dinámico del eje Y con margen del 15% hacia arriba y hacia abajo
    const margenMin = minValorMedido * 0.15;
    const margenMax = maxValorMedido * 0.15;
    
    let yMin = Math.max(0, Math.floor(minValorMedido - margenMin));
    let yMax = Math.min(100, Math.ceil(maxValorMedido + margenMax));
    
    // Si no hay datos válidos, usar rango por defecto
    if (minValorMedido === 100 || maxValorMedido === 0) {
      yMin = 0;
      yMax = 100;
    }

    // Obtener objetivos para la línea de referencia
    const objetivosLineas = lineasConDatos.map(item => item.objetivos?.calidad || 0);

    // Crear gráfico
    window[chartKey] = new Chart(canvas, {
      type: 'line',
      data: {
        labels: etiquetasX,
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          intersect: false,
          mode: 'index'
        },
        plugins: {
          datalabels: {
            display: false // Desactivar etiquetas de datos en todos los puntos
          },
          tooltip: {
            enabled: true,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleColor: '#fff',
            bodyColor: '#fff',
            borderColor: '#475569',
            borderWidth: 1,
            padding: 10,
            displayColors: true,
            filter: function(tooltipItem) {
              // Solo mostrar tooltip en puntos originales (no interpolados)
              return indicesOriginales.includes(tooltipItem.dataIndex);
            },
            callbacks: {
              label: function(context) {
                const valor = context.parsed.y;
                const objetivo = objetivosLineas[context.datasetIndex] || 0;
                const estado = valor >= objetivo ? '✓ Sobre objetivo' : '✗ Bajo objetivo';
                return `${context.dataset.label}: ${valor.toFixed(2)}% ${estado}`;
              }
            }
          },
          legend: {
            display: false // Ocultar la leyenda completamente
          }
        },
        scales: {
          y: {
            min: yMin,
            max: yMax,
            ticks: {
              callback: (value) => value + '%',
              font: { size: 11 }
            },
            grid: {
              color: 'rgba(148, 163, 184, 0.1)'
            }
          },
          x: {
            ticks: {
              font: { size: 11 },
              autoSkip: false, // No saltar etiquetas automáticamente
              maxRotation: 0,
              minRotation: 0
            },
            grid: {
              color: 'rgba(148, 163, 184, 0.1)'
            }
          }
        }
      },
      plugins: [{
        id: 'ocultarValoresInterpolados',
        afterDatasetsDraw(chart) {
          // Este hook se ejecuta después de dibujar los datasets pero antes de otros elementos
          // Aquí podemos interceptar solo los valores sobre los puntos
          const ctx = chart.ctx;
          
          // Guardamos el método original fillText
          const originalFillText = ctx.fillText;
          const meta = chart.getDatasetMeta(0);
          
          // Crear un array con las coordenadas Y de los puntos interpolados
          const coordenadasInterpoladas = [];
          meta.data.forEach((punto, idx) => {
            if (!indicesOriginales.includes(idx)) {
              coordenadasInterpoladas.push({
                x: punto.x,
                y: punto.y,
                rango: 20 // Rango de píxeles alrededor del punto
              });
            }
          });
          
          // Sobrescribir fillText temporalmente
          ctx.fillText = function(text, x, y, maxWidth) {
            // Verificar si el texto es un número y está cerca de un punto interpolado
            const esNumero = /^\d+(\.\d+)?$/.test(String(text).trim());
            const estaCercaDeInterpolado = coordenadasInterpoladas.some(coord => 
              Math.abs(coord.x - x) < coord.rango && Math.abs(coord.y - y) < coord.rango
            );
            
            // Solo dibujar si NO es un número cerca de un punto interpolado
            if (!esNumero || !estaCercaDeInterpolado) {
              originalFillText.call(this, text, x, y, maxWidth);
            }
          };
        },
        afterDraw(chart) {
          // Restaurar el método original después de terminar el dibujo completo
          const ctx = chart.ctx;
          ctx.fillText = ctx.fillText.originalMethod || ctx.fillText;
        }
      }, {
        id: 'lineaObjetivo',
        afterDatasetsDraw(chart) {
          const ctx = chart.ctx;
          const yScale = chart.scales.y;
          const xScale = chart.scales.x;
          
          if (!yScale || !xScale) return;

          // Dibujar líneas de objetivo para cada línea de datos
          objetivosLineas.forEach((objetivo, idx) => {
            const yPixel = yScale.getPixelForValue(objetivo);
            const xStart = xScale.left;
            const xEnd = xScale.right;

            ctx.save();
            ctx.strokeStyle = 'rgb(165, 230, 255)'; // Celeste pastel
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            ctx.moveTo(xStart, yPixel);
            ctx.lineTo(xEnd, yPixel);
            ctx.stroke();
            ctx.restore();

            // Etiqueta del objetivo
            ctx.fillStyle = 'rgb(100, 116, 139)';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(`Objetivo: ${objetivo}%`, xEnd - 5, yPixel - 5);
          });
        }
      }]
    });
  } catch (error) {
    console.error(`Error al renderizar gráfico ${canvasId}:`, error);
  }
}

/**
 * Renderiza el gráfico de evolución de los 4 principales defectos hora a hora.
 */
function renderizarGraficoEvolucionDefectos(lineaSeleccionada, defectos, s) {
  try {
    console.log('=== Renderizando gráfico de defectos ===');
    console.log('Línea seleccionada:', lineaSeleccionada);
    console.log('Defectos recibidos:', defectos);
    console.log('Cantidad de defectos:', defectos?.length);
    
    const canvas = document.getElementById('chartEvolucionDefectos');
    console.log('Canvas encontrado:', canvas);
    if (!canvas) return;

    // Destruir gráfico anterior si existe
    if (window.chartEvolucionDefectosChart) {
      window.chartEvolucionDefectosChart.destroy();
      window.chartEvolucionDefectosChart = null;
    }

    // Obtener los 4 principales defectos
    const top4Defectos = defectos
      .sort((a, b) => b.porcentaje - a.porcentaje)
      .slice(0, 4);

    console.log('Top 4 defectos:', top4Defectos);

    if (top4Defectos.length === 0) {
      console.log('No hay defectos para mostrar');
      return;
    }

    // Obtener las lecturas de defectos históricas
    // Si es TODAS, usar la primera línea activa que tenga datos
    let lecturasDefectos = [];
    let lineaUsada = null;
    
    if (lineaSeleccionada === 'TODAS') {
      // Buscar en todas las líneas hasta encontrar una con lecturas
      const lineas = s.lineas || [];
      for (const linea of lineas) {
        const lecturasLinea = s.objetivos?.porLinea?.[linea.id]?.lecturasDefectos || [];
        if (lecturasLinea.length > 0) {
          lecturasDefectos = lecturasLinea;
          lineaUsada = linea.id;
          console.log('Usando lecturas de defectos de línea:', linea.nombre);
          break;
        }
      }
    } else {
      lecturasDefectos = s.objetivos?.porLinea?.[lineaSeleccionada]?.lecturasDefectos || [];
      lineaUsada = lineaSeleccionada;
    }
    
    console.log('Lecturas de defectos encontradas:', lecturasDefectos);
    console.log('Cantidad de snapshots:', lecturasDefectos.length);

    if (lecturasDefectos.length === 0) {
      console.log('No hay lecturas de defectos históricas disponibles');
      
      // Mostrar mensaje informativo en el canvas
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = '14px sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.textAlign = 'center';
      ctx.fillText('Sin datos históricos de defectos', canvas.width / 2, canvas.height / 2 - 10);
      ctx.font = '12px sans-serif';
      ctx.fillText('Usa "Indicadores y objetivos" para cargar snapshots', canvas.width / 2, canvas.height / 2 + 10);
      return;
    }

    // Extraer las horas de los snapshots
    const horas = lecturasDefectos.map(l => l.hora);

    // Colores pasteles para cada defecto: Azul, Verde, Naranja, Rojo
    const colores = [
      { border: 'rgb(96, 165, 250)', bg: 'rgba(96, 165, 250, 0.15)' },    // Azul pastel
      { border: 'rgb(74, 222, 128)', bg: 'rgba(74, 222, 128, 0.15)' },    // Verde pastel
      { border: 'rgb(251, 146, 60)', bg: 'rgba(251, 146, 60, 0.15)' },    // Naranja pastel
      { border: 'rgb(248, 113, 113)', bg: 'rgba(248, 113, 113, 0.15)' }   // Rojo pastel
    ];

    // Crear datasets para cada uno de los top 4 defectos
    const datasets = top4Defectos.map((defecto, idx) => {
      // Buscar el historial de este defecto en cada snapshot
      const datos = lecturasDefectos.map(snapshot => {
        const defectoEnSnapshot = snapshot.defectos.find(d => d.nombre === defecto.nombre);
        return defectoEnSnapshot ? defectoEnSnapshot.porcentaje : null;
      });

      return {
        label: defecto.nombre,
        data: datos,
        borderColor: colores[idx].border,
        backgroundColor: colores[idx].bg,
        borderWidth: 2,
        fill: false,
        tension: 0, // Líneas rectas sin curvas
        pointRadius: 6, // Puntos más grandes
        pointBackgroundColor: colores[idx].border,
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointHoverRadius: 8, // Hover más grande también
        spanGaps: true // Conectar puntos aunque haya nulls en medio
      };
    });

    // Obtener el objetivo de defectos
    const objetivoDefectos = s.objetivos?.porLinea?.[lineaUsada]?.defectosMax || 8;
    console.log('Objetivo de defectos:', objetivoDefectos);

    // Crear gráfico
    window.chartEvolucionDefectosChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: horas,
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          intersect: false,
          mode: 'index'
        },
        plugins: {
          datalabels: {
            display: false
          },
          tooltip: {
            enabled: true,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleColor: '#fff',
            bodyColor: '#fff',
            borderColor: '#475569',
            borderWidth: 1,
            padding: 10,
            displayColors: true,
            callbacks: {
              label: function(context) {
                return `${context.dataset.label}: ${context.parsed.y.toFixed(2)}%`;
              }
            }
          },
          legend: {
            display: true,
            position: 'bottom',
            labels: {
              font: { size: 10 },
              padding: 8,
              usePointStyle: true
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: (value) => value + '%',
              font: { size: 11 }
            },
            grid: {
              color: 'rgba(148, 163, 184, 0.1)'
            }
          },
          x: {
            ticks: {
              font: { size: 11 },
              maxRotation: 0,
              minRotation: 0
            },
            grid: {
              color: 'rgba(148, 163, 184, 0.1)'
            }
          }
        }
      },
      plugins: [{
        id: 'lineaObjetivoDefectos',
        afterDatasetsDraw(chart) {
          const ctx = chart.ctx;
          const yScale = chart.scales.y;
          const xScale = chart.scales.x;
          
          if (!yScale || !xScale) return;

          // Dibujar línea de objetivo
          const yPixel = yScale.getPixelForValue(objetivoDefectos);
          const xStart = xScale.left;
          const xEnd = xScale.right;

          ctx.save();
          ctx.strokeStyle = 'rgb(148, 163, 184)'; // Gris
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(xStart, yPixel);
          ctx.lineTo(xEnd, yPixel);
          ctx.stroke();
          ctx.restore();

          // Etiqueta del objetivo
          ctx.fillStyle = 'rgb(100, 116, 139)'; // Gris oscuro
          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'right';
          ctx.fillText(`Objetivo: ${objetivoDefectos}%`, xEnd - 5, yPixel - 5);
        }
      }]
    });
  } catch (error) {
    console.error('Error al renderizar gráfico de evolución de defectos:', error);
  }
}

// ==========================================================
// EXPOSICIÓN A window
// ----------------------------------------------------------
// cambiarAreaMonitoreada: llamada desde onchange="..." en index.html.
// ==========================================================
window.cambiarAreaMonitoreada = cambiarAreaMonitoreada;