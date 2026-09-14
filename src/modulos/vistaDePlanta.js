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
import { db, persistir } from '../nucleo/almacenamiento.js';
import { mostrarAlertaKira } from '../nucleo/alertasKira.js';
import {
  sesion, lineasActivas, lineaPorId, nombreLinea,
  asegurarObjetivosSesion, asegurarProduccionSesion, TURNO_MIN,
  catalogoDefectosCalidad
} from '../nucleo/estado.js';

import { asegurarNotaTurno } from './notasTurno.js';
import { asegurarDefectosSesion, renderDefectos } from './gestionDefectos.js';
import { renderAnalisis } from './graficosYAnalisis.js';
import { todasParadas, todasDefectos } from './historicos.js';
import { minutosDesdeInicioTurno } from '../nucleo/horno.js';
import { areaDelRol, rolActual, usuarioActual } from '../nucleo/roles.js';
import { renderPlanillaCalidadInline, renderTomasEnviadasVistaPlanta, ultimaTomaEnviada } from './cargaCalidad.js';
import { renderProduccionInline, renderRespuestaDefectosVistaPlanta, renderFotosProduccion } from './cargaProduccion.js';

/**
 * Filtra una lista de equipos al área del rol actual: calidad ve solo sus
 * equipos (Qualitron), producción los suyos, admin/supervisor ven todos.
 * Centraliza el criterio para el sinóptico y los indicadores por equipo.
 */
function equiposDelArea(equipos) {
  const area = areaDelRol();
  if (!area) return equipos;
  return equipos.filter(e => (e.area || 'produccion') === area);
}

// Franjas horarias por turno para gráficos de evolución
export const HORAS_TURNO = {
  'Mañana': ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00'],
  'Tarde':  ['14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'],
  'Noche':  ['22:00', '23:00', '00:00', '01:00', '02:00', '03:00', '04:00', '05:00']
};

/**
 * Obtiene la abreviatura o código estándar de un defecto para visualización compacta
 * en gráficos y tarjetas (ej. 'Despunte' -> 'DTE', 'Borde saltado' -> 'BS').
 */
export function obtenerAbreviaturaDefecto(nombreOTexto) {
  if (!nombreOTexto) return '';
  const texto = String(nombreOTexto).trim();
  if (texto.includes(' - ')) {
    return texto.split(' - ')[0].trim().toUpperCase();
  }
  const catalogo = catalogoDefectosCalidad();
  const lower = texto.toLowerCase();

  const porCodigo = catalogo.find(d => d.codigo.toLowerCase() === lower);
  if (porCodigo) return porCodigo.codigo;

  const porNombreExacto = catalogo.find(d => d.nombre.toLowerCase() === lower);
  if (porNombreExacto) return porNombreExacto.codigo;

  const porNombreComienza = catalogo.find(d => d.nombre.toLowerCase().startsWith(lower));
  if (porNombreComienza) return porNombreComienza.codigo;

  const porNombreParcial = catalogo.find(d => {
    const nom = d.nombre.toLowerCase();
    if (nom.includes(lower) || lower.includes(nom)) return true;
    const palabrasTexto = lower.split(/[\s·/,-]+/).filter(w => w.length > 2);
    const matchPalabras = palabrasTexto.filter(w => nom.includes(w));
    return matchPalabras.length >= 2;
  });
  if (porNombreParcial) return porNombreParcial.codigo;

  if (lower.includes('despunte')) return 'DTE';
  if (lower.includes('borde') && (lower.includes('saltado') || lower.includes('arrollado'))) return 'BS';
  if (lower.includes('placa partida') || lower.includes('baldosa rota')) return 'BR';
  if (lower.includes('punto negro')) return 'PTN';
  if (lower.includes('grieta lateral')) return 'GL';
  if (lower.includes('grieta interna')) return 'GI';
  if (lower.includes('corazon') || lower.includes('corazón')) return 'CN';
  if (lower.includes('camino de hormiga')) return 'CH';

  if (texto.length <= 5 && !texto.includes(' ')) return texto.toUpperCase();
  const siglas = texto.split(/[\s·/,-]+/).filter(w => w.length > 0 && !['de', 'la', 'el', 'en', 'por', 'o', 'y'].includes(w.toLowerCase())).map(w => w[0].toUpperCase()).slice(0, 3).join('');
  return siglas || texto.slice(0, 3).toUpperCase();
}

/**
 * Normaliza y formatea el nombre de un defecto para visualización estándar:
 * "[ABREV] - [NOMBRE EN MAYÚSCULAS]" (ej. "G - GRUMO", "DTE - DESPUNTE", "BS - BORDE SALTADO")
 * sin duplicar prefijos de código ("G - G -") ni sufijos de porcentaje pegados.
 */
export function formatearNombreDefecto(nombreOTexto) {
  if (!nombreOTexto) return '';
  const abrev = obtenerAbreviaturaDefecto(nombreOTexto);
  let texto = String(nombreOTexto).trim();

  // Si contiene ' - ', remover todos los prefijos repetidos de abreviaturas/códigos
  while (texto.includes(' - ')) {
    const partes = texto.split(' - ');
    const primerSegmento = partes[0].trim().toUpperCase();
    if (primerSegmento === abrev.toUpperCase() || primerSegmento.length <= 4) {
      texto = partes.slice(1).join(' - ').trim();
    } else {
      break;
    }
  }

  // Si empieza con la abreviatura seguida de espacio
  if (abrev && texto.toUpperCase().startsWith(abrev.toUpperCase() + ' ')) {
    texto = texto.slice(abrev.length).trim();
  }

  // Quitar posibles porcentajes pegados al final (ej. '(3.2%)' o '3.2%')
  texto = texto.replace(/\s*\(\d+([.,]\d+)?%\)\s*$/, '').trim();
  texto = texto.replace(/\s+\d+([.,]\d+)?%\s*$/, '').trim();

  // Si el texto quedó solo con el código o vacío, buscar el nombre oficial en el catálogo
  let nombreBase = texto;
  if (!nombreBase || nombreBase.toUpperCase() === abrev.toUpperCase()) {
    const catalogo = catalogoDefectosCalidad();
    const defCat = catalogo.find(d => d.codigo.toUpperCase() === abrev.toUpperCase());
    if (defCat) nombreBase = defCat.nombre;
  }

  const nombreLimpio = (nombreBase || texto).trim().toUpperCase();
  return abrev ? `${abrev} - ${nombreLimpio}` : nombreLimpio;
}

/**
 * Normaliza una colección de defectos (array de {nombre, porcentaje|pct} o mapa de {nombre: pct}) a mapa clave-valor.
 * Las claves se estandarizan con formatearNombreDefecto() para consolidar nombres equivalentes.
 */
export function normalizarDefectosAMap(defs) {
  const map = {};
  if (!defs) return map;
  if (Array.isArray(defs)) {
    defs.forEach(d => {
      const nom = String(d?.nombre || '').trim();
      const pct = d?.porcentaje != null ? Number(d.porcentaje) : (d?.pct != null ? Number(d.pct) : null);
      if (nom && pct !== null && !isNaN(pct)) {
        const nomCanonica = formatearNombreDefecto(nom);
        map[nomCanonica] = pct;
      }
    });
  } else if (typeof defs === 'object') {
    Object.entries(defs).forEach(([k, v]) => {
      const num = Number(v);
      if (!isNaN(num)) {
        const nomCanonica = formatearNombreDefecto(k);
        map[nomCanonica] = num;
      }
    });
  }
  return map;
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
  // Se usan "|| 0" por si un registro histórico viejo no trae vacio/eventos
  // (evita que un undefined convierta la suma en NaN y rompa disponibilidad/EGE).
  const parada = regs.reduce((a, x) => a + (x.minutos || 0), 0);
  const vacio = regs.reduce((a, x) => a + (x.vacio || 0), 0);
  const eventos = regs.reduce((a, x) => a + (x.eventos || 0), 0);
  const disponibilidad = Math.max(0, 100 - (parada / minutosPeriodo * 100));
  const i = sesion().indicadores;
  return { parada, vacio, eventos, disponibilidad, productivos: Math.max(0, minutosPeriodo - parada), calidad: i.calidad, productividad: i.productividad };
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
    const baseEquips = equiposDelArea(lineaConfig.equipos.filter(e => e.activo !== false));

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

    const paradasLinea = s.paradas.filter(x => x.linea === l);
    const total = paradasLinea.reduce((a, x) => a + x.minutos, 0);

    return `
      <section class="scada-line mb-3">
        <div class="line-caption flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-3">
            <span class="font-black text-slate-800 text-sm tracking-wide">${esc(lineaConfig.nombre)}</span>
          </div>
          <span class="text-xs text-slate-500 font-semibold">Tiempo detenido: <b class="text-slate-800">${total} min</b></span>
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
  const badgeCant = document.getElementById('cantidadAcciones');
  if (badgeCant) badgeCant.textContent = a.length;
  const cont = document.getElementById('accionesRecientes');
  if (!cont) return;

  cont.innerHTML = a.length ? a.map(x => {
    const fotos = Array.isArray(x.fotos) ? x.fotos : [];
    return `
    <div class="flex justify-between items-start border-b border-slate-200 pb-2.5 bg-white p-2.5 rounded shadow-xs">
      <div class="flex-1 pr-2">
        <div class="flex justify-between font-bold text-slate-800 gap-2">
          <b>${esc(x.equipo)}</b>
          <span class="text-slate-400 text-[11px]">${esc(x.hora)} · ${esc(nombreLinea(x.linea))}</span>
        </div>
        <div class="text-[13px] text-slate-600 mt-1 leading-snug">${esc(x.detalle)}</div>
        <div class="text-[10px] text-slate-400 mt-1">Resp: <b class="text-slate-600">${esc(x.responsable || 'No indicado')}</b></div>
        ${fotos.length ? `
          <div class="mt-2 flex flex-wrap gap-1.5 items-center">
            ${fotos.map(src => `
              <div class="w-12 h-12 bg-slate-100 rounded border border-slate-300 overflow-hidden flex items-center justify-center cursor-zoom-in hover:opacity-85 transition shadow-2xs"
                   onclick="window.ampliarFotoCalidad && window.ampliarFotoCalidad('${src.replace(/'/g, "\\'")}')"
                   title="Click para ampliar comprobante">
                <img src="${src}" class="max-w-full max-h-full object-contain" alt="Comprobante">
              </div>
            `).join('')}
            <span class="text-[10px] text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">📷 ${fotos.length} foto(s)</span>
          </div>
        ` : ''}
      </div>
      <div class="flex gap-1.5 no-print shrink-0">
        <button class="btn bg-sky-50 text-sky-700 hover:bg-sky-100 font-bold text-[11px] px-2 py-0.5 rounded border border-sky-200" onclick="editarAccion('${x.id}')">Editar</button>
        <button class="btn bg-rose-50 text-rose-600 hover:bg-rose-100 font-bold text-[11px] px-2 py-0.5 rounded border border-rose-200" onclick="eliminarAccionDirecta('${x.id}')">Eliminar</button>
      </div>
    </div>
  `;
  }).join('') : '<p class="text-slate-500 italic text-xs py-2">No hay acciones correctivas registradas en este turno.</p>';
}

/** Refresca el dashboard operativo (máquinas + acciones + defectos). */
export function renderTodo() {
  renderMaquinas();
  renderAcciones();
  renderDefectos();
  // Paneles embebidos por rol (se dibujan solo si su contenedor existe; el
  // otro rol lo tiene oculto por data-cap). Van acá para refrescarse al
  // cambiar de línea en "Área monitoreada".
  const area = areaDelRol();
  if (area === 'calidad') renderPlanillaCalidadInline();
  if (area !== 'calidad') { renderProduccionInline(); renderFotosProduccion(); }
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
  // El operario de calidad es por línea: al cambiar de área, recargar cabecera.
  if (window.cargarCabeceraCalidad) window.cargarCabeceraCalidad();
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

  // Paradas y defectos: en modo día se concatenan los de los 3 turnos,
  // etiquetando cada registro con su turno (para poder agruparlos luego).
  const paradasFuente = esModoDia
    ? sesionesDia.flatMap(({ turno: tn, sesion: ses }) => (ses.paradas || []).map(p => ({ ...p, _turno: tn })))
    : (s.paradas || []).map(p => ({ ...p, _turno: s.turno }));
  const defectosFuente = esModoDia
    ? sesionesDia.flatMap(({ sesion: ses }) => ses.defectos || [])
    : s.defectos;

  const paradasScope = paradasFuente.filter(x => l === 'TODAS' || x.linea === l);
  // En modo día se listan TODOS los defectos del día con su hora (no se
  // promedian), etiquetados por turno para poder separarlos. En modo turno,
  // los defectos ya vienen de la última toma (sincronizarDefectosDesdeTomas).
  const defectosScope = esModoDia
    ? sesionesDia.flatMap(({ turno: tn, sesion: ses }) =>
        (ses.defectos || []).filter(x => l === 'TODAS' || x.linea === l).map(d => ({ ...d, _turno: tn })))
    : (s.defectos || []).filter(x => l === 'TODAS' || x.linea === l).map(d => ({ ...d, _turno: s.turno }));

  // Métricas: en modo día el turno de referencia es 24 h (3 × TURNO_MIN).
  const minutosPeriodo = esModoDia ? TURNO_MIN * 3 : TURNO_MIN;
  const m = metricas(paradasScope, minutosPeriodo);
  const lineasIter = l === 'TODAS' ? lineasActivas() : [lineaPorId(l)].filter(Boolean);

  let filasMaquinas = [];
  let filasMapaCalor = [];
  lineasIter.forEach(lineaConfig => {
    equiposDelArea(lineaConfig.equipos.filter(e => e.activo !== false)).forEach(eqConfig => {
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
        if (!porMotivo[clave]) porMotivo[clave] = { mins: 0, vacio: 0, observaciones: [], hora: '', turno: x._turno || '' };
        porMotivo[clave].mins += x.minutos;
        porMotivo[clave].vacio += x.vacio;
        // Hora del grupo: la más reciente de sus eventos.
        const h = x.hora || '';
        if (h && h.localeCompare(porMotivo[clave].hora) > 0) porMotivo[clave].hora = h;
        if (x._turno) porMotivo[clave].turno = x._turno;
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
          observaciones: obsTexto,
          hora: datos.hora || '',
          turno: datos.turno || ''
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
  const valorCriticaColor = nivelCritica.key >= 2 ? 'text-rose-600' : (nivelCritica.key === 1 ? 'text-amber-600' : 'text-emerald-600');

  const totalEquiposScope = lineasIter.reduce((a, lc) => a + equiposDelArea(lc.equipos.filter(e => e.activo !== false)).length, 0);
  const equiposConProblema = filasMaquinas.filter(f => {
    const nP = nivelPorValor(f.mins, UMBRAL_PARADA);
    const nV = nivelPorValor(f.vacio, UMBRAL_VACIO);
    return Math.max(nP.key, nV.key) >= 1;
  }).length;
  const disponibilidadEquipos = totalEquiposScope ? ((totalEquiposScope - equiposConProblema) / totalEquiposScope * 100) : 100;

  // ---------- DEFECTO PREPONDERANTE ----------
  const nivelDefecto = nivelPorValor(defectoPreponderante?.porcentaje || 0, UMBRAL_DEFECTO);
  const valorDefectoColor = nivelDefecto.key >= 2 ? 'text-rose-600' : (nivelDefecto.key === 1 ? 'text-amber-600' : 'text-emerald-600');

  asegurarObjetivosSesion(s);

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
    ? 'text-emerald-600'
    : (calidadReal >= calidadObjetivo - 5 ? 'text-amber-600' : 'text-rose-600');

  const calidadParcialSube = calidadParcial > calidadReal;
  const calidadParcialBaja = calidadParcial < calidadReal;
  const calidadDireccion = calidadParcialSube
    ? { color: 'text-emerald-600', stroke: '#34d399', svg: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>' }
    : calidadParcialBaja
      ? { color: 'text-rose-600', stroke: '#fb7185', svg: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>' }
      : { color: 'text-slate-400', stroke: '#94a3b8', svg: '<path d="M5 12h14"/>' };

  const calidadDesvioClase = calidadDesvio >= 0 ? 'text-emerald-600' : 'text-rose-600';
  const calidadDesvioSigno = calidadDesvio > 0 ? '+' : '';

  // ---------- OBJETIVOS DE PRODUCCIÓN (paradas y vacío) ----------
  // Suma de los objetivos por línea del scope actual. El objetivo de paradas
  // (paradasMax) y el de vacío (vacioMax) se cargan en el mini-form de
  // producción. Sirven para colorear las tarjetas contra el objetivo real.
  const objParadas = lineasIter.reduce((a, lc) => a + (Number(s.objetivos.porLinea[lc.id]?.paradasMax) || 0), 0);
  const objVacio = lineasIter.reduce((a, lc) => a + (Number(s.objetivos.porLinea[lc.id]?.vacioMax) || 0), 0);

  // EVALUACIÓN DE SEMÁFORO (VALORES) PARA CADA TARJETA KPI.
  // Parada y vacío se comparan contra su objetivo si está cargado (>0); si no,
  // se usan umbrales fijos por defecto.
  const paradaValorColor = objParadas > 0
    ? (m.parada <= objParadas ? 'text-emerald-600' : (m.parada <= objParadas * 1.5 ? 'text-amber-600' : 'text-rose-600'))
    : (m.parada <= 20 ? 'text-emerald-600' : (m.parada <= 60 ? 'text-amber-600' : 'text-rose-600'));
  const vacioValorColor = objVacio > 0
    ? (m.vacio <= objVacio ? 'text-emerald-600' : (m.vacio <= objVacio * 1.5 ? 'text-amber-600' : 'text-rose-600'))
    : (m.vacio <= 10 ? 'text-emerald-600' : (m.vacio <= 30 ? 'text-amber-600' : 'text-rose-600'));

  // ---------- MÉTRICAS PARA LAS TARJETAS QUEMADOS / CLASIFICADOS / TONO ----------
  // Se muestran los valores CARGADOS (última toma), con su hora, sin cálculos.
  //   - QUEMADOS  : última toma de m² quemados que carga producción (lecturasQuemado).
  //   - CLASIFIC. : última toma de m² de calidad + Rotura % de la última toma.
  //   - TONO      : tono de la última toma de calidad.
  // Se toman de la primera línea del scope con dato (cada línea es independiente;
  // en la práctica el selector fija una sola línea).
  let quemadoVal = null, quemadoHora = '';
  let clasifVal = null, clasifHora = '', roturaVal = null, segundaVal = null, tonoVal = null, tonoHora = '';
  for (const lc of lineasIter) {
    const o = s.objetivos?.porLinea?.[lc.id];
    if (!o) continue;
    // Quemado: última lectura con valor > 0 (por hora).
    const lq = (o.lecturasQuemado || []).filter(x => Number(x?.quemados) > 0);
    if (lq.length) {
      const u = lq[lq.length - 1];
      quemadoVal = Number(u.quemados);
      quemadoHora = u.hora || '';
    }
    // Clasificados / Rotura / Tono: de la última toma de calidad enviada
    // (tomasCalidad) o de lecturasCalidad si no hay tomas.
    const tomasEnv = (o.tomasCalidad || []).filter(t => t?.enviada === true);
    const fuente = tomasEnv.length ? tomasEnv : (o.lecturasCalidad || []);
    if (fuente.length) {
      const u = fuente[fuente.length - 1];
      if (clasifVal == null && (u.clasificados != null || u.m2 != null)) {
        clasifVal = Number(u.clasificados ?? u.m2) || null;
        clasifHora = u.hora || '';
      }
      if (roturaVal == null && u.rotura != null) roturaVal = Number(u.rotura);
      if (segundaVal == null && u.segunda != null) segundaVal = Number(u.segunda);
      if (tonoVal == null && u.tono) {
        tonoVal = String(u.tono).trim();
        tonoHora = u.hora || '';
      }
    }
  }

  return {
    s, paradasScope, defectosScope, m, lineasIter, filasMaquinas, filasMapaCalor,
    defectosOrdenados, defectoPreponderante, pctParada, pctVacio,
    maquinaCritica, nivelCritica, valorCriticaColor,
    totalEquiposScope, equiposConProblema, disponibilidadEquipos,
    nivelDefecto, valorDefectoColor,
    calidadReal, calidadParcial, calidadDesvio, horaCalidad,
    calidadValorColor, calidadDireccion, calidadDesvioClase, calidadDesvioSigno,
    objParadas, objVacio,
    paradaValorColor, vacioValorColor,
    quemadoVal, quemadoHora, clasifVal, clasifHora, roturaVal, segundaVal, tonoVal, tonoHora,
    minutosPeriodo, esModoDia, sesionesDia
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
    objParadas, objVacio,
    paradaValorColor, vacioValorColor,
    quemadoVal, quemadoHora, clasifVal, clasifHora, roturaVal, segundaVal, tonoVal, tonoHora,
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

  // Producto y formato vigentes: el de la toma más reciente tiene prioridad sobre el anterior
  const lineaActual = l !== 'TODAS' ? l : (lineasIter[0]?.id || '');
  const vigCal = (lineaActual && window.productoVigenteCalidad) ? window.productoVigenteCalidad(lineaActual) : null;
  const prodVigente = (vigCal?.producto || s.productoCalidad || '').trim();
  const fmtVigente  = (vigCal?.formato  || s.formatoCalidad  || '').trim();

  // Si hubo cambio de producto en las tomas, reflejarlo automáticamente en la sesión y en la barra superior
  if (vigCal?.producto && vigCal.producto !== s.productoCalidad) {
    s.productoCalidad = vigCal.producto;
  }
  if (vigCal?.formato && vigCal.formato !== s.formatoCalidad) {
    s.formatoCalidad = vigCal.formato;
  }
  const prodInput = document.getElementById('productoCabecera');
  if (prodInput && prodVigente && prodInput.value.trim() !== prodVigente) {
    prodInput.value = prodVigente;
  }
  const fmtInput = document.getElementById('formatoCabecera');
  if (fmtInput && fmtVigente && fmtInput.value.trim() !== fmtVigente) {
    fmtInput.value = fmtVigente;
  }

  // Reflejar en la cabecera de los gráficos de calidad
  const subtituloProd = prodVigente ? `${prodVigente}${fmtVigente ? ' · ' + fmtVigente : ''}` : '';
  ['subtituloProductoCalGlobal','subtituloProductoCalParcial'].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = subtituloProd;
  });

  // INYECCIÓN DE HTML DE LAS TARJETAS KPIs (Paleta pastel suave para iconos y valores)
  document.getElementById('vpKpis').innerHTML = `
    <div class="panel p-3 min-h-[110px] border-t-2 border-t-slate-300 bg-white flex justify-between items-start">
      <div>
        <div class="text-[13px] uppercase font-black text-slate-500">Minutos de parada</div>
        <div class="text-2xl font-black ${paradaValorColor} mt-1">${m.parada} <span class="text-sm font-bold text-slate-400">min</span></div>
        <div class="text-[11px] text-slate-400 mt-1">% del turno: ${pctParada}%</div>
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="#fb7185" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="26" height="26"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>
    </div>

    <div class="panel p-3 min-h-[110px] border-t-2 border-t-slate-300 bg-white flex justify-between items-start">
      <div>
        <div class="text-[13px] uppercase font-black text-slate-500">Minutos de vacío (horno)</div>
        <div class="text-2xl font-black ${vacioValorColor} mt-1">${m.vacio} <span class="text-sm font-bold text-slate-400">min</span></div>
        <div class="text-[11px] text-slate-400 mt-1">% del turno: ${pctVacio}%</div>
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="26" height="26"><path d="M12 2c1 3-2 4-2 7a4 4 0 0 0 8 0c0-1-.5-2-1-3 1 1 2 3 2 5a7 7 0 0 1-14 0c0-4 3-5 4-9 0 0 2 1 3 0z"/></svg>
    </div>

    <div class="panel p-3 min-h-[110px] border-t-2 border-t-slate-300 bg-white flex justify-between items-start">
      <div>
        <div class="text-[13px] uppercase font-black text-slate-500">Máquina más crítica</div>
        <div class="text-base font-black ${valorCriticaColor} mt-1">${esc(maquinaCritica?.equipo || 'Sin datos')}</div>
        <div class="text-[16px] font-black ${valorCriticaColor} mt-1">${maquinaCritica?.mins || 0} min · ${nivelCritica.label}</div>
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="26" height="26"><path d="M12 2 2 20h20L12 2z"/><line x1="12" y1="9" x2="12" y2="14"/><circle cx="12" cy="17" r="0.6" fill="#f87171" stroke="none"/></svg>
    </div>

    <div class="panel p-3 min-h-[110px] border-t-2 border-t-slate-300 bg-white flex justify-between items-start">
      <div>
        <div class="text-[13px] uppercase font-black text-slate-500">Defecto Preponderante</div>
        <div class="text-base font-black ${valorDefectoColor} mt-1">${esc(defectoPreponderante?.nombre || 'Sin defectos')}</div>
        <div class="text-[16px] font-black ${valorDefectoColor} mt-0.5">${defectoPreponderante ? defectoPreponderante.porcentaje + '%' : '0%'}${defectoPreponderante ? ` · ${nivelDefecto.label}` : ''}</div>
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="26" height="26"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    </div>

    <!-- QUEMADOS: m² quemados (última toma cargada por producción) + hora. -->
    <div class="panel p-3 min-h-[110px] border-t-2 border-t-slate-300 bg-white flex justify-between items-start">
      <div>
        <div class="text-[13px] uppercase font-black text-slate-500">Quemados</div>
        <div class="text-2xl font-black text-slate-800 mt-1">${quemadoVal != null ? quemadoVal.toLocaleString('es-AR') + ' <span class="text-sm font-bold text-slate-400">m²</span>' : '<span class="text-slate-300">—</span>'}</div>
        ${quemadoVal != null && quemadoHora ? `<div class="text-[11px] text-slate-400 mt-1">${esc(quemadoHora)} hs</div>` : ''}
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="#fb923c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="28" height="28"><path d="M8 2c1 3-2 4-2 7a4 4 0 0 0 8 0c0-1-.5-2-1-3 1 1 3 3 3 6a6 6 0 0 1-12 0c0-4 4-5 4-10z"/></svg>
    </div>

    <!-- METROS CLASIFICADOS: m² de la última toma de calidad + Rotura % secundario. -->
    <div class="panel p-3 min-h-[110px] border-t-2 border-t-slate-300 bg-white flex justify-between items-start">
      <div>
        <div class="text-[13px] uppercase font-black text-slate-500">Metros clasificados</div>
        <div class="text-2xl font-black text-slate-800 mt-1">${clasifVal != null ? clasifVal.toLocaleString('es-AR') + ' <span class="text-sm font-bold text-slate-400">m²</span>' : '<span class="text-slate-300">—</span>'}</div>
        ${segundaVal != null ? `<div class="text-[12px] mt-1 text-amber-600 font-bold">2da: ${segundaVal}%</div>` : ''}
        ${roturaVal != null ? `<div class="text-[12px] text-orange-600 font-bold">Rotura: ${roturaVal}%</div>` : ''}
        ${clasifVal != null && clasifHora ? `<div class="text-[11px] text-slate-400 mt-0.5">${esc(clasifHora)} hs</div>` : ''}
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="26" height="26"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
    </div>

    <div class="panel p-3 min-h-[110px] border-t-2 border-t-slate-300 bg-white flex justify-between items-start">
      <div>
        <div class="text-[13px] uppercase font-black text-slate-500">Calidad</div>
        <div class="text-2xl font-black ${calidadValorColor} mt-1">${calidadReal.toFixed(1)}%</div>
        <div class="text-[14px] text-slate-500 mt-1 flex items-center gap-1">Parcial: <b class="${calidadDireccion.color}">${calidadParcial.toFixed(1)}%</b><svg viewBox="0 0 24 24" fill="none" stroke="${calidadDireccion.stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">${calidadDireccion.svg}</svg></div>
        <div class="text-[13px] mt-1 ${calidadDesvioClase}">Desvío: <b>${calidadDesvioSigno}${calidadDesvio.toFixed(1)}%</b><span class="text-slate-400"> · ${horaCalidad} hs</span></div>
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="26" height="26"><path d="M20 6 9 17l-5-5"/></svg>
    </div>

    <!-- TONO: valor de tono de la última toma de calidad + hora. -->
    <div class="panel p-3 min-h-[110px] border-t-2 border-t-slate-300 bg-white flex justify-between items-start">
      <div>
        <div class="text-[13px] uppercase font-black text-slate-500">Tono</div>
        <div class="text-2xl font-black text-slate-800 mt-1">${tonoVal != null ? tonoVal : '<span class="text-slate-300">—</span>'}</div>
        ${tonoVal != null && tonoHora ? `<div class="text-[11px] text-slate-400 mt-1">${esc(tonoHora)} hs</div>` : ''}
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="26" height="26"><circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/><circle cx="12" cy="12" r="4"/></svg>
    </div>
  `;

  // Fila separadora de turno (solo en modo día). colspan según la tabla.
  const filaTurno = (turno, cols) => `<tr class="bg-slate-100"><td colspan="${cols}" class="text-[10px] font-black text-slate-500 uppercase py-1 px-2">Turno ${esc(turno || '—')}</td></tr>`;

  // ---------- MAPA DE CALOR DE MÁQUINAS (paradas) ----------
  // Modo turno: ordenadas por minutos (más crítica arriba). Modo día:
  // agrupadas por turno (Mañana/Tarde/Noche), con separador de turno.
  const ordenTurno = { 'Mañana': 0, 'Tarde': 1, 'Noche': 2 };
  const filaMaquina = (f, i) => {
    const nivelP = nivelPorValor(f.mins, UMBRAL_PARADA);
    const nivelV = nivelPorValor(f.vacio, UMBRAL_VACIO);
    const nivelFinal = nivelP.key >= nivelV.key ? nivelP : nivelV;
    return `
      <tr class="${nivelFinal.rowBg}">
        <td class="text-center font-black text-slate-500">${i + 1}</td>
        <td class="text-center text-slate-600">${esc(f.lineaNombre || '—')}</td>
        <td class="text-center text-sky-700 font-bold">${esc(f.hora || '—')}</td>
        <td><b>${esc(f.equipo)}</b></td>
        <td class="text-center"><span class="badge ${nivelP.badge}">${f.mins} min</span></td>
        <td class="text-center"><span class="badge ${nivelV.badge}">${f.vacio} min</span></td>
        <td style="padding-left: 1.5rem">${esc(f.motivo)}</td>
        <td class="text-slate-600 text-xs">${esc(f.observaciones || '—')}</td>
        <td class="text-center"><span class="badge ${nivelFinal.badge}">${nivelFinal.label}</span></td>
      </tr>`;
  };
  let htmlMaq;
  if (!filasMapaCalor.length) {
    htmlMaq = '<tr><td colspan="9" class="text-center text-slate-500 p-3 italic">No hay paradas registradas en este turno.</td></tr>';
  } else if (esModoDia) {
    // Agrupar por turno; dentro de cada turno, por minutos desc.
    const porTurno = {};
    filasMapaCalor.forEach(f => { (porTurno[f.turno] ||= []).push(f); });
    htmlMaq = Object.keys(porTurno)
      .sort((a, b) => (ordenTurno[a] ?? 9) - (ordenTurno[b] ?? 9))
      .map(tn => filaTurno(tn, 9) + porTurno[tn].sort((a, b) => b.mins - a.mins).map((f, i) => filaMaquina(f, i)).join(''))
      .join('');
  } else {
    htmlMaq = filasMapaCalor.map((f, i) => filaMaquina(f, i)).join('');
  }
  document.getElementById('tablaMapaMaquinas').innerHTML = htmlMaq;

  // ---------- MAPA DE CALOR DE DEFECTOS ----------
  const filaDefecto = (x, i) => {
    const nivel = nivelPorValor(x.porcentaje, UMBRAL_DEFECTO);
    return `
      <tr class="${nivel.rowBg}">
        <td class="text-center font-black text-slate-500">${i + 1}</td>
        <td class="text-center text-slate-600">${esc(nombreLinea(x.linea))}</td>
        <td class="text-center text-sky-700 font-bold">${esc(x.hora || '—')}</td>
        <td><b>${esc(formatearNombreDefecto(x.nombre) || x.nombre)}</b></td>
        <td class="text-center"><span class="badge ${nivel.badge}">${x.porcentaje}%</span></td>
        <td>${esc(x.accion || '—')}</td>
        <td class="text-center"><span class="badge ${nivel.badge}">${nivel.label}</span></td>
      </tr>`;
  };
  let htmlDef;
  if (!defectosOrdenados.length) {
    htmlDef = '<tr><td colspan="7" class="text-center text-slate-500 p-3 italic">No hay defectos de calidad registrados en este turno.</td></tr>';
  } else if (esModoDia) {
    const porTurno = {};
    defectosOrdenados.forEach(x => { (porTurno[x._turno] ||= []).push(x); });
    htmlDef = Object.keys(porTurno)
      .sort((a, b) => (ordenTurno[a] ?? 9) - (ordenTurno[b] ?? 9))
      .map(tn => filaTurno(tn, 7) + porTurno[tn].sort((a, b) => b.porcentaje - a.porcentaje).map((x, i) => filaDefecto(x, i)).join(''))
      .join('');
  } else {
    htmlDef = defectosOrdenados.map((x, i) => filaDefecto(x, i)).join('');
  }
  document.getElementById('tablaMapaDefectos').innerHTML = htmlDef;

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
    // agrupó y sumó las paradas de esa máquina para el turno/día actual).
    const motivosEstaMaq = {};
    paradasScope.filter(p => p.equipo === maquinaCritica.equipo).forEach(p => {
      motivosEstaMaq[p.motivo] = (motivosEstaMaq[p.motivo] || 0) + p.minutos;
    });
    const motivosDesc = Object.entries(motivosEstaMaq)
      .sort((a, b) => b[1] - a[1])
      .map(e => `${esc(e[0])} (${e[1]} min)`)
      .join(', ');
    frasesAuto.push(`<span><b>Máquina más crítica:</b> ${esc(maquinaCritica.equipo)} con ${maquinaCritica.mins} min de parada total${maquinaCritica.vacio > 0 ? ` y ${maquinaCritica.vacio} min de vacío` : ''}${motivosDesc ? ` · <span class="text-slate-500">Causas: ${motivosDesc}</span>` : ''}.</span>`);
  } else {
    frasesAuto.push('<span class="text-slate-500">No se registran paradas de equipos en el período.</span>');
  }

  if (defectoPrincipal) {
    frasesAuto.push(`<span><b>Defecto principal:</b> ${esc(formatearNombreDefecto(defectoPrincipal.nombre) || defectoPrincipal.nombre)} con ${defectoPrincipal.porcentaje}% de piezas defectuosas${defectoPrincipal.accion ? ` · <b>Acción:</b> ${esc(defectoPrincipal.accion)}` : ''}.</span>`);
  }

  if (objVacioTotal > 0) {
    const vacioTotal = m.vacio;
    const cumplimientoVacio = vacioTotal <= objVacioTotal;
    frasesAuto.push(`<span>Vacío de horno: <b>${vacioTotal} min</b> (máx ${objVacioTotal} min) · <span class="${cumplimientoVacio ? 'text-emerald-700 font-bold' : 'text-rose-700 font-bold'}">${cumplimientoVacio ? 'Cumple objetivo' : 'Supera el límite permitido'}</span>.</span>`);
  }

  document.getElementById('vpComentarioAuto').innerHTML = frasesAuto.join('<span class="text-slate-300 font-bold mx-2 hidden sm:inline">|</span>');

  // Observaciones de producción: mostrar solo las del operario de turno actual
  // y reflejar la badge con el nombre del operario logueado.
  const obsProd = (s.observacionesTurno || '').trim();
  const elObsProd = document.getElementById('vpObsProduccion');
  if (elObsProd) elObsProd.innerHTML = obsProd
    ? esc(obsProd)
    : '<span class="text-slate-400 italic">Sin observaciones de producción.</span>';

  const opProdBadge = document.getElementById('vpOperarioProduccionBadge');
  if (opProdBadge) {
    const usuarioAct = usuarioActual();
    if (usuarioAct && usuarioAct.rol === 'produccion' && usuarioAct.nombre) {
      opProdBadge.textContent = usuarioAct.nombre;
      opProdBadge.classList.remove('hidden');
    } else {
      opProdBadge.textContent = '';
      opProdBadge.classList.add('hidden');
    }
  }

  // Observaciones de calidad: por línea (la monitoreada / primera del scope).
  const obsCal = (lineasIter.map(lc => (s.objetivos?.porLinea?.[lc.id]?.observacionesCalidad || '').trim()).find(Boolean) || '');
  const elObsCal = document.getElementById('vpObsCalidad');
  if (elObsCal) elObsCal.innerHTML = obsCal
    ? esc(obsCal)
    : '<span class="text-slate-400 italic">Sin observaciones de calidad.</span>';

  // Renderizar gráficos de calidad (modo turno u día de 24 h)
  renderizarGraficosCalidad(l, lineasIter, s, { esModoDia, sesionesDia });
  
  // Renderizar gráfico de evolución de defectos
  renderizarGraficoEvolucionDefectos(l, defectosScope, s);

  // Reflejar en Vista de Planta según el rol:
  // En MODO SUPERVISOR no se muestran las tomas de calidad ni las respuestas a defectos de producción en Vista de Planta
  const rActual = rolActual();
  const elTomasCal = document.getElementById('vpCalidadTomas');
  const elRespProd = document.getElementById('vpProduccionAcciones');

  if (rActual === 'supervisor') {
    if (elTomasCal) elTomasCal.innerHTML = '';
    if (elRespProd) elRespProd.innerHTML = '';
  } else if (rActual === 'calidad') {
    renderTomasEnviadasVistaPlanta();
    if (elRespProd) elRespProd.innerHTML = '';
  } else if (rActual === 'produccion') {
    if (elTomasCal) elTomasCal.innerHTML = '';
    renderRespuestaDefectosVistaPlanta();
  } else {
    // Administrador u otros
    renderTomasEnviadasVistaPlanta();
    renderRespuestaDefectosVistaPlanta();
  }

  // Evidencias fotográficas de calidad: visible para todos los logins en Vista de Planta
  renderFotosCalidadVistaPlanta(l, lineasIter, s);

  // Evidencias y acciones correctivas de producción en Vista de Planta
  renderAccionesProduccionVistaPlanta(l, s);
}

/**
 * Renderiza las fotos de evidencias de calidad en la Vista de Planta general.
 * Muestra ÚNICAMENTE las fotos de la última toma cargada (fotos del momento
 * que respaldan los datos vigentes de calidad).
 */
export function renderFotosCalidadVistaPlanta(lineaSeleccionada, lineasIter, s) {
  const cont = document.getElementById('vpFotosCalidadContainer');
  const countBadge = document.getElementById('vpFotosCalidadCount');
  if (!cont) return;

  // Determinar líneas a consultar: si es 'TODAS', iterar todas las activas; si no, la línea seleccionada
  const lineasBuscar = lineaSeleccionada !== 'TODAS'
    ? lineasIter.filter(li => li.id === lineaSeleccionada)
    : lineasIter;

  // Recolectar ÚNICAMENTE las fotos de la toma más reciente con fotos (fotos del momento)
  const fotosEnviadas = [];
  lineasBuscar.forEach(linea => {
    const o = s.objetivos?.porLinea?.[linea.id];
    if (!o || !Array.isArray(o.tomasCalidad)) return;

    // Buscar las tomas con fotos ordenadas de más reciente a más antigua
    const tomasConFotos = o.tomasCalidad
      .map((t, idx) => ({ t, idx }))
      .filter(x => Array.isArray(x.t.fotos) && x.t.fotos.length > 0)
      .sort((a, b) => (b.t.hora || '').localeCompare(a.t.hora || '') || (b.idx - a.idx));

    // Tomar EXCLUSIVAMENTE la toma más reciente con fotos (las fotos viejas se reemplazan)
    const ultimaToma = tomasConFotos[0];
    if (!ultimaToma) return;

    const { t, idx } = ultimaToma;
    const defStr = (t.defectos || [])
      .filter(d => (d.nombre || '').trim())
      .map(d => `${d.nombre}${d.pct != null ? ` (${d.pct}%)` : ''}`)
      .join(' · ');

    // Las fotos de esta toma vigente
    const fotosDeToma = [...(t.fotos || [])].reverse();
    fotosDeToma.forEach(src => {
      if (!src) return;
      fotosEnviadas.push({
        src,
        tomaIdx: idx + 1,
        hora: t.hora || '—',
        enviada: t.enviada === true,
        lineaNombre: linea.nombre,
        defectos: defStr || 'Sin defectos informados'
      });
    });
  });

  if (countBadge) {
    if (fotosEnviadas.length > 0) {
      countBadge.textContent = `${fotosEnviadas.length} foto${fotosEnviadas.length === 1 ? '' : 's'} · Toma ${fotosEnviadas[0].tomaIdx}`;
    } else {
      countBadge.textContent = '0 fotos';
    }
  }

  if (!fotosEnviadas.length) {
    cont.innerHTML = `
      <div class="col-span-full py-6 text-center text-xs text-slate-400 italic bg-slate-50/70 rounded-lg border border-dashed border-slate-200">
        No se registran fotos en la última toma de calidad de este turno.
      </div>`;
    return;
  }

  cont.innerHTML = fotosEnviadas.map((f, idx) => `
    <div class="border ${f.enviada ? 'border-sky-200 hover:border-sky-400' : 'border-amber-300 hover:border-amber-400 bg-amber-50/20'} rounded-lg bg-white overflow-hidden shadow-sm flex flex-col transition">
      <div class="${f.enviada ? 'bg-sky-50 border-sky-100' : 'bg-amber-50 border-amber-200'} px-3 py-1.5 border-b flex items-center justify-between text-xs font-bold text-slate-700">
        <span class="flex items-center gap-1.5 text-sky-800">
          <span class="w-5 h-5 rounded-full ${f.enviada ? 'bg-sky-600' : 'bg-amber-600'} text-white flex items-center justify-center text-[10px] font-black">${idx + 1}</span>
          <span>${esc(f.lineaNombre)} · Toma ${f.tomaIdx}</span>
          ${!f.enviada ? '<span class="text-[9px] bg-amber-200 text-amber-900 px-1 rounded font-bold">Borrador</span>' : ''}
        </span>
        <span class="text-slate-500 font-mono text-[11px]">${esc(f.hora)} hs</span>
      </div>
      <div class="w-full h-48 sm:h-52 bg-slate-900/5 overflow-hidden flex items-center justify-center cursor-zoom-in relative group"
        onclick="window.ampliarFotoCalidad && window.ampliarFotoCalidad('${f.src.replace(/'/g, "\\'")}')" title="Click para ampliar imagen">
        <img src="${f.src}" class="max-w-full max-h-full object-contain group-hover:scale-105 transition-transform duration-200" alt="Foto defecto ${idx + 1}">
        <div class="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center pointer-events-none">
          <span class="opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 text-white text-[11px] px-2 py-1 rounded shadow">🔍 Click para ampliar</span>
        </div>
      </div>
      <div class="p-2 bg-white text-[11px] text-slate-600 border-t border-slate-100 truncate" title="${esc(f.defectos)}">
        <strong class="text-rose-700 font-semibold">Defectos:</strong> ${esc(f.defectos)}
      </div>
    </div>
  `).join('');
}

/**
 * Renderiza las acciones correctivas con sus fotos de respaldo en Vista de Planta general.
 */
export function renderAccionesProduccionVistaPlanta(lineaSeleccionada, s) {
  const panel = document.getElementById('vpAccionesProduccionPanel');
  const cont = document.getElementById('vpAccionesProduccionContainer');
  const countBadge = document.getElementById('vpAccionesProduccionCount');
  if (!cont) return;

  const acciones = (s.acciones || [])
    .filter(x => lineaSeleccionada === 'TODAS' || x.linea === lineaSeleccionada)
    .slice()
    .reverse();

  if (countBadge) {
    countBadge.textContent = `${acciones.length} ${acciones.length === 1 ? 'acción' : 'acciones'}`;
  }

  if (!acciones.length) {
    cont.innerHTML = `
      <div class="col-span-full py-6 text-center text-xs text-slate-400 italic bg-slate-50/70 rounded-lg border border-dashed border-slate-200">
        No se registran acciones correctivas en este turno.
      </div>`;
    return;
  }

  cont.innerHTML = acciones.map(x => {
    const fotos = Array.isArray(x.fotos) ? x.fotos : [];
    return `
      <div class="border border-emerald-200 rounded-lg bg-white overflow-hidden shadow-sm flex flex-col justify-between transition hover:border-emerald-400">
        <div class="bg-emerald-50 px-3 py-1.5 border-b border-emerald-100 flex items-center justify-between text-xs font-bold text-slate-700">
          <span class="flex items-center gap-1.5 text-emerald-900">
            <span class="badge bg-emerald-600 text-white text-[10px] font-black">${esc(nombreLinea(x.linea))}</span>
            <span class="font-extrabold">${esc(x.equipo)}</span>
          </span>
          <span class="text-slate-500 font-mono text-[11px]">${esc(x.hora)} hs</span>
        </div>

        <div class="p-3 flex-1 flex flex-col justify-between">
          <div>
            <p class="text-xs text-slate-700 leading-relaxed bg-slate-50 p-2.5 rounded border border-slate-100 mb-2 whitespace-pre-line">${esc(x.detalle)}</p>
            <div class="text-[11px] text-slate-400 mb-2">
              Responsable: <b class="text-slate-600 font-semibold">${esc(x.responsable || s.operarioProduccion || 'No indicado')}</b>
            </div>
          </div>

          ${fotos.length ? `
            <div class="border-t border-slate-100 pt-2 mt-2">
              <div class="text-[10px] font-bold text-emerald-800 uppercase mb-1.5 flex items-center gap-1">
                <span>📷 Comprobantes adjuntos (${fotos.length}):</span>
              </div>
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
                ${fotos.map((src, fIdx) => `
                  <div class="h-24 bg-slate-900/5 rounded border border-slate-200 overflow-hidden flex items-center justify-center cursor-zoom-in group relative"
                       onclick="window.ampliarFotoCalidad && window.ampliarFotoCalidad('${src.replace(/'/g, "\\'")}')"
                       title="Click para ampliar comprobante">
                    <img src="${src}" class="max-w-full max-h-full object-contain group-hover:scale-105 transition-transform duration-200" alt="Comprobante ${fIdx + 1}">
                    <div class="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center pointer-events-none">
                      <span class="opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded shadow">🔍 Ampliar</span>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : `
            <div class="text-[10px] text-slate-400 italic border-t border-slate-100 pt-1.5 mt-2">Sin comprobantes fotográficos adjuntos</div>
          `}
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Renderiza los gráficos de evolución de calidad global y parcial.
 * Se llama desde renderVistaPlanta() para mostrar la evolución hora a hora.
 */
function renderizarGraficosCalidad(lineaSeleccionada, lineasIter, s, opciones = {}) {
  try {
    const { esModoDia = false, sesionesDia = [] } = opciones;

    // Construye el objeto "objetivos" que alimenta el gráfico para una línea.
    // - Modo turno: usa las tomas de calidad de la sesión actual (o lecturas previas).
    // - Modo día: concatena las tomas/lecturas de los 3 turnos en una sola serie de
    //   24 h, ordenadas por la jornada administrativa (05:00 → 05:00).
    const objetivosParaLinea = (lc) => {
      if (!esModoDia) return s.objetivos?.porLinea?.[lc.id];

      const objBase = s.objetivos?.porLinea?.[lc.id] || {};
      const ordTurno = { 'Mañana': 0, 'Tarde': 1, 'Noche': 2 };
      const conTurno = [];
      sesionesDia.forEach(({ turno: turnoSes, sesion: ses }) => {
        const o = ses.objetivos?.porLinea?.[lc.id];
        if (!o) return;
        const tomas = (o.tomasCalidad || []).filter(t => t && (t.global != null || t.parcial1 != null));
        const raw = tomas.length
          ? tomas.map((t, idx) => ({ hora: (t.hora || '').trim() || `Toma ${idx + 1}`, global: t.global, parcial: t.parcial1 }))
          : (o.lecturasCalidad || []).filter(l => l && (l.global != null || l.parcial != null));
        raw.forEach(lec => {
          if (!lec || !lec.hora) return;
          if (lec.global === null && lec.parcial === null) return;
          conTurno.push({
            hora: lec.hora,
            global: lec.global,
            parcial: lec.parcial,
            _t: ordTurno[turnoSes] ?? 9,
            _m: minutosDesdeInicioTurno(lec.hora, turnoSes) ?? 0
          });
        });
      });
      conTurno.sort((a, b) => (a._t - b._t) || (a._m - b._m));

      return { ...objBase, lecturasCalidad: conTurno };
    };

    const lineasConDatos = lineasIter
      .map(lc => ({ linea: lc, objetivos: objetivosParaLinea(lc) }))
      .filter(x => {
        if (!x.objetivos) return false;
        const o = x.objetivos;
        const tieneTomas = Array.isArray(o.tomasCalidad) && o.tomasCalidad.some(t => t && (t.global != null || t.parcial1 != null));
        const tieneLecturas = Array.isArray(o.lecturasCalidad) && o.lecturasCalidad.some(l => l && (l.global != null || l.parcial != null));
        return tieneTomas || tieneLecturas;
      });

    // Si la línea seleccionada es TODAS, agregar datos de todas las líneas con datos
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
        
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.font = '13px sans-serif';
          ctx.fillStyle = '#94a3b8';
          ctx.textAlign = 'center';
          const tipo = canvasId === 'chartCalidadGlobal' ? 'global' : 'parcial';
          ctx.fillText(`Sin lecturas de calidad ${tipo} registradas`, canvas.width / 2, canvas.height / 2);
        }
      });
      return;
    }

    // Calcular escala compartida basada en Calidad Parcial para que ambos gráficos
    // tengan la misma escala del eje Y de 5 en 5, usando la escala de parcial
    let escalaCompartida = null;
    if (!esModoDia) {
      const valoresParcial = [];
      const valoresGlobal = [];
      const objetivos = [];
      lineasAMostrar.forEach(item => {
        const { objetivos: objs } = item;
        const tomas = objs?.tomasCalidad || [];
        tomas.forEach(t => {
          const vp = (t?.parcial1 != null && !isNaN(Number(t.parcial1))) ? Number(t.parcial1) : ((t?.parcial != null && !isNaN(Number(t.parcial))) ? Number(t.parcial) : null);
          if (vp !== null) valoresParcial.push(vp);
          const vg = (t?.global != null && !isNaN(Number(t.global))) ? Number(t.global) : null;
          if (vg !== null) valoresGlobal.push(vg);
        });
        const legacy = objs?.lecturasCalidad || [];
        legacy.forEach(l => {
          const vp = (l?.parcial != null && !isNaN(Number(l.parcial))) ? Number(l.parcial) : null;
          if (vp !== null) valoresParcial.push(vp);
          const vg = (l?.global != null && !isNaN(Number(l.global))) ? Number(l.global) : null;
          if (vg !== null) valoresGlobal.push(vg);
        });
        if (Number(objs?.calidad) > 0) objetivos.push(Number(objs?.calidad));
      });

      const baseMuestreo = valoresParcial.length > 0 ? valoresParcial : valoresGlobal;
      if (baseMuestreo.length > 0) {
        let valMin = Math.min(...baseMuestreo);
        let valMax = Math.max(...baseMuestreo);
        if (valoresGlobal.length > 0) {
          valMin = Math.min(valMin, ...valoresGlobal);
          valMax = Math.max(valMax, ...valoresGlobal);
        }
        if (objetivos.length > 0) {
          valMin = Math.min(valMin, ...objetivos);
          valMax = Math.max(valMax, ...objetivos);
        } else {
          valMin = Math.min(valMin, 90);
          valMax = Math.max(valMax, 90);
        }

        const margen = 2.0;
        let yMin = Math.max(0, Math.round(valMin - margen));
        let yMax = Math.min(100, Math.round(valMax + margen));
        if (valMin < yMin) yMin = Math.floor(valMin);
        if (valMax > yMax) yMax = Math.ceil(valMax);
        if (yMax - yMin < 4) {
          const centro = (yMax + yMin) / 2;
          yMin = Math.max(0, Math.floor(centro - 2));
          yMax = Math.min(100, Math.ceil(centro + 2));
        }
        escalaCompartida = { yMin, yMax };
      }
    }

    // Gráfico de calidad global (usa la escala de parcial de 5 en 5 si existe)
    renderizarGraficoCalidad('chartCalidadGlobal', 'global', lineasAMostrar, s, escalaCompartida);

    // El gráfico de calidad parcial solo se dibuja en modo turno (en modo día
    // el panel está oculto y el global ocupa todo el ancho).
    if (!esModoDia) {
      renderizarGraficoCalidad('chartCalidadParcial', 'parcial', lineasAMostrar, s, escalaCompartida);
    }
  } catch (error) {
    console.error('Error al renderizar gráficos de calidad:', error);
  }
}

/**
 * Renderiza un gráfico específico de calidad (global o parcial).
 * Utiliza escala de categorías robusta nativa de Chart.js 4.
 * Puntos y segmentos: verde cuando están sobre el objetivo, rojo cuando están debajo.
 * Incluye línea horizontal de objetivo y etiquetas legibles en cada punto.
 */
function renderizarGraficoCalidad(canvasId, tipoCalidad, lineasConDatos, s, escalaCompartida = null) {
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
    if (window.Chart && typeof window.Chart.getChart === 'function') {
      const existing = window.Chart.getChart(canvas);
      if (existing) existing.destroy();
    }
    const chartKey = canvasId + 'Chart';
    if (window[chartKey]) {
      try { window[chartKey].destroy(); } catch {}
      window[chartKey] = null;
    }

    // Extraer lecturas válidas por cada línea
    const datosPorLinea = [];
    const todasHoras = [];

    lineasConDatos.forEach((item, idx) => {
      const { linea, objetivos } = item;
      const tomas = (objetivos?.tomasCalidad || []).map((t, i) => ({
        hora: (t?.hora || '').trim() || `Toma ${i + 1}`,
        global: (t?.global != null && !isNaN(Number(t.global))) ? Number(t.global) : null,
        parcial: (t?.parcial1 != null && !isNaN(Number(t.parcial1))) ? Number(t.parcial1) : ((t?.parcial != null && !isNaN(Number(t.parcial))) ? Number(t.parcial) : null)
      }));

      const legacy = (objetivos?.lecturasCalidad || []).map((l, i) => ({
        hora: (l?.hora || '').trim() || `Toma ${i + 1}`,
        global: (l?.global != null && !isNaN(Number(l.global))) ? Number(l.global) : null,
        parcial: (l?.parcial != null && !isNaN(Number(l.parcial))) ? Number(l.parcial) : null
      }));

      const tieneTomas = tomas.some(t => t.global !== null || t.parcial !== null);
      const fuente = tieneTomas ? tomas : legacy;

      const lecturas = fuente.map(item => ({
        hora: item.hora,
        valor: tipoCalidad === 'global' ? item.global : item.parcial
      })).filter(l => l.valor !== null);

      const objetivo = Number(objetivos?.calidad) || 90;

      if (lecturas.length > 0) {
        lecturas.forEach(l => {
          if (!todasHoras.includes(l.hora)) todasHoras.push(l.hora);
        });
        datosPorLinea.push({
          linea,
          objetivo,
          lecturas,
          idx
        });
      }
    });

    if (datosPorLinea.length === 0 || todasHoras.length === 0) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = '13px sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'center';
        ctx.fillText(`Sin lecturas de calidad ${tipoCalidad} registradas`, canvas.width / 2, canvas.height / 2);
      }
      return;
    }

    // Determinar valores para dimensionar eje Y con margen estrecho y dinámico (±2.0%)
    const todosValores = [];
    const objetivosLineas = [];

    datosPorLinea.forEach(dl => {
      dl.lecturas.forEach(l => {
        if (l.valor !== null && l.valor !== undefined && !isNaN(l.valor)) {
          todosValores.push(Number(l.valor));
        }
      });
      if (dl.objetivo > 0) objetivosLineas.push(Number(dl.objetivo));
    });

    let yMin, yMax;
    if (escalaCompartida && escalaCompartida.yMin != null && escalaCompartida.yMax != null) {
      // Usar la escala compartida calculada a partir de Calidad Parcial (ambos gráficos iguales)
      yMin = escalaCompartida.yMin;
      yMax = escalaCompartida.yMax;
      // Resguardo: si este gráfico tiene alguna lectura que sobrepase la escala, expandir
      if (todosValores.length > 0) {
        const minP = Math.min(...todosValores);
        const maxP = Math.max(...todosValores);
        if (minP < yMin) yMin = Math.max(0, Math.floor(minP - 2.0));
        if (maxP > yMax) yMax = Math.min(100, Math.ceil(maxP + 2.0));
      }
    } else {
      const valoresMuestreo = [...todosValores];
      if (objetivosLineas.length > 0) {
        valoresMuestreo.push(...objetivosLineas);
      } else {
        valoresMuestreo.push(90);
      }

      const valorMinimo = Math.min(...valoresMuestreo);
      const valorMaximo = Math.max(...valoresMuestreo);
      const margenMuestreo = 2.0;

      yMin = Math.max(0, Math.round(valorMinimo - margenMuestreo));
      yMax = Math.min(100, Math.round(valorMaximo + margenMuestreo));
      if (valorMinimo < yMin) yMin = Math.floor(valorMinimo);
      if (valorMaximo > yMax) yMax = Math.ceil(valorMaximo);

      // Si el rango es menor a 4 (ej: lecturas constantes o una sola toma), expandir alrededor del centro
      if (yMax - yMin < 4) {
        const centro = (yMax + yMin) / 2;
        yMin = Math.max(0, Math.floor(centro - 2));
        yMax = Math.min(100, Math.ceil(centro + 2));
      }
    }

    // Paleta de colores pasteles armónicos para múltiples líneas
    const paletaLineas = [
      { border: 'rgb(52, 211, 153)', bg: 'rgba(52, 211, 153, 0.15)' }, // Menta pastel
      { border: 'rgb(96, 165, 250)', bg: 'rgba(96, 165, 250, 0.15)' }, // Celeste pastel
      { border: 'rgb(167, 139, 250)', bg: 'rgba(167, 139, 250, 0.15)' }, // Lavanda pastel
      { border: 'rgb(251, 146, 60)', bg: 'rgba(251, 146, 60, 0.15)' }  // Melocotón pastel
    ];

    // Construir datasets
    const datasets = datosPorLinea.map((dl, dIdx) => {
      const objetivo = dl.objetivo;
      const data = todasHoras.map(h => {
        const item = dl.lecturas.find(l => l.hora === h);
        return item ? item.valor : null;
      });

      const colorBase = paletaLineas[dIdx % paletaLineas.length];

      return {
        label: dl.linea?.nombre || `Línea ${dIdx + 1}`,
        data: data,
        borderColor: function(context) {
          const chart = context.chart;
          const { ctx, chartArea, scales } = chart;
          if (!chartArea || !scales || !scales.y) {
            return 'rgb(52, 211, 153)';
          }
          const yPixel = scales.y.getPixelForValue(objetivo);
          const top = chartArea.top;
          const bottom = chartArea.bottom;
          if (bottom <= top || isNaN(yPixel)) return 'rgb(52, 211, 153)';

          if (yPixel <= top) return 'rgb(251, 113, 133)';   // Todo está por debajo del objetivo (rosa pastel)
          if (yPixel >= bottom) return 'rgb(52, 211, 153)'; // Todo está por encima del objetivo (verde menta)

          const stop = Math.max(0, Math.min(1, (yPixel - top) / (bottom - top)));
          const gradient = ctx.createLinearGradient(0, top, 0, bottom);
          gradient.addColorStop(0, 'rgb(52, 211, 153)');     // Verde arriba del objetivo
          gradient.addColorStop(stop, 'rgb(52, 211, 153)');  // Verde hasta el corte del objetivo
          gradient.addColorStop(stop, 'rgb(251, 113, 133)'); // Rosa pastel desde el corte del objetivo
          gradient.addColorStop(1, 'rgb(251, 113, 133)');    // Rosa pastel por debajo del objetivo
          return gradient;
        },
        backgroundColor: 'rgba(52, 211, 153, 0.1)',
        borderWidth:3.5,
        tension: 0,
        fill: false,
        spanGaps: true,
        pointRadius: 6,
        pointHoverRadius: 8,
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        pointBackgroundColor: function(context) {
          const val = context.parsed?.y ?? (typeof context.raw === 'object' ? context.raw?.y : context.raw);
          if (val == null) return 'rgb(203, 213, 225)';
          return val >= objetivo ? 'rgb(52, 211, 153)' : 'rgb(251, 113, 133)';
        },
        pointHoverBackgroundColor: function(context) {
          const val = context.parsed?.y ?? (typeof context.raw === 'object' ? context.raw?.y : context.raw);
          if (val == null) return 'rgb(203, 213, 225)';
          return val >= objetivo ? 'rgb(52, 211, 153)' : 'rgb(251, 113, 133)';
        }
      };
    });

    // Quiebres de producto / formato / ciclo
    const quiebresGrafico = [];
    lineasConDatos.forEach(item => {
      const quiebres = item.objetivos?.quiebresProducto || [];
      quiebres.forEach(q => {
        if (!q.hora) return;
        const tipo = q.tipo === 'ciclo' ? 'ciclo' : 'producto';
        const etiqueta = tipo === 'ciclo'
          ? `Ciclo ${q.cicloNuevo || ''}min`
          : (q.productoNuevo || 'Cambio');
        quiebresGrafico.push({ hora: q.hora, etiqueta, tipo });
      });
    });

    // Crear instancia de Chart.js
    window[chartKey] = new Chart(canvas, {
      type: 'line',
      data: {
        labels: todasHoras,
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
            display: false
          },
          etiquetasBarras: {
            display: false
          },
          tooltip: {
            enabled: true,
            backgroundColor: 'rgba(15, 23, 42, 0.9)',
            titleColor: '#fff',
            bodyColor: '#fff',
            borderColor: '#334155',
            borderWidth: 1,
            padding: 10,
            displayColors: true,
            callbacks: {
              label: function(context) {
                const valor = context.parsed?.y ?? context.raw;
                if (valor == null) return '';
                const dl = datosPorLinea[context.datasetIndex];
                const obj = dl?.objetivo || 90;
                const estado = valor >= obj ? '✓ Sobre objetivo' : '✗ Bajo objetivo';
                return `${context.dataset.label}: ${Number(valor).toFixed(2)}% (${estado})`;
              }
            }
          },
          legend: {
            display: datasets.length > 1,
            position: 'top',
            labels: { boxWidth: 12, font: { size: 11 } }
          }
        },
        layout: {
          padding: {
            top: 14,
            bottom: 4,
            left: 4,
            right: 14
          }
        },
        scales: {
          y: {
            min: yMin,
            max: yMax,
            ticks: {
              stepSize: 5,
              maxTicksLimit: 7,
              callback: (value) => {
                return Math.round(Number(value)) + '%';
              },
              font: { size: 11 }
            },
            grid: {
              color: 'rgba(148, 163, 184, 0.15)'
            }
          },
          x: {
            grid: {
              color: 'rgba(148, 163, 184, 0.1)'
            },
            ticks: {
              font: { size: 11, weight: 'bold' },
              autoSkip: false,
              maxRotation: 0,
              minRotation: 0
            }
          }
        }
      },
      plugins: [{
        // Dibuja el valor de calidad (%) encima de cada punto con contorno blanco legible
        id: 'etiquetasCalidad',
        afterDatasetsDraw(chart) {
          const ctx = chart.ctx;
          chart.data.datasets.forEach((dataset, dsIdx) => {
            const meta = chart.getDatasetMeta(dsIdx);
            if (meta.hidden) return;
            meta.data.forEach((punto, idx) => {
              const valor = dataset.data[idx];
              if (valor === null || valor === undefined || isNaN(valor)) return;

              ctx.save();
              ctx.font = 'bold 12px Segoe UI, Arial, sans-serif';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'bottom';
              ctx.lineJoin = 'round';
              ctx.lineWidth = 3;
              ctx.strokeStyle = '#ffffff';
              ctx.fillStyle = '#0f172a';
              const texto = `${Number(valor).toFixed(1)}%`;
              ctx.strokeText(texto, punto.x, punto.y - 8);
              ctx.fillText(texto, punto.x, punto.y - 8);
              ctx.restore();
            });
          });
        }
      }, {
        // Línea horizontal del objetivo
        id: 'lineaObjetivo',
        afterDatasetsDraw(chart) {
          const ctx = chart.ctx;
          const yScale = chart.scales.y;
          const xScale = chart.scales.x;
          if (!yScale || !xScale) return;

          const objetivosUnicos = [...new Set(objetivosLineas.filter(o => o > 0))];
          objetivosUnicos.forEach((objetivo) => {
            const yPixel = yScale.getPixelForValue(objetivo);
            if (yPixel == null || isNaN(yPixel)) return;
            const xStart = xScale.left;
            const xEnd = xScale.right;

            ctx.save();
            ctx.strokeStyle = 'rgb(125, 211, 252)'; // Celeste pastel suave
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            ctx.moveTo(xStart, yPixel);
            ctx.lineTo(xEnd, yPixel);
            ctx.stroke();
            ctx.restore();

            ctx.save();
            ctx.fillStyle = 'rgb(71, 85, 105)';
            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'bottom';
            ctx.fillText(`Objetivo: ${objetivo}%`, xEnd - 5, yPixel - 5);
            ctx.restore();
          });
        }
      }, {
        // Marcas verticales de "quiebre": cambios de producto / formato / ciclo
        id: 'quiebresProducto',
        afterDatasetsDraw(chart) {
          if (!quiebresGrafico.length) return;
          const ctx = chart.ctx;
          const xScale = chart.scales.x;
          const yScale = chart.scales.y;
          if (!xScale || !yScale) return;

          quiebresGrafico.forEach(q => {
            const idx = chart.data.labels.indexOf(q.hora);
            if (idx === -1) return;
            const xPixel = xScale.getPixelForValue(idx);
            if (xPixel == null || isNaN(xPixel)) return;

            const yTop = yScale.top;
            const yBottom = yScale.bottom;
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

// ==========================================================
// EXPOSICIÓN A window
// ----------------------------------------------------------
// cambiarAreaMonitoreada: llamada desde onchange="..." en index.html.
// ==========================================================
window.cambiarAreaMonitoreada = cambiarAreaMonitoreada;
window.cambiarPeriodoVista = cambiarPeriodoVista;
// Expuesto para que cargaCalidad.js refresque el dashboard tras enviar una
// toma (sin crear dependencia circular de import).
window.renderTodo = renderTodo;
window.renderVistaPlanta = renderVistaPlanta;
window.renderFotosCalidadVistaPlanta = renderFotosCalidadVistaPlanta;
window.renderAccionesProduccionVistaPlanta = renderAccionesProduccionVistaPlanta;


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
      const lineas = lineasActivas();
      for (const lin of lineas) {
        const lects = s.objetivos?.porLinea?.[lin.id]?.lecturasDefectos || [];
        if (lects.length > 0) {
          lecturasDefectos = lects;
          lineaUsada = lin.id;
          console.log(`Usando lecturas de ${lin.nombre} para vista consolidada`);
          break;
        }
      }
    } else {
      lecturasDefectos = s.objetivos?.porLinea?.[lineaSeleccionada]?.lecturasDefectos || [];
      lineaUsada = lineaSeleccionada;
    }

    // Fallback: Si no hay lecturasDefectos precalculadas, reconstruir desde tomasCalidad
    if (!lecturasDefectos.length) {
      const lineasBuscar = (lineaSeleccionada === 'TODAS')
        ? (lineaUsada ? [lineaPorId(lineaUsada)] : lineasActivas()).filter(Boolean)
        : [lineaPorId(lineaSeleccionada)].filter(Boolean);

      for (const lin of lineasBuscar) {
        const o = s.objetivos?.porLinea?.[lin.id];
        if (o && Array.isArray(o.tomasCalidad)) {
          const reconstruidas = o.tomasCalidad
            .filter(t => (t.defectos || []).some(d => (d.nombre || '').trim() && (d.pct != null || d.porcentaje != null)))
            .map((t, idx) => ({
              hora: (t.hora || '').trim() || `Toma ${idx + 1}`,
              defectos: (t.defectos || [])
                .filter(d => (d.nombre || '').trim() && (d.pct != null || d.porcentaje != null))
                .map(d => ({
                  nombre: String(d.nombre).trim(),
                  porcentaje: Number(d.pct != null ? d.pct : d.porcentaje)
                }))
            }));
          if (reconstruidas.length > 0) {
            lecturasDefectos = reconstruidas;
            lineaUsada = lin.id;
            break;
          }
        }
      }
    }

    console.log('Lecturas encontradas:', lecturasDefectos.length, lecturasDefectos);

    // Si no hay lecturas, mostrar mensaje amigable en canvas y retornar
    if (!lecturasDefectos.length) {
      console.log('No hay lecturas de defectos disponibles');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = '13px sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'center';
        ctx.fillText('Sin lecturas de defectos registradas para este turno', canvas.width / 2, canvas.height / 2);
      }
      return;
    }

    // Eje X: determinar horas (horas de turno fijas si coinciden, o las horas de las lecturas)
    const turnoHoras = HORAS_TURNO[s.turno] || HORAS_TURNO['Mañana'];
    const horasLecturas = lecturasDefectos.map(l => l.hora).filter(Boolean);
    const todasEnTurno = horasLecturas.length > 0 && horasLecturas.every(h => turnoHoras.includes(h));
    const horas = todasEnTurno ? turnoHoras : (horasLecturas.length > 0 ? horasLecturas : turnoHoras);
    console.log('Horas del turno / eje X:', horas);

    // Paleta de colores pasteles suaves y distintivos para los defectos
    const colores = [
      { border: '#f87171', bg: 'rgba(248, 113, 113, 0.15)' }, // Coral pastel
      { border: '#fb923c', bg: 'rgba(251, 146, 60, 0.15)' }, // Melocotón / Naranja pastel
      { border: '#a78bfa', bg: 'rgba(167, 139, 250, 0.15)' }, // Lavanda pastel
      { border: '#60a5fa', bg: 'rgba(96, 165, 250, 0.15)' }, // Celeste pastel
      { border: '#34d399', bg: 'rgba(52, 211, 153, 0.15)' }, // Menta pastel
      { border: '#fcd34d', bg: 'rgba(252, 211, 77, 0.15)' }, // Ámbar pastel
      { border: '#f472b6', bg: 'rgba(244, 114, 182, 0.15)' }  // Rosa pastel
    ];

    // Orden de llegada de defectos al Top 4: el primer defecto que entró al Top 4
    // conserva el color 0 (coral pastel), el segundo el 1 (melocotón pastel), etc. Si un defecto
    // ya no está entre los 4 primeros de la hora actual, su color NO se reasigna
    // a otro: cada defecto mantiene su color asignado permanentemente en el turno.
    if (!window._ordenDefectosHistorico) window._ordenDefectosHistorico = {};
    const keyTurnoDef = `${s.fechaOperativa || ''}_${s.turno || ''}`;
    // Normalizar y sanear orden histórico para que no tenga nombres duplicados o no canónicos
    if (window._ordenDefectosHistorico[keyTurnoDef]) {
      window._ordenDefectosHistorico[keyTurnoDef] = window._ordenDefectosHistorico[keyTurnoDef]
        .map(nom => formatearNombreDefecto(nom))
        .filter((nom, idx, arr) => nom && arr.indexOf(nom) === idx);
    } else {
      window._ordenDefectosHistorico[keyTurnoDef] = [];
    }
    const ordenHistorico = window._ordenDefectosHistorico[keyTurnoDef];

    // Recorrer las tomas cronológicamente para registrar qué defectos entraron
    // al Top 4 y en qué orden.
    const tomasOrdenadas = [...lecturasDefectos].sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));
    tomasOrdenadas.forEach(toma => {
      const defsMap = normalizarDefectosAMap(toma.defectos);
      const topToma = Object.entries(defsMap)
        .filter(([_, v]) => v != null && v > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4);
      topToma.forEach(([nombre]) => {
        const nomCanonica = formatearNombreDefecto(nombre);
        if (nomCanonica && !ordenHistorico.includes(nomCanonica)) {
          ordenHistorico.push(nomCanonica);
        }
      });
    });

    // Colores asignados por orden de entrada al Top 4 histórico.
    const mapaColores = {};
    ordenHistorico.forEach((nom, idx) => {
      mapaColores[nom] = idx < colores.length
        ? colores[idx]
        : {
            border: `hsl(${(idx * 55 + 180) % 360}, 60%, 65%)`,
            bg: `hsla(${(idx * 55 + 180) % 360}, 60%, 65%, 0.15)`
          };
    });

    // Obtener todos los defectos que pertenecieron al Top 4 en alguna hora.
    const defectosHistoricos = [...ordenHistorico];

    // Mapear lecturas por hora normalizadas a mapa { defecto: porcentaje }
    const lecturasPorHora = {};
    lecturasDefectos.forEach(l => {
      if (l.hora) {
        lecturasPorHora[l.hora] = normalizarDefectosAMap(l.defectos);
      }
    });

    // Encontrar la última hora que tiene datos registrados
    let ultimaHoraConDatos = -1;
    for (let i = horas.length - 1; i >= 0; i--) {
      if (lecturasPorHora[horas[i]] && Object.keys(lecturasPorHora[horas[i]]).length > 0) {
        ultimaHoraConDatos = i;
        break;
      }
    }

    // Identificar las tomas válidas que tienen defectos registrados
    const tomasValidas = horas
      .map(h => ({ hora: h, defectos: lecturasPorHora[h] }))
      .filter(x => x.defectos && Object.keys(x.defectos).length > 0);

    // Identificar los defectos de la toma actual (última toma registrada) para la leyenda
    let top4TomaActual = [];
    if (tomasValidas.length > 0) {
      const tomaActual = tomasValidas[tomasValidas.length - 1];
      top4TomaActual = Object.entries(tomaActual.defectos || {})
        .filter(([_, v]) => v != null && v > 0)
        .sort((a, b) => (b[1] || 0) - (a[1] || 0))
        .slice(0, 4)
        .map(e => formatearNombreDefecto(e[0]));
    }

    // Para que el gráfico de evolución muestre la historia hora a hora continua de las tomas anteriores,
    // construimos datasets para todos los defectos que hayan aparecido en el Top 4 del turno (ordenHistorico).
    let listaDefectosFinal = ordenHistorico.length > 0 ? [...ordenHistorico] : (top4TomaActual.length > 0 ? [...top4TomaActual] : []);

    if (listaDefectosFinal.length === 0 && Array.isArray(defectos) && defectos.length > 0) {
      listaDefectosFinal = defectos
        .filter(d => d.porcentaje != null && d.porcentaje > 0)
        .sort((a, b) => b.porcentaje - a.porcentaje)
        .slice(0, 4)
        .map(d => formatearNombreDefecto(d.nombre));
    }

    // Construir datasets para los defectos del Top 4 de la toma actual
    const datasets = listaDefectosFinal.map((nombre) => {
      const color = mapaColores[nombre] || { border: '#64748b', bg: 'rgba(100, 116, 139, 0.1)' };

      // Datos hora a hora del defecto seleccionado
      const data = horas.map((h, i) => {
        if (ultimaHoraConDatos >= 0 && i > ultimaHoraConDatos) {
          return null;
        }

        const tomaActual = lecturasPorHora[h];
        if (!tomaActual) return null;

        const val = tomaActual[nombre];
        return (val != null && !isNaN(val)) ? val : null;
      });

      // Último valor válido registrado (para la leyenda)
      let ultimoValor = null;
      for (let i = data.length - 1; i >= 0; i--) {
        if (data[i] !== null && data[i] !== undefined && !isNaN(data[i])) {
          ultimoValor = data[i];
          break;
        }
      }

      const abrev = obtenerAbreviaturaDefecto(nombre);
      const nombreDisplay = formatearNombreDefecto(nombre);

      // Etiqueta para la leyenda (ej: "G - GRUMO (3.2%)")
      const labelConValor = ultimoValor !== null 
        ? `${nombreDisplay} (${ultimoValor.toFixed(1)}%)`
        : nombreDisplay;

      return {
        label: labelConValor,
        nombreDisplay: nombreDisplay,
        nombreDefecto: nombre,
        abrev: abrev,
        data: data,
        borderColor: color.border,
        backgroundColor: color.bg,
        borderWidth: 2.5,
        tension: 0.3,
        spanGaps: false, // No unir el punto anterior con el siguiente cuando sale del Top 4.
        pointRadius: 5,
        pointHoverRadius: 7,
        pointBackgroundColor: color.border,
        pointBorderColor: color.border,
        pointBorderWidth: 0,
        pointHoverBackgroundColor: color.border,
        pointHoverBorderColor: color.border
      };
    });

    if (datasets.length === 0) {
      console.log('No hay defectos históricos que hayan pertenecido al Top 4');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = '13px sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'center';
        ctx.fillText('Sin defectos registrados en el Top 4', canvas.width / 2, canvas.height / 2);
      }
      return;
    }

    console.log('Datasets construidos:', datasets);

    // Determinar rango simétrico alrededor de la referencia (1%):
    // La referencia queda en el medio visual del eje Y (igual que en los
    // gráficos de Calidad Global y Calidad Parcial).
    const refDefectos = 1.0;
    const todosLosValores = datasets.flatMap(d => d.data).filter(v => v !== null && v !== undefined);
    let yMinDef = 0;
    let yMaxDef = 2.0;

    if (todosLosValores.length > 0) {
      const maxVal = Math.max(...todosLosValores);
      const minVal = Math.min(...todosLosValores);
      const desvioMax = Math.max(
        Math.abs(maxVal - refDefectos),
        Math.abs(refDefectos - minVal),
        0.5 // Rango mínimo de ±0.5% para que no quede plano
      );
      const margen = Math.max(desvioMax * 1.25, 0.5);
      yMinDef = Math.max(0, parseFloat((refDefectos - margen).toFixed(1)));
      yMaxDef = parseFloat((refDefectos + margen).toFixed(1));
    } else {
      yMinDef = 0;
      yMaxDef = 2.0;
    }

    // Asegurar que ningún valor quede fuera del rango
    if (todosLosValores.length > 0) {
      const maxVal = Math.max(...todosLosValores);
      const margen = 0.5;
      if (maxVal > yMaxDef) {
        yMaxDef = maxVal + margen;
      }
    }

    // Si aún así no alcanza, expandir
    const maxVal = todosLosValores.length > 0 ? Math.max(...todosLosValores) : 0;
    if (maxVal > yMaxDef) {
      const margen = 0.5;
      yMaxDef = maxVal + margen;
    }

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
          etiquetasBarras: {
            display: false
          },
          tooltip: {
            enabled: true,
            backgroundColor: 'rgba(15, 23, 42, 0.92)',
            titleColor: '#fff',
            bodyColor: '#fff',
            borderColor: '#475569',
            borderWidth: 1,
            padding: 10,
            bodySpacing: 6,
            displayColors: true,
            callbacks: {
              title: function(context) {
                if (!context.length) return '';
                const hora = context[0].label;
                return `Hora: ${hora} hs`;
              },
              label: function(context) {
                const valorActual = context.parsed.y;
                if (valorActual === null || valorActual === undefined || isNaN(valorActual)) return '';
                const datasetIndex = context.datasetIndex;
                const dataIndex = context.dataIndex;
                const dataset = context.chart.data.datasets[datasetIndex];
                const nombreDisplay = dataset.nombreDisplay || formatearNombreDefecto(dataset.label);
                
                let label = `${nombreDisplay} ${valorActual.toFixed(1)}%`;
                
                // Calcular diferencia con la lectura anterior VÁLIDA de este mismo defecto
                if (dataIndex > 0 && Array.isArray(dataset.data)) {
                  let valorAnterior = null;
                  for (let i = dataIndex - 1; i >= 0; i--) {
                    const v = dataset.data[i];
                    if (v !== null && v !== undefined && !isNaN(v)) {
                      valorAnterior = v;
                      break;
                    }
                  }
                  
                  if (valorAnterior !== null) {
                    const diferencia = valorActual - valorAnterior;
                    if (Math.abs(diferencia) >= 0.05) {
                      const simbolo = diferencia > 0 ? '↑' : '↓';
                      label += `  ${simbolo}${Math.abs(diferencia).toFixed(1)}%`;
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
              usePointStyle: true,
              filter: function(item, chartData) {
                if (!top4TomaActual || !top4TomaActual.length) return true;
                const ds = chartData.datasets[item.datasetIndex];
                const nom = ds?.nombreDefecto || ds?.nombreDisplay;
                return top4TomaActual.includes(nom);
              }
            }
          }
        },
        scales: {
          y: {
            // Rango centrado en el objetivo (queda en el medio del gráfico).
            min: yMinDef,
            max: yMaxDef,
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

          // Línea de referencia fina (1%): guía visual, no un objetivo.
          const yPixel = yScale.getPixelForValue(refDefectos);
          const xStart = xScale.left;
          const xEnd = xScale.right;

          ctx.save();
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.7)'; // Gris tenue
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(xStart, yPixel);
          ctx.lineTo(xEnd, yPixel);
          ctx.stroke();
          ctx.restore();

          // Etiqueta de la referencia
          ctx.fillStyle = 'rgb(100, 116, 139)';
          ctx.font = 'bold 9px sans-serif';
          ctx.textAlign = 'right';
          ctx.fillText(`Ref. ${refDefectos}%`, xEnd - 5, yPixel - 4);
        }
      }, {
        // Muestra la abreviatura del defecto + porcentaje (y delta si cambió) en cada punto
        id: 'etiquetasPuntosDefectos',
        afterDatasetsDraw(chart) {
          const ctx = chart.ctx;
          const posicionesOcupadas = [];

          chart.data.datasets.forEach((dataset, dsIdx) => {
            const meta = chart.getDatasetMeta(dsIdx);
            if (meta.hidden) return;
            const abrev = dataset.abrev || obtenerAbreviaturaDefecto(dataset.nombreDefecto || dataset.label);

            meta.data.forEach((punto, idx) => {
              const valor = dataset.data[idx];
              if (valor === null || valor === undefined || isNaN(valor)) return;

              let yPos = punto.y - 9;
              // Si el punto está pegado al techo del gráfico, mostrar etiqueta debajo
              if (chart.chartArea && yPos < chart.chartArea.top + 14) {
                yPos = punto.y + 15;
              }

              // Evitar superposiciones entre puntos coincidentes o muy cercanos de distintos defectos
              const colision = posicionesOcupadas.find(p =>
                Math.abs(p.x - punto.x) < 42 && Math.abs(p.y - yPos) < 13
              );
              if (colision) {
                yPos = colision.y < punto.y ? punto.y + 15 : punto.y - 20;
              }
              posicionesOcupadas.push({ x: punto.x, y: yPos });

              ctx.save();
              ctx.font = 'bold 10px Segoe UI, Arial, sans-serif';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.lineJoin = 'round';
              ctx.lineWidth = 3;
              ctx.strokeStyle = '#ffffff';
              ctx.fillStyle = '#0f172a'; // Color oscuro para máxima visibilidad en fondo blanco
              const texto = abrev 
                ? `${abrev} ${Number(valor).toFixed(1)}%` 
                : `${Number(valor).toFixed(1)}%`;
              ctx.strokeText(texto, punto.x, yPos);
              ctx.fillText(texto, punto.x, yPos);
              ctx.restore();
            });
          });
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
// Expuesto para que cargaCalidad.js refresque el dashboard tras enviar una
// toma (sin crear dependencia circular de import).
window.renderTodo = renderTodo;
window.renderVistaPlanta = renderVistaPlanta;
