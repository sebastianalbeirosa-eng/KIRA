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
import { db } from '../nucleo/almacenamiento.js';
import {
  sesion, lineasActivas, lineaPorId, nombreLinea,
  asegurarObjetivosSesion, asegurarProduccionSesion, TURNO_MIN,
  eventosProduccionDia
} from '../nucleo/estado.js';

import { asegurarNotaTurno } from './notasTurno.js';
import { asegurarDefectosSesion, renderDefectos } from './gestionDefectos.js';
import { renderAnalisis } from './graficosYAnalisis.js';
import { todasParadas, todasDefectos } from './historicos.js';
import { minutosDesdeInicioTurno, objetivoAcumuladoHasta } from '../nucleo/horno.js';

/**
 * Convierte la lista de eventos de producción de una línea en tramos aptos
 * para los cálculos de horno. Debe coincidir con la del form de indicadores.
 */
function tramosDeEventosObjetivo(eventos) {
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

// Variable de estado del módulo: define si el Análisis muestra el turno
// actual o los últimos 7 días. Se lee desde graficosYAnalisis.js también.
export let analisisModo = 'turno';

// Período de la Vista de Planta: 'turno' (solo el turno actual, como siempre)
// o 'dia' (acumulado de los 3 turnos de la fecha, jornada 05:00→05:00).
export let modoVistaPlanta = 'turno';

/** Cambia el período de la Vista de Planta y refresca la pantalla. */
export function cambiarPeriodoVista(modo) {
  modoVistaPlanta = (modo === 'dia') ? 'dia' : 'turno';
  if (!document.getElementById('vistaPlanta').classList.contains('hidden')) renderVistaPlanta();
}

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
export const UMBRAL_PARADA = { critico: 40, alto: 30, medio: 20 };
export const UMBRAL_VACIO = { critico: 40, alto: 30, medio: 20 };
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
export function metricas(regs = datosVista(), minutosPeriodo = TURNO_MIN) {
  const parada = regs.reduce((a, x) => a + x.minutos, 0);
  const vacio = regs.reduce((a, x) => a + x.vacio, 0);
  const eventos = regs.reduce((a, x) => a + x.eventos, 0);
  const disponibilidad = Math.max(0, 100 - (parada / minutosPeriodo * 100));
  const i = sesion().indicadores;
  return { parada, vacio, eventos, disponibilidad, productivos: Math.max(0, minutosPeriodo - parada), calidad: i.calidad, productividad: i.productividad };
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
/**
 * Promedia el porcentaje de defectos que se repiten en varios turnos,
 * agrupando por (nombre + línea). Devuelve un defecto por grupo con el
 * porcentaje promedio (redondeado a 2 decimales) y conservando la acción.
 */
function promediarDefectosPorNombre(defectos) {
  const grupos = {};
  defectos.forEach(d => {
    const clave = `${d.linea}||${d.nombre}`;
    if (!grupos[clave]) grupos[clave] = { ...d, _suma: 0, _cant: 0 };
    grupos[clave]._suma += Number(d.porcentaje) || 0;
    grupos[clave]._cant += 1;
    if (d.accion && !grupos[clave].accion) grupos[clave].accion = d.accion;
  });
  return Object.values(grupos).map(g => {
    const { _suma, _cant, ...resto } = g;
    return { ...resto, porcentaje: +(_suma / _cant).toFixed(2) };
  });
}

/**
 * Devuelve las sesiones (turnos) de una fecha administrativa como
 * [{turno, sesion}], en orden Mañana→Tarde→Noche. Usado por el modo "Día".
 */
function sesionesDelDia(fecha) {
  const orden = { 'Mañana': 0, 'Tarde': 1, 'Noche': 2 };
  return Object.entries(db.sesiones || {})
    .filter(([key]) => key.startsWith(fecha + '|'))
    .map(([key, ses]) => ({ turno: key.split('|')[1], sesion: ses }))
    .sort((a, b) => (orden[a.turno] ?? 9) - (orden[b.turno] ?? 9));
}

export function calcularKpisPlanta(l) {
  const s = sesion();
  asegurarNotaTurno(s);
  asegurarDefectosSesion(s);

  // MODO DÍA: acumular las 3 sesiones (turnos) de la fecha actual. MODO TURNO:
  // trabajar solo con la sesión del turno actual (comportamiento de siempre).
  const esModoDia = modoVistaPlanta === 'dia';
  const fechaActual = valor('fecha');
  const sesionesDia = esModoDia ? sesionesDelDia(fechaActual) : [{ turno: s.turno, sesion: s }];

  // Paradas y defectos: en modo día se concatenan los de los 3 turnos.
  const paradasFuente = esModoDia
    ? sesionesDia.flatMap(({ sesion: ses }) => ses.paradas || [])
    : s.paradas;
  const defectosFuente = esModoDia
    ? sesionesDia.flatMap(({ sesion: ses }) => ses.defectos || [])
    : s.defectos;

  const paradasScope = paradasFuente.filter(x => l === 'TODAS' || x.linea === l);
  const defectosScopeRaw = defectosFuente.filter(x => l === 'TODAS' || x.linea === l);

  // En modo día, un mismo defecto puede venir de varios turnos: se promedia
  // su porcentaje por (nombre + línea) para no duplicar filas en el mapa.
  const defectosScope = esModoDia
    ? promediarDefectosPorNombre(defectosScopeRaw)
    : defectosScopeRaw;

  // Métricas: en modo día el turno de referencia es 24 h (3 × TURNO_MIN).
  const minutosPeriodo = esModoDia ? TURNO_MIN * 3 : TURNO_MIN;
  const m = metricas(paradasScope, minutosPeriodo);
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

  const pctParada = (m.parada / minutosPeriodo * 100).toFixed(1);
  const pctVacio = (m.vacio / minutosPeriodo * 100).toFixed(1);

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

  // ---------- RENDIMIENTO (mismo cálculo que el form de Indicadores) ----------
  // Rendimiento = m² reales acumulados hasta la última toma / objetivo teórico
  // acumulado hasta esa misma hora, usando los eventos de producción (producto
  // inicial + cambios de producto/ciclo) que definen la velocidad dinámica.
  // En modo día se suman los m² reales y el objetivo acumulado de CADA turno
  // (cada uno con su propio horario de inicio), y recién al final se divide.
  // No se pueden promediar porcentajes de turnos distintos.
  let objetivoTotal = 0, realTotal = 0;
  const rendimientoTomas = [];

  lineasIter.forEach(lc => {
    const tramos = tramosDeEventosObjetivo(eventosProduccionDia(lc.id));
    if (!tramos.length) return;

    sesionesDia.forEach(({ turno: turnoSes, sesion: ses }) => {
      const o = ses.objetivos?.porLinea?.[lc.id];
      if (!o) return;

      // Última toma con m² reales cargados en ESE turno.
      const tomasValidas = (o.lecturasQuemado || [])
        .filter(x => x.hora && x.real > 0)
        .map(x => ({ ...x, minutos: minutosDesdeInicioTurno(x.hora, turnoSes) }))
        .filter(x => x.minutos !== null && x.minutos > 0)
        .sort((a, b) => a.minutos - b.minutos);

      if (!tomasValidas.length) return;

      const ultima = tomasValidas[tomasValidas.length - 1];
      const objetivoAcum = objetivoAcumuladoHasta(tramos, turnoSes, ultima.minutos);
      if (!(objetivoAcum > 0)) return;

      rendimientoTomas.push({ linea: lc.id, lineaNombre: lc.nombre, turno: turnoSes, tomas: tomasValidas });

      objetivoTotal += objetivoAcum;
      realTotal += ultima.real;
    });
  });

  // ---------- CALIDAD ----------
  // Modo turno: objetivos de la sesión actual por línea.
  // Modo día: objetivos de cada línea en cada turno con dato de calidad, para
  // promediar la calidad global del día (promedio de los turnos con datos).
  const calidadScope = esModoDia
    ? sesionesDia.flatMap(({ sesion: ses }) =>
        lineasIter.map(lc => ses.objetivos?.porLinea?.[lc.id]).filter(Boolean))
    : lineasIter.map(lc => s.objetivos.porLinea[lc.id]).filter(Boolean);

  // Para el promedio de calidad global/parcial del día solo cuentan los
  // objetivos que efectivamente tienen una lectura de calidad cargada.
  const calidadConDato = calidadScope.filter(o => Number(o.realCalidad) > 0);
  const baseCal = calidadConDato.length ? calidadConDato : calidadScope;

  const calidadReal = baseCal.length ? baseCal.reduce((a, o) => a + (Number(o.realCalidad) || 0), 0) / baseCal.length : 0;
  const calidadParcial = baseCal.length ? baseCal.reduce((a, o) => a + (Number(o.calidadParcial) || 0), 0) / baseCal.length : 0;
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

  // --- METROS vs OBJETIVO: cuántos m² faltan o sobran respecto del objetivo
  // teórico acumulado a la hora de la última toma. Positivo = sobran, negativo
  // = faltan. Se muestra con flecha y color en la tarjeta KPI (igual que calidad).
  const m2Objetivo = Math.round(objetivoTotal);
  const m2Real = Math.round(realTotal);
  const m2Desvio = m2Real - m2Objetivo;   // + sobran, - faltan
  const hayRend = rendimientoPct !== null;
  const rendDesvioClase = m2Desvio >= 0 ? 'text-emerald-700' : 'text-rose-700';
  const rendDireccion = m2Desvio > 0
    ? { color: 'text-emerald-600', stroke: '#059669', svg: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>' }
    : m2Desvio < 0
      ? { color: 'text-rose-600', stroke: '#dc2626', svg: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>' }
      : { color: 'text-slate-400', stroke: '#94a3b8', svg: '<path d="M5 12h14"/>' };

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
    m2Objetivo, m2Real, m2Desvio, hayRend, rendDesvioClase, rendDireccion,
    paradaValorColor, vacioValorColor, eficienciaValorColor,
    egeTurno, egeValorColor,
    esModoDia, minutosPeriodo, sesionesDia
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
    m2Objetivo, m2Real, m2Desvio, hayRend, rendDesvioClase, rendDireccion,
    paradaValorColor, vacioValorColor, eficienciaValorColor,
    egeTurno, egeValorColor,
    esModoDia, sesionesDia
  } = calcularKpisPlanta(l);

  // Ajuste de LAYOUT según el período: en modo "Día" ocultamos el gráfico de
  // calidad parcial (que solo tiene sentido hora a hora por turno) y dejamos
  // el gráfico de calidad global ocupando todo el ancho. En modo turno vuelve
  // el layout de dos columnas con ambos gráficos.
  const gridCalidad = document.getElementById('gridCalidad');
  const panelParcial = document.getElementById('panelCalidadParcial');
  const tituloGlobal = document.getElementById('tituloCalidadGlobal');
  if (gridCalidad && panelParcial) {
    if (esModoDia) {
      gridCalidad.classList.remove('xl:grid-cols-2');
      gridCalidad.classList.add('xl:grid-cols-1');
      panelParcial.classList.add('hidden');
      if (tituloGlobal) tituloGlobal.textContent = 'Evolución del día (24 h) — Calidad Global';
    } else {
      gridCalidad.classList.add('xl:grid-cols-2');
      gridCalidad.classList.remove('xl:grid-cols-1');
      panelParcial.classList.remove('hidden');
      if (tituloGlobal) tituloGlobal.textContent = 'Evolución hora a hora — Calidad Global';
    }
  }

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
        ${hayRend ? `
        <div class="text-[12px] text-slate-500 mt-1 leading-snug">Objetivo: <b class="text-slate-700">${m2Objetivo.toLocaleString('es-AR')} m²</b></div>
        <div class="text-[12px] text-slate-500 leading-snug">Real: <b class="text-slate-700">${m2Real.toLocaleString('es-AR')} m²</b></div>
        <div class="text-[12px] ${rendDesvioClase} font-bold flex items-center gap-1 leading-snug">
          ${m2Desvio > 0 ? 'Sobra:' : m2Desvio < 0 ? 'Falta:' : 'Dif.:'}
          <svg viewBox="0 0 24 24" fill="none" stroke="${rendDireccion.stroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="13" height="13">${rendDireccion.svg}</svg>
          ${Math.abs(m2Desvio).toLocaleString('es-AR')} m²
        </div>` : `
        <div class="text-[11px] text-slate-400 mt-1 leading-tight">Cargá tomas de m² en Indicadores</div>`}
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
        <td class="text-center text-slate-600">${esc(f.lineaNombre || '—')}</td>
        <td><b>${esc(f.equipo)}</b></td>
        <td class="text-center"><span class="badge ${nivelP.badge}">${f.mins} min</span></td>
        <td class="text-center"><span class="badge ${nivelV.badge}">${f.vacio} min</span></td>
        <td style="padding-left: 1.5rem">${esc(f.motivo)}</td>
        <td class="text-slate-600 text-xs">${esc(f.observaciones || '—')}</td>
        <td class="text-center"><span class="badge ${nivelFinal.badge}">${nivelFinal.label}</span></td>
      </tr>`;
  }).join('') : '<tr><td colspan="8" class="text-center text-slate-500 p-3 italic">No hay paradas registradas en este turno.</td></tr>';

  document.getElementById('tablaMapaDefectos').innerHTML = defectosOrdenados.length ? defectosOrdenados.map((x, i) => {
    const nivel = nivelPorValor(x.porcentaje, UMBRAL_DEFECTO);
    return `
      <tr class="${nivel.rowBg}">
        <td class="text-center font-black text-slate-500">${i + 1}</td>
        <td class="text-center text-slate-600">${esc(nombreLinea(x.linea))}</td>
        <td><b>${esc(x.nombre)}</b></td>
        <td class="text-center"><span class="badge ${nivel.badge}">${x.porcentaje}%</span></td>
        <td>${esc(x.accion || '—')}</td>
        <td class="text-center"><span class="badge ${nivel.badge}">${nivel.label}</span></td>
      </tr>`;
  }).join('') : '<tr><td colspan="6" class="text-center text-slate-500 p-3 italic">No hay defectos de calidad registrados en este turno.</td></tr>';

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

  // Renderizar gráficos de calidad (modo turno u día de 24 h)
  renderizarGraficosCalidad(l, lineasIter, s, { esModoDia, sesionesDia });
  
  // Renderizar gráfico de evolución de defectos
  renderizarGraficoEvolucionDefectos(l, defectosScope, s);
}

/**
 * Renderiza los gráficos de evolución de calidad global y parcial.
 * Se llama desde renderVistaPlanta() para mostrar la evolución hora a hora.
 */
function renderizarGraficosCalidad(lineaSeleccionada, lineasIter, s, opciones = {}) {
  try {
    const { esModoDia = false, sesionesDia = [] } = opciones;

    // Construye el objeto "objetivos" que alimenta el gráfico para una línea.
    // - Modo turno: usa las lecturas de calidad de la sesión actual.
    // - Modo día: concatena las lecturas de los 3 turnos en una sola serie de
    //   24 h, ordenadas por la jornada administrativa (05:00 → 05:00), para
    //   ver la evolución continua del día.
    const objetivosParaLinea = (lc) => {
      if (!esModoDia) return s.objetivos?.porLinea?.[lc.id];

      const objBase = s.objetivos?.porLinea?.[lc.id] || {};
      // Ordenar por turno (Mañana→Tarde→Noche) y, dentro de cada turno, por
      // los minutos transcurridos desde su inicio.
      const ordTurno = { 'Mañana': 0, 'Tarde': 1, 'Noche': 2 };
      const conTurno = [];
      sesionesDia.forEach(({ turno: turnoSes, sesion: ses }) => {
        const o = ses.objetivos?.porLinea?.[lc.id];
        (o?.lecturasCalidad || []).forEach(lec => {
          if (!lec || !lec.hora) return;
          if (lec.global === null && lec.parcial === null) return;
          conTurno.push({ hora: lec.hora, global: lec.global, parcial: lec.parcial, _t: ordTurno[turnoSes] ?? 9, _m: minutosDesdeInicioTurno(lec.hora, turnoSes) ?? 0 });
        });
      });
      conTurno.sort((a, b) => (a._t - b._t) || (a._m - b._m));

      return { ...objBase, lecturasCalidad: conTurno };
    };

    const lineasConDatos = lineasIter
      .map(lc => ({ linea: lc, objetivos: objetivosParaLinea(lc) }))
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

    // Gráfico de calidad global (en modo día es la evolución de 24 h).
    renderizarGraficoCalidad('chartCalidadGlobal', 'global', lineasAMostrar, s);

    // El gráfico de calidad parcial solo se dibuja en modo turno (en modo día
    // el panel está oculto y el global ocupa todo el ancho).
    if (!esModoDia) {
      renderizarGraficoCalidad('chartCalidadParcial', 'parcial', lineasAMostrar, s);
    }
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
      const lecturas = (objetivos?.lecturasCalidad || []).filter(lectura => {
        const valorLectura = tipoCalidad === 'global' ? lectura?.global : lectura?.parcial;
        return lectura?.hora && valorLectura !== null && valorLectura !== undefined;
      });
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

      if (datasets.length === 0) {
        horasOriginales = lecturas.map(l => l?.hora || '');
        console.log(`[${tipoCalidad}] Lecturas:`, lecturas);
        console.log(`[${tipoCalidad}] Horas:`, horasOriginales);
        console.log(`[${tipoCalidad}] Valores originales:`, valoresOriginales);
      }

      // Interpolar puntos adicionales EXACTAMENTE donde la línea cruza el
      // objetivo. Así cada segmento queda completamente de un lado del
      // objetivo y su color (verde sobre / rojo bajo) es preciso, sin
      // "tapar" los puntos originales medidos.
      // Construir puntos {x, y}. A cada punto ORIGINAL se le asigna un índice
      // X entero secuencial (0, 1, 2, ...), de modo que las horas queden
      // SIEMPRE equiespaciadas en el eje, sin importar cuántos cruces haya.
      // Los puntos interpolados de cruce reciben un X fraccional entre los
      // dos originales que los rodean, para caer en su posición correcta.
      const puntos = [];             // [{x, y}]
      const indicesOriginalesTemp = []; // posiciones (en 'puntos') que son originales

      for (let i = 0; i < valoresOriginales.length; i++) {
        const valorActual = valoresOriginales[i];

        if (i > 0) {
          const valorPrevio = valoresOriginales[i - 1];
          if (valorPrevio !== null && valorActual !== null) {
            const cruzaHaciaAbajo = valorPrevio > objetivo && valorActual < objetivo;
            const cruzaHaciaArriba = valorPrevio < objetivo && valorActual > objetivo;
            if (cruzaHaciaAbajo || cruzaHaciaArriba) {
              // Fracción del tramo (0..1) donde el valor iguala al objetivo.
              const t = (objetivo - valorPrevio) / (valorActual - valorPrevio);
              if (t > 0 && t < 1) {
                // X del cruce: entre el índice del punto previo (i-1) y el actual (i).
                puntos.push({ x: (i - 1) + t, y: objetivo });
              }
            }
          }
        }

        puntos.push({ x: i, y: valorActual });
        indicesOriginalesTemp.push(puntos.length - 1);
      }

      if (idx === 0) {
        indicesOriginales = indicesOriginalesTemp;
      }

      // Calcular el máximo y mínimo valor medido
      const valoresValidos = puntos.map(p => p.y).filter(v => v !== null);
      if (valoresValidos.length > 0) {
        maxValorMedido = Math.max(maxValorMedido, ...valoresValidos);
        minValorMedido = Math.min(minValorMedido, ...valoresValidos);
      }

      // Configuración del dataset con colores dinámicos por segmento
      datasets.push({
        label: linea?.nombre || `Línea ${idx + 1}`,
        data: puntos,
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

    // Con eje X lineal, cada hora original vive en un índice entero (0,1,2,...).
    // Este mapa índice→hora se usa para los ticks del eje.
    const horaPorIndice = {};
    horasOriginales.forEach((h, i) => { horaPorIndice[i] = h || ''; });
    const totalOriginales = horasOriginales.length;

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

    // ----------------------------------------------------------
    // QUIEBRES DE PRODUCTO / FORMATO / CICLO
    // ----------------------------------------------------------
    // Cada quiebre tiene una hora. Los mapeamos a una posición X (índice
    // fraccional dentro del eje de horas de las lecturas de calidad) para
    // poder dibujar una línea vertical exactamente donde ocurre el cambio.
    const turnoActual = s?.turno || 'Mañana';

    // Minutos de turno de cada hora original (para interpolar la X del quiebre).
    const minutosPorIndiceOriginal = horasOriginales.map(h => minutosDesdeInicioTurno(h, turnoActual));

    /** Convierte un minuto de turno a una posición X (índice lineal 0..n-1). */
    const minutoAPosicionX = (minutoTurno) => {
      if (minutoTurno === null || minutoTurno === undefined) return null;
      // Buscar entre qué dos horas originales cae el quiebre.
      for (let k = 0; k < minutosPorIndiceOriginal.length - 1; k++) {
        const mA = minutosPorIndiceOriginal[k];
        const mB = minutosPorIndiceOriginal[k + 1];
        if (mA === null || mB === null) continue;
        if (minutoTurno >= mA && minutoTurno <= mB && mB > mA) {
          const frac = (minutoTurno - mA) / (mB - mA);
          return k + frac; // índice fraccional entre k y k+1
        }
      }
      // Fuera de rango: pegar al primer o último punto.
      const primero = minutosPorIndiceOriginal[0];
      const ultimo = minutosPorIndiceOriginal[minutosPorIndiceOriginal.length - 1];
      if (primero !== null && minutoTurno <= primero) return 0;
      if (ultimo !== null && minutoTurno >= ultimo) return minutosPorIndiceOriginal.length - 1;
      return null;
    };

    // Reunir quiebres de todas las líneas mostradas, con su posición X.
    // Se diferencian dos tipos:
    //   - 'producto': cambio de producto (etiqueta = nombre del producto).
    //   - 'ciclo'   : cambio de velocidad del horno (etiqueta = "Ciclo Nmin").
    const quiebresGrafico = [];
    lineasConDatos.forEach(item => {
      const quiebres = item.objetivos?.quiebresProducto || [];
      quiebres.forEach(q => {
        const minuto = (q.minutoTurno !== undefined && q.minutoTurno !== null)
          ? q.minutoTurno
          : minutosDesdeInicioTurno(q.hora, turnoActual);
        const posX = minutoAPosicionX(minuto);
        if (posX === null) return;
        const tipo = q.tipo === 'ciclo' ? 'ciclo' : 'producto';
        const etiqueta = tipo === 'ciclo'
          ? `Ciclo ${q.cicloNuevo || ''}min`
          : (q.productoNuevo || 'Cambio');
        quiebresGrafico.push({ posX, hora: q.hora || '', etiqueta, tipo });
      });
    });

    // Crear gráfico
    window[chartKey] = new Chart(canvas, {
      type: 'line',
      data: {
        // Con eje X lineal los datos son {x, y}; no se usan labels.
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          intersect: false,
          mode: 'nearest',
          axis: 'x'
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
            // Eje lineal: las horas originales viven en índices enteros
            // equiespaciados (0,1,2,...). Se agrega un margen de 0,4 índices
            // a cada lado para que el primer y el último punto no queden
            // pegados a las paredes del gráfico.
            type: 'linear',
            // Separación mínima de la primera toma respecto del eje Y.
            // Bajá este número hacia 0 para pegarla más; subilo (ej. -0.15)
            // para separarla un poco más.
            min: -0.02,
            max: (totalOriginales - 1) + 0.4,
            // Forzar un tick EXACTO en cada índice de toma (0,1,2,...), sin
            // importar el 'min'. Así la hora de la primera toma nunca se pierde.
            afterBuildTicks: (axis) => {
              axis.ticks = [];
              for (let i = 0; i < totalOriginales; i++) {
                axis.ticks.push({ value: i });
              }
            },
            ticks: {
              font: { size: 11 },
              autoSkip: false,
              maxRotation: 0,
              minRotation: 0,
              // Mostrar la hora de la toma que corresponde a cada índice.
              callback: (value) => horaPorIndice[Math.round(value)] || ''
            },
            grid: {
              color: 'rgba(148, 163, 184, 0.1)'
            }
          }
        }
      },
      plugins: [{
        // Dibuja el valor de calidad (%) SOLO sobre los puntos originales
        // (las tomas). Los puntos interpolados de cruce no llevan etiqueta.
        id: 'etiquetasCalidad',
        afterDatasetsDraw(chart) {
          const ctx = chart.ctx;
          chart.data.datasets.forEach((dataset, dsIdx) => {
            const meta = chart.getDatasetMeta(dsIdx);
            if (meta.hidden) return;
            meta.data.forEach((punto, idx) => {
              // Solo puntos originales (no interpolados).
              if (!indicesOriginales.includes(idx)) return;
              const valor = dataset.data[idx]?.y;
              if (valor === null || valor === undefined || isNaN(valor)) return;

              ctx.save();
              ctx.font = 'bold 10px Segoe UI, Arial, sans-serif';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'bottom';
              // Contorno blanco para que el número se lea sobre la línea.
              ctx.lineWidth = 3;
              ctx.strokeStyle = 'rgba(255,255,255,0.9)';
              ctx.fillStyle = '#1e293b';
              const texto = `${Number(valor).toFixed(1)}%`;
              ctx.strokeText(texto, punto.x, punto.y - 8);
              ctx.fillText(texto, punto.x, punto.y - 8);
              ctx.restore();
            });
          });
        }
      }, {
        id: 'lineaObjetivo',
        afterDatasetsDraw(chart) {
          const ctx = chart.ctx;
          const yScale = chart.scales.y;
          const xScale = chart.scales.x;
          
          if (!yScale || !xScale) return;

          // Dibujar UNA línea punteada por cada valor de objetivo DISTINTO.
          // (Deduplicado para no repetir la etiqueta cuando varias líneas
          // comparten el mismo objetivo.)
          const objetivosUnicos = [...new Set(objetivosLineas.filter(o => o > 0))];

          objetivosUnicos.forEach((objetivo) => {
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

            // Etiqueta "Objetivo: X%" en el extremo derecho de la línea.
            ctx.save();
            ctx.fillStyle = 'rgb(100, 116, 139)';
            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'bottom';
            ctx.fillText(`Objetivo: ${objetivo}%`, xEnd - 5, yPixel - 5);
            ctx.restore();
          });
        }
      }, {
        // Marcas verticales de "quiebre": cada cambio de producto/formato/ciclo
        // durante el turno. KIRA distingue así que cada producto cerámico es
        // distinto y no debe compararse como una curva continua.
        id: 'quiebresProducto',
        afterDatasetsDraw(chart) {
          if (!quiebresGrafico.length) return;
          const ctx = chart.ctx;
          const xScale = chart.scales.x;
          const yScale = chart.scales.y;
          if (!xScale || !yScale) return;

          quiebresGrafico.forEach(q => {
            const xPixel = xScale.getPixelForValue(q.posX);
            if (xPixel === null || isNaN(xPixel)) return;
            const yTop = yScale.top;
            const yBottom = yScale.bottom;

            // Color según el tipo de quiebre: ámbar para cambio de producto,
            // índigo para cambio de ciclo (velocidad del horno).
            const esCiclo = q.tipo === 'ciclo';
            const colorLinea = esCiclo ? 'rgba(79, 70, 229, 0.85)' : 'rgba(217, 119, 6, 0.85)';
            const colorTexto = esCiclo ? 'rgba(67, 56, 202, 0.95)' : 'rgba(180, 83, 9, 0.95)';
            const prefijo = esCiclo ? '⚙' : '⟂';

            ctx.save();
            ctx.strokeStyle = colorLinea;
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(xPixel, yTop);
            ctx.lineTo(xPixel, yBottom);
            ctx.stroke();
            ctx.setLineDash([]);

            // Etiqueta rotada con el detalle del quiebre.
            ctx.translate(xPixel, yTop + 4);
            ctx.rotate(-Math.PI / 2);
            ctx.fillStyle = colorTexto;
            ctx.font = 'bold 9px sans-serif';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'bottom';
            const texto = q.etiqueta.length > 18 ? q.etiqueta.slice(0, 17) + '…' : q.etiqueta;
            ctx.fillText(`${prefijo} ${texto}${q.hora ? ' ' + q.hora : ''}`, 0, 14);
            ctx.restore();
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

    // Obtener los 4 principales defectos sin modificar el array original
    const top4Defectos = [...(defectos || [])]
      .sort((a, b) => b.porcentaje - a.porcentaje)
      .slice(0, 4);

    console.log('Top 4 defectos:', top4Defectos);

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

    // Extraer las horas de los snapshots y ordenarlas cronológicamente
    // considerando que el turno puede cruzar la medianoche
    const lecturasCopia = [...lecturasDefectos];
    
    // Función para ordenar horas cronológicamente según el turno seleccionado
    function ordenarHorasCronologicamente(lecturas) {
      if (lecturas.length === 0) return lecturas;
      
      // Obtener el turno actual (Mañana, Tarde, Noche)
      const turnoActual = valor('turno');
      let horaInicioTurno = 6; // Por defecto Mañana
      if (turnoActual === 'Tarde') {
        horaInicioTurno = 14;
      } else if (turnoActual === 'Noche') {
        horaInicioTurno = 22;
      }
      const minutosInicioTurno = horaInicioTurno * 60;

      // Convertir todas las horas a minutos desde medianoche
      const lecturasConMinutos = lecturas.map(l => {
        const [horas, minutos] = (l.hora || '00:00').split(':').map(Number);
        return {
          ...l,
          minutosDelDia: (isNaN(horas) ? 0 : horas) * 60 + (isNaN(minutos) ? 0 : minutos)
        };
      });
      
      // Normalizar las horas: si una hora es menor que la hora de inicio del turno, 
      // asumimos que es del período post-medianoche y le sumamos 24 horas (1440 minutos)
      lecturasConMinutos.forEach(l => {
        if (l.minutosDelDia < minutosInicioTurno) {
          l.minutosNormalizados = l.minutosDelDia + 1440; // +24 horas
        } else {
          l.minutosNormalizados = l.minutosDelDia;
        }
      });
      
      // Ordenar por minutos normalizados
      return lecturasConMinutos.sort((a, b) => a.minutosNormalizados - b.minutosNormalizados);
    }
    
    const lecturasOrdenadas = ordenarHorasCronologicamente(lecturasCopia);
    const horas = lecturasOrdenadas.map(l => l.hora);

    // Colores asignados por orden de entrada al Top 4 histórico.
    const colores = [
      { border: 'rgb(96, 165, 250)', bg: 'rgba(96, 165, 250, 0.15)' },    // Azul pastel
      { border: 'rgb(74, 222, 128)', bg: 'rgba(74, 222, 128, 0.15)' },    // Verde pastel
      { border: 'rgb(251, 146, 60)', bg: 'rgba(251, 146, 60, 0.15)' },    // Naranja pastel
      { border: 'rgb(248, 113, 113)', bg: 'rgba(248, 113, 113, 0.15)' },   // Rojo pastel
      { border: 'rgb(168, 85, 247)', bg: 'rgba(168, 85, 247, 0.15)' },    // Violeta pastel
      { border: 'rgb(14, 165, 233)', bg: 'rgba(14, 165, 233, 0.15)' },    // Celeste pastel
      { border: 'rgb(234, 179, 8)', bg: 'rgba(234, 179, 8, 0.15)' },      // Amarillo pastel
      { border: 'rgb(236, 72, 153)', bg: 'rgba(236, 72, 153, 0.15)' }     // Rosa pastel
    ];

    // Obtener todos los defectos que pertenecieron al Top 4 en alguna hora.
    // Esto permite conservar el último punto del defecto que luego salió.
    const top4PorHora = lecturasOrdenadas.map(snapshot => {
      return [...(snapshot.defectos || [])]
        .sort((a, b) => b.porcentaje - a.porcentaje)
        .slice(0, 4);
    });

    const nombresDefectosHistoricos = [];
    top4PorHora.forEach(top4DeEstaHora => {

      top4DeEstaHora.forEach(defecto => {
        if (!nombresDefectosHistoricos.includes(defecto.nombre)) {
          nombresDefectosHistoricos.push(defecto.nombre);
        }
      });
    });

    // Ocultar por completo los defectos que llevan dos tomas fuera del Top 4.
    // Si vuelven a entrar, vuelven a formar parte de la lista y se dibujan.
    const nombresDefectosVisibles = nombresDefectosHistoricos.filter(nombreDefecto => {
      let ultimaTomaEnTop4 = -1;
      top4PorHora.forEach((top4DeEstaHora, indice) => {
        if (top4DeEstaHora.some(defecto => defecto.nombre === nombreDefecto)) {
          ultimaTomaEnTop4 = indice;
        }
      });

      return ultimaTomaEnTop4 >= top4PorHora.length - 2;
    });

    // Crear un dataset por cada defecto visible.
    const datasets = nombresDefectosVisibles.map((nombreDefecto, idx) => {
      let tomasFueraDelTop4 = 0;

      const datos = top4PorHora.map(top4DeEstaHora => {
        const defectoEnTop4 = top4DeEstaHora.find(d => d.nombre === nombreDefecto);

        // Si vuelve a entrar, se reactiva y puede comenzar un nuevo tramo.
        if (defectoEnTop4) {
          tomasFueraDelTop4 = 0;
          return defectoEnTop4.porcentaje;
        }

        // Tras dos tomas fuera del Top 4, no se dibuja nada más hasta que
        // el defecto vuelva a entrar. Esto evita prolongar visualmente una
        // serie antigua y conserva el último punto válido anterior a la salida.
        tomasFueraDelTop4 += 1;
        if (tomasFueraDelTop4 >= 2) return null;

        return null;
      });

      const color = colores[idx % colores.length];

      return {
        label: nombreDefecto,
        data: datos,
        borderColor: color.border,
        backgroundColor: color.bg,
        borderWidth: 2,
        fill: false,
        tension: 0, // Líneas rectas sin curvas
        pointRadius: 6, // Puntos más grandes
        pointBackgroundColor: color.border,
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointHoverRadius: 8, // Hover más grande también
        // No unir el punto anterior con el siguiente cuando sale del Top 4.
        spanGaps: false
      };
    });

    if (datasets.length === 0) {
      console.log('No hay defectos históricos que hayan pertenecido al Top 4');
      return;
    }

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
            bodySpacing: 6,
            displayColors: true,
            callbacks: {
              label: function(context) {
                const valorActual = context.parsed.y;
                const datasetIndex = context.datasetIndex;
                const dataIndex = context.dataIndex;
                const dataset = context.chart.data.datasets[datasetIndex];
                
                let label = `${dataset.label}: ${valorActual.toFixed(2)}%`;
                
                // Calcular diferencia con la lectura anterior
                if (dataIndex > 0) {
                  // Buscar el valor anterior (puede ser null si no había dato)
                  let valorAnterior = null;
                  for (let i = dataIndex - 1; i >= 0; i--) {
                    if (dataset.data[i] !== null) {
                      valorAnterior = dataset.data[i];
                      break;
                    }
                  }
                  
                  if (valorAnterior !== null) {
                    const diferencia = valorActual - valorAnterior;
                    const simbolo = diferencia > 0 ? '↑' : (diferencia < 0 ? '↓' : '→');
                    const color = diferencia > 0 ? 'subió' : (diferencia < 0 ? 'bajó' : 'sin cambio');
                    
                    if (diferencia !== 0) {
                      label += `  ${simbolo} ${Math.abs(diferencia).toFixed(2)}%`;
                    }
                  }
                }
                
                return label;
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
            beginAtZero: false,
            suggestedMin: function(context) {
              // Obtener el valor mínimo de todos los datasets
              const allData = context.chart.data.datasets.flatMap(ds => ds.data.filter(v => v !== null));
              if (allData.length === 0) return 0;
              const minVal = Math.min(...allData);
              // Aplicar margen del 2%
              const margen = minVal * 0.02;
              return Math.max(0, minVal - margen);
            },
            suggestedMax: function(context) {
              // Obtener el valor máximo de todos los datasets y el objetivo
              const allData = context.chart.data.datasets.flatMap(ds => ds.data.filter(v => v !== null));
              if (allData.length === 0) return objetivoDefectos * 1.1;
              const maxVal = Math.max(...allData, objetivoDefectos);
              // Aplicar margen del 2%
              const margen = maxVal * 0.02;
              return maxVal + margen;
            },
            ticks: {
              callback: (value) => value.toFixed(1) + '%',
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
window.cambiarPeriodoVista = cambiarPeriodoVista;