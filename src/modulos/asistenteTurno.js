/* ========================================================== */
/* ASISTENTE-TURNO.JS — Tendencias, alertas y resumen del turno */
/* ========================================================== */
/*
  "Cajón de ayuda" de KIRA: no usa ninguna IA externa ni API keys.
  Es análisis estadístico simple en JS puro sobre los datos que
  KIRA ya tiene guardados (paradas, defectos, acciones de todos
  los turnos históricos). Tres capacidades:

    1. detectarTendencias()   → patrones que se repiten en el tiempo
    2. detectarAlertas()      → valores del turno actual que se
                                 salen de lo normal, comparado con
                                 el propio historial
    3. generarResumenTurno()  → un párrafo en español armado por
                                 plantillas (no es un modelo de
                                 lenguaje, es una serie de reglas
                                 "si pasa X, decir Y")

  Todas las funciones son PURAS (no tocan el DOM): devuelven
  arrays/strings listos para que el módulo de interfaz (todavía
  sin armar) los pinte donde corresponda.
*/

import { lineasActivas, lineaPorId, nombreLinea, sesion, TURNO_MIN } from '../nucleo/estado.js';
import { hoyLocal, fmtFecha, valor } from '../nucleo/utilidades.js';
import { todasParadas, todasDefectos } from './historicos.js';
import { calcularKpisPlanta } from './vistaDePlanta.js';

// Cuántos turnos hacia atrás se consideran "historial reciente"
// para calcular promedios y comparar contra el turno actual.
const VENTANA_TURNOS = 20;

/** Devuelve la fecha de hace N días en formato 'YYYY-MM-DD'. */
function fechaHaceNDias(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

/**
 * Agrupa un array de registros por una clave (ej. 'equipo', 'motivo')
 * y devuelve [[clave, cantidad], ...] ordenado de mayor a menor.
 */
function contarPorClave(regs, obtenerClave) {
  const conteo = {};
  regs.forEach(r => {
    const clave = obtenerClave(r);
    if (!clave) return;
    conteo[clave] = (conteo[clave] || 0) + 1;
  });
  return Object.entries(conteo).sort((a, b) => b[1] - a[1]);
}

/**
 * Calcula el promedio y desvío estándar de un array de números.
 * El desvío estándar es lo que permite distinguir "un poco más alto
 * de lo normal" de "esto es una anomalía real" en detectarAlertas().
 */
function estadisticasBasicas(numeros) {
  if (!numeros.length) return { promedio: 0, desvio: 0 };
  const promedio = numeros.reduce((a, x) => a + x, 0) / numeros.length;
  const varianza = numeros.reduce((a, x) => a + (x - promedio) ** 2, 0) / numeros.length;
  return { promedio, desvio: Math.sqrt(varianza) };
}

// ==========================================================
// 1. DETECCIÓN DE TENDENCIAS
// ==========================================================

/**
 * Analiza el historial reciente y devuelve una lista de tendencias
 * detectadas: equipos recurrentemente problemáticos, motivos que se
 * repiten, defectos en alza, y comparación semana actual vs anterior.
 * @param {string} lineaFiltro - 'TODAS' o el id de una línea específica
 * @returns {Array<{tipo: string, mensaje: string, severidad: 'info'|'atencion'}>}
 */
export function detectarTendencias(lineaFiltro = 'TODAS') {
  const tendencias = [];
  const desde = fechaHaceNDias(30);

  let paradas = todasParadas().filter(x => x.fecha >= desde);
  let defectos = todasDefectos().filter(x => x.fecha >= desde);
  if (lineaFiltro !== 'TODAS') {
    paradas = paradas.filter(x => x.linea === lineaFiltro);
    defectos = defectos.filter(x => x.linea === lineaFiltro);
  }

  // ---- Equipo con más paradas recurrentes (últimos 30 días) ----
  const porEquipo = contarPorClave(paradas, x => x.equipo);
  if (porEquipo.length && porEquipo[0][1] >= 3) {
    const [equipo, cantidad] = porEquipo[0];
    tendencias.push({
      tipo: 'equipo_recurrente',
      mensaje: `${equipo} es el equipo con más paradas registradas en los últimos 30 días (${cantidad} registros).`,
      severidad: cantidad >= 6 ? 'atencion' : 'info'
    });
  }

  // ---- Motivo de parada más frecuente ----
  const porMotivo = contarPorClave(paradas, x => x.motivo);
  if (porMotivo.length && porMotivo[0][1] >= 3) {
    const [motivo, cantidad] = porMotivo[0];
    tendencias.push({
      tipo: 'motivo_recurrente',
      mensaje: `El motivo de parada más repetido del mes es "${motivo}" (${cantidad} veces).`,
      severidad: 'info'
    });
  }

  // ---- Defecto de calidad más frecuente y su tendencia ----
  const porDefecto = {};
  defectos.forEach(d => {
    if (!porDefecto[d.nombre]) porDefecto[d.nombre] = [];
    porDefecto[d.nombre].push(d);
  });
  const defectoTop = Object.entries(porDefecto).sort((a, b) => b[1].length - a[1].length)[0];
  if (defectoTop && defectoTop[1].length >= 3) {
    const [nombre, registros] = defectoTop;
    const ordenados = [...registros].sort((a, b) => a.fecha.localeCompare(b.fecha));
    const mitad = Math.floor(ordenados.length / 2);
    const promPrimeraMitad = estadisticasBasicas(ordenados.slice(0, mitad).map(x => x.porcentaje)).promedio;
    const promSegundaMitad = estadisticasBasicas(ordenados.slice(mitad).map(x => x.porcentaje)).promedio;
    const empeorando = promSegundaMitad > promPrimeraMitad * 1.15;
    const mejorando = promSegundaMitad < promPrimeraMitad * 0.85;
    tendencias.push({
      tipo: 'defecto_tendencia',
      mensaje: empeorando
        ? `El defecto "${nombre}" viene en aumento: pasó de un promedio de ${promPrimeraMitad.toFixed(1)}% a ${promSegundaMitad.toFixed(1)}% en el último mes.`
        : mejorando
          ? `El defecto "${nombre}" viene mejorando: bajó de ${promPrimeraMitad.toFixed(1)}% a ${promSegundaMitad.toFixed(1)}% en el último mes.`
          : `El defecto "${nombre}" se mantiene estable, alrededor de ${promSegundaMitad.toFixed(1)}%.`,
      severidad: empeorando ? 'atencion' : 'info'
    });
  }

  // ---- Comparación semana actual vs semana anterior (minutos de parada) ----
  const inicioSemanaActual = fechaHaceNDias(6);
  const inicioSemanaAnterior = fechaHaceNDias(13);
  const paradaSemanaActual = paradas.filter(x => x.fecha >= inicioSemanaActual).reduce((a, x) => a + x.minutos, 0);
  const paradaSemanaAnterior = paradas.filter(x => x.fecha >= inicioSemanaAnterior && x.fecha < inicioSemanaActual).reduce((a, x) => a + x.minutos, 0);
  if (paradaSemanaAnterior > 0) {
    const variacion = ((paradaSemanaActual - paradaSemanaAnterior) / paradaSemanaAnterior) * 100;
    if (Math.abs(variacion) >= 15) {
      tendencias.push({
        tipo: 'variacion_semanal',
        mensaje: variacion > 0
          ? `Los minutos de parada subieron ${variacion.toFixed(0)}% esta semana respecto a la anterior (${paradaSemanaAnterior} → ${paradaSemanaActual} min).`
          : `Los minutos de parada bajaron ${Math.abs(variacion).toFixed(0)}% esta semana respecto a la anterior (${paradaSemanaAnterior} → ${paradaSemanaActual} min).`,
        severidad: variacion > 0 ? 'atencion' : 'info'
      });
    }
  }

  return tendencias;
}

// ==========================================================
// 2. ALERTAS DE ANOMALÍAS
// ==========================================================

/**
 * Compara los KPIs del turno actual contra el promedio histórico
 * de esa misma línea, y marca como alerta lo que se aleje demasiado
 * (más de 1.5 desvíos estándar por encima del promedio).
 * @param {string} lineaFiltro - 'TODAS' o el id de una línea específica
 * @returns {Array<{tipo: string, mensaje: string, severidad: 'atencion'|'critico'}>}
 */
export function detectarAlertas(lineaFiltro = 'TODAS') {
  const alertas = [];
  const desde = fechaHaceNDias(60);

  const historicoParadas = todasParadas().filter(x => x.fecha >= desde && x.fecha < hoyLocal() && (lineaFiltro === 'TODAS' || x.linea === lineaFiltro));
  const historicoDefectos = todasDefectos().filter(x => x.fecha >= desde && x.fecha < hoyLocal() && (lineaFiltro === 'TODAS' || x.linea === lineaFiltro));

  // Agrupar minutos de parada por turno histórico (fecha|turno) para comparar "turno completo vs turno completo"
  const minutosPorTurno = {};
  historicoParadas.forEach(x => {
    const clave = `${x.fecha}|${x.turno}`;
    minutosPorTurno[clave] = (minutosPorTurno[clave] || 0) + x.minutos;
  });
  const historicoMinutos = Object.values(minutosPorTurno);
  const { promedio: promParada, desvio: desvioParada } = estadisticasBasicas(historicoMinutos);

  const kpisActuales = calcularKpisPlanta(lineaFiltro);

  if (historicoMinutos.length >= 5 && desvioParada > 0) {
    const umbral = promParada + 1.5 * desvioParada;
    if (kpisActuales.m.parada > umbral) {
      alertas.push({
        tipo: 'parada_anomala',
        mensaje: `Los minutos de parada de este turno (${kpisActuales.m.parada} min) están muy por encima del promedio histórico (${promParada.toFixed(0)} min).`,
        severidad: kpisActuales.m.parada > promParada + 2.5 * desvioParada ? 'critico' : 'atencion'
      });
    }
  }

  // Vacío de horno anómalo (misma lógica, agrupado por turno histórico)
  const vacioPorTurno = {};
  historicoParadas.forEach(x => {
    const clave = `${x.fecha}|${x.turno}`;
    vacioPorTurno[clave] = (vacioPorTurno[clave] || 0) + x.vacio;
  });
  const { promedio: promVacio, desvio: desvioVacio } = estadisticasBasicas(Object.values(vacioPorTurno));
  if (Object.values(vacioPorTurno).length >= 5 && desvioVacio > 0) {
    const umbral = promVacio + 1.5 * desvioVacio;
    if (kpisActuales.m.vacio > umbral) {
      alertas.push({
        tipo: 'vacio_anomalo',
        mensaje: `El vacío de horno de este turno (${kpisActuales.m.vacio} min) está muy por encima del promedio histórico (${promVacio.toFixed(0)} min).`,
        severidad: 'atencion'
      });
    }
  }

  // Defecto con porcentaje inusualmente alto respecto a SU propio historial
  const porcentajesPorDefecto = {};
  historicoDefectos.forEach(d => {
    if (!porcentajesPorDefecto[d.nombre]) porcentajesPorDefecto[d.nombre] = [];
    porcentajesPorDefecto[d.nombre].push(d.porcentaje);
  });
  const s = sesion();
  (s.defectos || []).forEach(d => {
    const historial = porcentajesPorDefecto[d.nombre];
    if (!historial || historial.length < 3) return;
    const { promedio, desvio } = estadisticasBasicas(historial);
    if (desvio > 0 && d.porcentaje > promedio + 1.5 * desvio) {
      alertas.push({
        tipo: 'defecto_anomalo',
        mensaje: `El defecto "${d.nombre}" está en ${d.porcentaje}% este turno, muy por encima de su promedio histórico (${promedio.toFixed(1)}%).`,
        severidad: d.porcentaje > promedio + 2.5 * desvio ? 'critico' : 'atencion'
      });
    }
  });

  return alertas;
}

// ==========================================================
// 3. RESUMEN EN LENGUAJE NATURAL DEL TURNO
// ==========================================================

/**
 * Arma un párrafo de 3-5 oraciones describiendo el turno actual,
 * combinando los KPIs con comparaciones contra el historial. NO es
 * un modelo de lenguaje: es una serie de reglas "si pasa X, decir Y"
 * con texto en español natural — 100% determinístico y gratis.
 * @param {string} lineaFiltro - 'TODAS' o el id de una línea específica
 * @returns {string} párrafo listo para mostrar
 */
export function generarResumenTurno(lineaFiltro = 'TODAS') {
  const s = sesion();
  const kpis = calcularKpisPlanta(lineaFiltro);
  const nombre = lineaFiltro === 'TODAS' ? 'la planta' : nombreLinea(lineaFiltro);
  const frases = [];

  // Apertura: identificación del turno
  frases.push(`Turno ${s.turno} del ${fmtFecha(s.actualizada?.slice(0, 10) || hoyLocal())} en ${nombre}.`);

  // Disponibilidad / parada
  if (kpis.m.disponibilidad >= 90) {
    frases.push(`La disponibilidad se mantuvo en un buen nivel (${kpis.m.disponibilidad.toFixed(1)}%), con ${kpis.m.parada} minutos de parada acumulados.`);
  } else {
    frases.push(`La disponibilidad estuvo por debajo del objetivo (${kpis.m.disponibilidad.toFixed(1)}%), con ${kpis.m.parada} minutos de parada acumulados.`);
  }

  // Máquina más crítica
  if (kpis.maquinaCritica) {
    frases.push(`El equipo con más impacto fue ${kpis.maquinaCritica.equipo}, con ${kpis.maquinaCritica.mins} minutos detenido (nivel ${kpis.nivelCritica.label.toLowerCase()}).`);
  } else {
    frases.push('No se registraron paradas relevantes en ningún equipo.');
  }

  // Calidad
  if (kpis.calidadReal > 0) {
    const desvioTexto = kpis.calidadDesvio > 0
      ? `una mejora parcial de +${kpis.calidadDesvio.toFixed(1)}%`
      : kpis.calidadDesvio < 0
        ? `una caída parcial de ${kpis.calidadDesvio.toFixed(1)}%`
        : 'sin variación respecto a la medición parcial';
    frases.push(`La calidad global es de ${kpis.calidadReal.toFixed(1)}%, con ${desvioTexto}.`);
  }

  // Defecto preponderante
  if (kpis.defectoPreponderante) {
    frases.push(`El defecto de calidad más relevante fue "${kpis.defectoPreponderante.nombre}" (${kpis.defectoPreponderante.porcentaje}%).`);
  }

  // Cierre con EGE
  const egeTexto = kpis.egeTurno >= 85 ? 'un resultado sólido' : kpis.egeTurno >= 70 ? 'un resultado aceptable' : 'un resultado que requiere seguimiento';
  frases.push(`La Eficiencia Global de los Equipos (EGE) del turno fue ${kpis.egeTurno.toFixed(1)}%, ${egeTexto}.`);

  return frases.join(' ');
}

// ==========================================================
// 4. RESUMEN RÁPIDO (defecto crítico, máquina crítica, vacío,
//    quemado) — pensado para consulta express y para imprimir
// ==========================================================

/**
 * Busca, dentro de las paradas del turno actual, el registro
 * ESPECÍFICO que más minutos aportó a un equipo dado. A diferencia
 * de "máquina crítica" en calcularKpisPlanta() (que es un AGREGADO
 * de varias paradas del mismo equipo), esto devuelve el registro
 * puntual — así el motivo y la información adicional (obs) que se
 * muestran son exactamente los que cargó el operario, sin mezclar
 * texto de paradas distintas.
 */
function paradaPrincipalDeEquipo(paradasScope, lineaId, equipoNombre) {
  const regs = paradasScope.filter(x => {
    if (x.linea !== lineaId) return false;
    let cleanX = x.equipo;
    if (cleanX.includes('Maxi SIMA') || cleanX.includes('Maxi SITI')) cleanX = cleanX.replace(/ [12]$/, '');
    return cleanX === equipoNombre;
  });
  if (!regs.length) return null;
  return [...regs].sort((a, b) => b.minutos - a.minutos)[0];
}

/**
 * Devuelve, para una línea específica, la última lectura válida de
 * m² quemados cargada en Indicadores (hora + valor real > 0).
 */
function quemadoDeLinea(lineaId) {
  const s = sesion();
  const o = s.objetivos?.porLinea?.[lineaId];
  if (!o) return null;
  const lecturas = (o.lecturasQuemado || []).filter(x => x.hora && x.real > 0);
  if (!lecturas.length) return null;
  const ultima = [...lecturas].sort((a, b) => a.hora.localeCompare(b.hora)).pop();
  // Objetivo dinámico = producción proyectada del turno (calculada por eventos).
  return { real: ultima.real, hora: ultima.hora, objetivoTurno: o.produccionProyectada || 0 };
}

/**
 * Arma el resumen rápido del turno: defecto crítico (con su acción,
 * que ya viene garantizada por el propio registro), máquina crítica
 * (con su motivo y observación exactos, no aproximados), vacío total
 * y quemado hasta el momento. Devuelve datos estructurados — el
 * texto para chat/impresión se arma en formatearResumenRapido().
 * @param {string} lineaFiltro - 'TODAS' o el id de una línea específica
 */
export function resumenRapidoTurno(lineaFiltro = 'TODAS') {
  const s = sesion();
  const kpis = calcularKpisPlanta(lineaFiltro);

  const defectoCritico = kpis.defectoPreponderante
    ? {
        nombre: kpis.defectoPreponderante.nombre,
        porcentaje: kpis.defectoPreponderante.porcentaje,
        accion: kpis.defectoPreponderante.accion || '',
        obs: kpis.defectoPreponderante.obs || ''
      }
    : null;

  let maquinaCritica = null;
  if (kpis.maquinaCritica) {
    // La línea real del equipo crítico: si el filtro es 'TODAS', hay que
    // encontrar a qué línea pertenece (viene en lineaNombre, buscamos el id).
    const lineaDelEquipo = lineaFiltro !== 'TODAS'
      ? lineaFiltro
      : lineasActivas().find(l => l.nombre === kpis.maquinaCritica.lineaNombre)?.id;

    const paradaExacta = lineaDelEquipo
      ? paradaPrincipalDeEquipo(kpis.paradasScope, lineaDelEquipo, kpis.maquinaCritica.equipo)
      : null;

    maquinaCritica = {
      equipo: kpis.maquinaCritica.equipo,
      lineaNombre: kpis.maquinaCritica.lineaNombre,
      minutos: kpis.maquinaCritica.mins,
      vacio: kpis.maquinaCritica.vacio,
      nivel: kpis.nivelCritica.label,
      motivo: paradaExacta?.motivo || kpis.maquinaCritica.motivo || '',
      obs: paradaExacta?.obs || ''
    };
  }

  const lineasParaQuemado = lineaFiltro === 'TODAS' ? lineasActivas().map(l => l.id) : [lineaFiltro];
  const quemado = lineasParaQuemado
    .map(id => ({ lineaId: id, lineaNombre: nombreLinea(id), ...quemadoDeLinea(id) }))
    .filter(x => x.real !== undefined);

  return {
    lineaNombre: lineaFiltro === 'TODAS' ? 'Todas las líneas' : nombreLinea(lineaFiltro),
    turno: s.turno,
    vacioTotalTurno: kpis.m.vacio,
    defectoCritico,
    maquinaCritica,
    quemado
  };
}

/**
 * Convierte el resultado de resumenRapidoTurno() en texto plano
 * legible, listo para mostrar en el chat o mandar a imprimir.
 */
export function formatearResumenRapido(resumen) {
  const lineas = [];
  lineas.push(`📋 RESUMEN RÁPIDO — Turno ${resumen.turno}, ${resumen.lineaNombre}`);
  lineas.push('');

  if (resumen.defectoCritico) {
    lineas.push(`🔴 Defecto crítico: ${resumen.defectoCritico.nombre} (${resumen.defectoCritico.porcentaje}%)`);
    lineas.push(`   Acción: ${resumen.defectoCritico.accion || 'sin acción registrada'}`);
    if (resumen.defectoCritico.obs) lineas.push(`   Obs: ${resumen.defectoCritico.obs}`);
  } else {
    lineas.push('🔴 Defecto crítico: sin defectos registrados en este turno.');
  }
  lineas.push('');

  if (resumen.maquinaCritica) {
    lineas.push(`⚙️ Máquina crítica: ${resumen.maquinaCritica.equipo} — ${resumen.maquinaCritica.minutos} min (nivel ${resumen.maquinaCritica.nivel})`);
    lineas.push(`   Motivo: ${resumen.maquinaCritica.motivo || 'sin especificar'}`);
    if (resumen.maquinaCritica.obs) lineas.push(`   Info adicional: ${resumen.maquinaCritica.obs}`);
  } else {
    lineas.push('⚙️ Máquina crítica: sin paradas registradas en este turno.');
  }
  lineas.push('');

  lineas.push(`💧 Vacío de horno (total del turno): ${resumen.vacioTotalTurno} min`);
  lineas.push('');

  if (resumen.quemado.length) {
    resumen.quemado.forEach(q => {
      lineas.push(`🔥 Quemado ${q.lineaNombre}: ${q.real} m² hasta las ${q.hora} hs (objetivo turno: ${q.objetivoTurno} m²)`);
    });
  } else {
    lineas.push('🔥 Quemado: sin tomas registradas todavía en Indicadores.');
  }

  return lineas.join('\n');
}

// ==========================================================
// 5. ANÁLISIS POR EQUIPO (para consultas de texto libre)
// ==========================================================

/**
 * Devuelve la lista de todos los nombres de equipo de las líneas
 * activas, para poder reconocerlos dentro de una consulta de texto
 * libre (ej. el usuario escribe "Prensa 1, resumen").
 */
export function nombresDeEquipos() {
  const nombres = new Set();
  lineasActivas().forEach(l => {
    l.equipos.filter(e => e.activo !== false).forEach(e => nombres.add(e.nombre));
  });
  return [...nombres];
}

/**
 * Busca, dentro de un texto libre, el primer nombre de equipo que
 * coincida (sin distinguir mayúsculas). Devuelve null si no hay match.
 */
export function detectarEquipoEnTexto(texto) {
  const textoLower = texto.toLowerCase();
  const nombres = nombresDeEquipos().sort((a, b) => b.length - a.length); // más específico primero
  return nombres.find(n => textoLower.includes(n.toLowerCase())) || null;
}

/**
 * Arma un análisis de un equipo específico: cuánto acumuló en el
 * turno actual, cuánto acumuló en los últimos 30 días, motivo más
 * frecuente, y las últimas observaciones cargadas — pensado para
 * responder consultas tipo "esta prensa lleva 50 min por lavado de
 * punzones, generá un resumen para la reunión".
 * @param {string} equipoNombre - nombre exacto del equipo (ver detectarEquipoEnTexto)
 */
export function analizarEquipo(equipoNombre) {
  const s = sesion();
  const paradasTurno = s.paradas.filter(x => {
    let cleanX = x.equipo;
    if (cleanX.includes('Maxi SIMA') || cleanX.includes('Maxi SITI')) cleanX = cleanX.replace(/ [12]$/, '');
    return cleanX === equipoNombre;
  });

  const desde = fechaHaceNDias(30);
  const paradasHistorico = todasParadas().filter(x => {
    if (x.fecha < desde) return false;
    let cleanX = x.equipo;
    if (cleanX.includes('Maxi SIMA') || cleanX.includes('Maxi SITI')) cleanX = cleanX.replace(/ [12]$/, '');
    return cleanX === equipoNombre;
  });

  const minutosTurno = paradasTurno.reduce((a, x) => a + x.minutos, 0);
  const minutosHistorico = paradasHistorico.reduce((a, x) => a + x.minutos, 0);
  const porMotivo = contarPorClave(paradasHistorico, x => x.motivo);
  const motivoPrincipal = porMotivo[0]?.[0] || null;

  const ultimasObs = [...paradasHistorico]
    .filter(x => x.obs)
    .sort((a, b) => (b.fecha + (b.hora || '')).localeCompare(a.fecha + (a.hora || '')))
    .slice(0, 3)
    .map(x => `[${fmtFecha(x.fecha)}] ${x.obs}`);

  return {
    equipo: equipoNombre,
    minutosTurnoActual: minutosTurno,
    eventosTurnoActual: paradasTurno.length,
    minutosUltimos30Dias: minutosHistorico,
    eventosUltimos30Dias: paradasHistorico.length,
    motivoPrincipal,
    cantidadMotivoPrincipal: porMotivo[0]?.[1] || 0,
    ultimasObservaciones: ultimasObs
  };
}

/** Convierte el resultado de analizarEquipo() en texto legible para el chat. */
export function formatearAnalisisEquipo(a) {
  const lineas = [];
  lineas.push(`⚙️ Análisis de ${a.equipo}`);
  lineas.push('');
  lineas.push(`Turno actual: ${a.minutosTurnoActual} min de parada (${a.eventosTurnoActual} evento${a.eventosTurnoActual === 1 ? '' : 's'}).`);
  lineas.push(`Últimos 30 días: ${a.minutosUltimos30Dias} min acumulados en ${a.eventosUltimos30Dias} evento${a.eventosUltimos30Dias === 1 ? '' : 's'}.`);
  if (a.motivoPrincipal) {
    lineas.push(`Motivo más frecuente: "${a.motivoPrincipal}" (${a.cantidadMotivoPrincipal} veces en 30 días).`);
  }
  if (a.ultimasObservaciones.length) {
    lineas.push('');
    lineas.push('Últimas observaciones cargadas:');
    a.ultimasObservaciones.forEach(o => lineas.push(`  • ${o}`));
  }
  return lineas.join('\n');
}

// ==========================================================
// 6. RANKINGS RÁPIDOS (equipo con más parada / más vacío)
// ==========================================================

/** Devuelve el equipo con más minutos de parada en el turno actual, o null si no hay paradas. */
export function equipoConMasParada(lineaFiltro = 'TODAS') {
  const kpis = calcularKpisPlanta(lineaFiltro);
  return kpis.filasMaquinas[0] || null; // filasMaquinas ya viene ordenado por mins descendente
}

/** Devuelve el equipo con más minutos de vacío de horno en el turno actual, o null si no hay registros. */
export function equipoConMasVacio(lineaFiltro = 'TODAS') {
  const kpis = calcularKpisPlanta(lineaFiltro);
  if (!kpis.filasMaquinas.length) return null;
  return [...kpis.filasMaquinas].sort((a, b) => b.vacio - a.vacio)[0];
}

/**
 * Devuelve el equipo con MENOS minutos de parada en el turno actual, ENTRE los
 * que tuvieron al menos una parada (los equipos sin paradas no se registran,
 * así que "el que menos paró" se interpreta como el menor tiempo perdido de
 * los que efectivamente pararon). Null si no hay paradas.
 */
export function equipoConMenosParada(lineaFiltro = 'TODAS') {
  const kpis = calcularKpisPlanta(lineaFiltro);
  if (!kpis.filasMaquinas.length) return null;
  return [...kpis.filasMaquinas].sort((a, b) => a.mins - b.mins)[0];
}

/** Devuelve el equipo con MENOS minutos de vacío de horno en el turno actual (entre los que tuvieron registros). */
export function equipoConMenosVacio(lineaFiltro = 'TODAS') {
  const kpis = calcularKpisPlanta(lineaFiltro);
  const conVacio = kpis.filasMaquinas.filter(f => f.vacio > 0);
  if (!conVacio.length) return null;
  return conVacio.sort((a, b) => a.vacio - b.vacio)[0];
}

// ==========================================================
// 7. DEFECTO PRINCIPAL (turno actual vs. período histórico)
// ==========================================================

/** Devuelve el defecto preponderante del TURNO ACTUAL (con accion/obs exactos, ya vienen del propio registro). */
export function defectoPrincipalTurno(lineaFiltro = 'TODAS') {
  return calcularKpisPlanta(lineaFiltro).defectoPreponderante;
}

/** Devuelve el defecto de MENOR porcentaje del TURNO ACTUAL (el que menos impacta), o null si no hay defectos. */
export function defectoMenorTurno(lineaFiltro = 'TODAS') {
  const ordenados = calcularKpisPlanta(lineaFiltro).defectosOrdenados;
  if (!ordenados || !ordenados.length) return null;
  return ordenados[ordenados.length - 1]; // el último = menor porcentaje
}

/**
 * Devuelve el defecto con mayor porcentaje PROMEDIO en los últimos
 * N días (ej. 7 = semana, 30 = mes), agrupando todas las ocurrencias
 * de cada nombre de defecto en ese período.
 */
export function defectoPrincipalPeriodo(dias, lineaFiltro = 'TODAS', orden = 'max') {
  const desde = fechaHaceNDias(dias);
  let defectos = todasDefectos().filter(x => x.fecha >= desde);
  if (lineaFiltro !== 'TODAS') defectos = defectos.filter(x => x.linea === lineaFiltro);
  if (!defectos.length) return null;

  const grupos = {};
  defectos.forEach(d => {
    if (!grupos[d.nombre]) grupos[d.nombre] = [];
    grupos[d.nombre].push(d);
  });

  const [nombre, registros] = Object.entries(grupos).sort((a, b) => {
    const promA = a[1].reduce((s, x) => s + x.porcentaje, 0) / a[1].length;
    const promB = b[1].reduce((s, x) => s + x.porcentaje, 0) / b[1].length;
    return orden === 'min' ? promA - promB : promB - promA;
  })[0];

  const porcentajePromedio = registros.reduce((s, x) => s + x.porcentaje, 0) / registros.length;
  const masReciente = [...registros].sort((a, b) => (b.fecha + b.turno).localeCompare(a.fecha + a.turno))[0];

  return {
    nombre,
    porcentajePromedio,
    cantidad: registros.length,
    accionMasReciente: masReciente.accion || ''
  };
}

// ==========================================================
// 8. RANKINGS POR PERÍODO (semana / mes, no solo turno actual)
// ==========================================================

/**
 * Agrupa TODAS las paradas de los últimos N días por equipo, sumando
 * minutos y contando eventos. Usado para "¿qué máquina paró más esta
 * semana/mes?" — a diferencia de equipoConMasParada(), que solo mira
 * el turno actual.
 */
function agruparParadasPorEquipoEnPeriodo(dias, lineaFiltro) {
  const desde = fechaHaceNDias(dias);
  let paradas = todasParadas().filter(x => x.fecha >= desde);
  if (lineaFiltro !== 'TODAS') paradas = paradas.filter(x => x.linea === lineaFiltro);
  const porEquipo = {};
  paradas.forEach(x => {
    if (!porEquipo[x.equipo]) porEquipo[x.equipo] = { minutos: 0, vacio: 0, eventos: 0, lineaNombre: nombreLinea(x.linea) };
    porEquipo[x.equipo].minutos += x.minutos;
    porEquipo[x.equipo].vacio += x.vacio;
    porEquipo[x.equipo].eventos += 1;
  });
  return porEquipo;
}

/** Devuelve el equipo con más minutos de parada acumulados en los últimos N días (7 = semana, 30 = mes). */
export function equipoConMasParadaPeriodo(dias, lineaFiltro = 'TODAS') {
  const porEquipo = agruparParadasPorEquipoEnPeriodo(dias, lineaFiltro);
  const entradas = Object.entries(porEquipo);
  if (!entradas.length) return null;
  const [equipo, datos] = entradas.sort((a, b) => b[1].minutos - a[1].minutos)[0];
  return { equipo, ...datos };
}

/** Devuelve el equipo con más minutos de vacío de horno acumulados en los últimos N días. */
export function equipoConMasVacioPeriodo(dias, lineaFiltro = 'TODAS') {
  const porEquipo = agruparParadasPorEquipoEnPeriodo(dias, lineaFiltro);
  const entradas = Object.entries(porEquipo);
  if (!entradas.length) return null;
  const [equipo, datos] = entradas.sort((a, b) => b[1].vacio - a[1].vacio)[0];
  return { equipo, ...datos };
}

/** Devuelve el equipo con MENOS minutos de parada acumulados en los últimos N días (entre los que pararon). */
export function equipoConMenosParadaPeriodo(dias, lineaFiltro = 'TODAS') {
  const entradas = Object.entries(agruparParadasPorEquipoEnPeriodo(dias, lineaFiltro));
  if (!entradas.length) return null;
  const [equipo, datos] = entradas.sort((a, b) => a[1].minutos - b[1].minutos)[0];
  return { equipo, ...datos };
}

/** Devuelve el equipo con MENOS minutos de vacío acumulados en los últimos N días (entre los que tuvieron vacío). */
export function equipoConMenosVacioPeriodo(dias, lineaFiltro = 'TODAS') {
  const entradas = Object.entries(agruparParadasPorEquipoEnPeriodo(dias, lineaFiltro)).filter(([, d]) => d.vacio > 0);
  if (!entradas.length) return null;
  const [equipo, datos] = entradas.sort((a, b) => a[1].vacio - b[1].vacio)[0];
  return { equipo, ...datos };
}

// ==========================================================
// 9. ANÁLISIS DEL DÍA (fecha exacta seleccionada, no un rango)
// ----------------------------------------------------------
// "Día" es distinto de "turno": un día puede tener Mañana+Tarde+Noche
// cargados. Se usa la fecha actualmente seleccionada en el header
// (valor('fecha')), no necesariamente "hoy" del calendario real.
// ==========================================================

/** Agrupa las paradas de una fecha exacta (todos los turnos de ese día) por equipo. */
function agruparParadasPorEquipoEnFecha(fecha, lineaFiltro) {
  let paradas = todasParadas().filter(x => x.fecha === fecha);
  if (lineaFiltro !== 'TODAS') paradas = paradas.filter(x => x.linea === lineaFiltro);
  const porEquipo = {};
  paradas.forEach(x => {
    if (!porEquipo[x.equipo]) porEquipo[x.equipo] = { minutos: 0, vacio: 0, eventos: 0, lineaNombre: nombreLinea(x.linea) };
    porEquipo[x.equipo].minutos += x.minutos;
    porEquipo[x.equipo].vacio += x.vacio;
    porEquipo[x.equipo].eventos += 1;
  });
  return porEquipo;
}

/** Devuelve el equipo con más minutos de parada en el día completo (todos los turnos de la fecha seleccionada). */
export function equipoConMasParadaDia(lineaFiltro = 'TODAS') {
  const fecha = valor('fecha');
  const entradas = Object.entries(agruparParadasPorEquipoEnFecha(fecha, lineaFiltro));
  if (!entradas.length) return null;
  const [equipo, datos] = entradas.sort((a, b) => b[1].minutos - a[1].minutos)[0];
  return { equipo, ...datos, fecha };
}

/** Devuelve el equipo con más minutos de vacío en el día completo. */
export function equipoConMasVacioDia(lineaFiltro = 'TODAS') {
  const fecha = valor('fecha');
  const entradas = Object.entries(agruparParadasPorEquipoEnFecha(fecha, lineaFiltro));
  if (!entradas.length) return null;
  const [equipo, datos] = entradas.sort((a, b) => b[1].vacio - a[1].vacio)[0];
  return { equipo, ...datos, fecha };
}

/** Devuelve el equipo con MENOS minutos de parada en el día completo (entre los que pararon). */
export function equipoConMenosParadaDia(lineaFiltro = 'TODAS') {
  const fecha = valor('fecha');
  const entradas = Object.entries(agruparParadasPorEquipoEnFecha(fecha, lineaFiltro));
  if (!entradas.length) return null;
  const [equipo, datos] = entradas.sort((a, b) => a[1].minutos - b[1].minutos)[0];
  return { equipo, ...datos, fecha };
}

/** Devuelve el equipo con MENOS minutos de vacío en el día completo (entre los que tuvieron vacío). */
export function equipoConMenosVacioDia(lineaFiltro = 'TODAS') {
  const fecha = valor('fecha');
  const entradas = Object.entries(agruparParadasPorEquipoEnFecha(fecha, lineaFiltro)).filter(([, d]) => d.vacio > 0);
  if (!entradas.length) return null;
  const [equipo, datos] = entradas.sort((a, b) => a[1].vacio - b[1].vacio)[0];
  return { equipo, ...datos, fecha };
}

/** Devuelve el defecto con mayor porcentaje promedio en el día completo (todos los turnos de la fecha seleccionada). */
export function defectoPrincipalDia(lineaFiltro = 'TODAS', orden = 'max') {
  const fecha = valor('fecha');
  let defectos = todasDefectos().filter(x => x.fecha === fecha);
  if (lineaFiltro !== 'TODAS') defectos = defectos.filter(x => x.linea === lineaFiltro);
  if (!defectos.length) return null;

  const grupos = {};
  defectos.forEach(d => {
    if (!grupos[d.nombre]) grupos[d.nombre] = [];
    grupos[d.nombre].push(d);
  });

  const [nombre, registros] = Object.entries(grupos).sort((a, b) => {
    const promA = a[1].reduce((s, x) => s + x.porcentaje, 0) / a[1].length;
    const promB = b[1].reduce((s, x) => s + x.porcentaje, 0) / b[1].length;
    return orden === 'min' ? promA - promB : promB - promA;
  })[0];

  const porcentajePromedio = registros.reduce((s, x) => s + x.porcentaje, 0) / registros.length;
  const masReciente = [...registros].sort((a, b) => (b.fecha + b.turno).localeCompare(a.fecha + a.turno))[0];

  return {
    nombre,
    porcentajePromedio,
    cantidad: registros.length,
    accionMasReciente: masReciente.accion || ''
  };
}


// ==========================================================
// 10. EVOLUCIÓN DE CALIDAD HORA A HORA (turno actual)
// ==========================================================

/**
 * Analiza las lecturas de calidad hora a hora del turno actual para una línea
 * y detecta en qué horario empezó a SUBIR (o a BAJAR) de forma sostenida.
 * Devuelve { serie, primerAlza, primerBaja, min, max } o null si no hay datos.
 *
 * @param {string} tipo  'global' | 'parcial'
 * @param {string} lineaFiltro
 */
export function evolucionCalidadTurno(tipo = 'global', lineaFiltro = 'TODAS') {
  const s = sesion();
  const lineas = lineaFiltro === 'TODAS' ? lineasActivas().map(l => l.id) : [lineaFiltro];

  // Tomamos la primera línea con lecturas cargadas (o la seleccionada).
  let lecturas = [];
  for (const id of lineas) {
    const o = s.objetivos?.porLinea?.[id];
    const arr = (o?.lecturasCalidad || []).filter(x => x && x.hora &&
      (tipo === 'global' ? x.global !== null && x.global !== undefined
                         : x.parcial !== null && x.parcial !== undefined));
    if (arr.length) { lecturas = arr; break; }
  }
  if (lecturas.length < 2) return null;

  const serie = lecturas
    .map(x => ({ hora: x.hora, valor: tipo === 'global' ? x.global : x.parcial }))
    .sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));

  let primerAlza = null, primerBaja = null, min = serie[0], max = serie[0];
  for (let i = 1; i < serie.length; i++) {
    if (serie[i].valor > serie[i - 1].valor && !primerAlza) primerAlza = serie[i];
    if (serie[i].valor < serie[i - 1].valor && !primerBaja) primerBaja = serie[i];
    if (serie[i].valor < min.valor) min = serie[i];
    if (serie[i].valor > max.valor) max = serie[i];
  }

  return { serie, primerAlza, primerBaja, min, max, tipo };
}
