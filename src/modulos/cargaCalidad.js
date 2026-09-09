/* ========================================================== */
/* CARGA-CALIDAD.JS — Sinóptico de carga de calidad           */
/* ========================================================== */
/*
  Panel EMBEBIDO en la vista principal (dashboard) donde el
  operario de calidad carga la planilla del turno, sin modales.

  - La línea es la elegida en "Área monitoreada" (#lineaVista).
  - Hay 8 TOMAS preestablecidas (+ botón para agregar más). Cada
    toma es una tarjeta apilada (no columnas) con UNA sola hora
    (precargada con la del sistema, editable) de la que cuelga
    TODO lo cargado en ese horario:
      · calidad global %, calidad parcial %, tono, m² clasificados,
        vacío de horno (min), % de 2da
      · mini-form de defectos: nombre + % + aclaración, con
        "+ agregar defecto" para varios en la misma hora
      · mini-form de rotura: % total + defectos que fueron a
        rotura (nombre + %), con "+ agregar"
      · acciones de calidad (texto), con "+ agregar acción"
      · fotos de defectos (drag & drop / archivo), comprimidas a
        base64 y guardadas en la toma
  - GUARDADO AUTOMÁTICO: cada cambio persiste solo (onchange). El
    botón "Enviar datos" marca la toma como enviada para que se
    refleje en Vista de Planta bajo su hora. Todo es editable y
    eliminable.

  Se renderiza desde renderTodo() (vistaDePlanta.js) dentro de
  #panelCalidadInline, visible solo para el rol calidad
  (data-cap="cargarCalidad" en index.html).
*/

import { esc, valor } from '../nucleo/utilidades.js';
import { persistir } from '../nucleo/almacenamiento.js';
import { mostrarAlertaKira } from '../nucleo/alertasKira.js';
import {
  sesion, lineasActivas, lineaPorId, nombreLinea, asegurarObjetivosSesion,
  crearTomaCalidad
} from '../nucleo/estado.js';
import { asegurarDefectosSesion } from './gestionDefectos.js';

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------
const numOrNull = v => (v === '' || v === null || v === undefined || isNaN(parseFloat(v))) ? null : parseFloat(v);

/** Hora actual del sistema en formato HH:MM (para precargar tomas nuevas). */
function horaSistema() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Línea de calidad actualmente en edición: la de "Área monitoreada". */
function lineaCalidadActual() {
  const l = valor('lineaVista');
  if (!l || l === 'TODAS' || l === 'GENERAL') return lineasActivas()[0]?.id || '';
  return lineaPorId(l) ? l : (lineasActivas()[0]?.id || '');
}

/** Objeto de objetivos/calidad de la línea en edición (garantizando estructura). */
function objDe(lineaId) {
  const s = sesion();
  asegurarObjetivosSesion(s);
  return s.objetivos.porLinea[lineaId];
}

/** Toma i de la línea (o null). */
function tomaDe(lineaId, i) {
  const o = objDe(lineaId);
  return Array.isArray(o.tomasCalidad) ? o.tomasCalidad[i] : null;
}

const numAttr = v => (v != null && !isNaN(v)) ? v : '';

/** Input de un campo simple de la toma, con guardado automático. */
function inputToma(lineaId, i, sub, tipo, valorActual, extraClass = '', placeholder = '', step = '') {
  const v = tipo === 'time' ? (valorActual || '') : numAttr(valorActual);
  const stepAttr = step ? `step="${step}"` : '';
  return `<input type="${tipo}" ${stepAttr} value="${esc(String(v))}" placeholder="${esc(placeholder)}"
    class="field text-xs p-1 mt-0.5 ${extraClass}" onchange="onCambioCalidad(this)"
    data-cal-linea="${lineaId}" data-cal-toma="${i}" data-cal-sub="${sub}">`;
}

/** Filas del mini-form de DEFECTOS (nombre + % + aclaración). */
function htmlDefectos(lineaId, i, defectos) {
  const filas = defectos.map((d, j) => `
    <div class="flex flex-wrap items-center gap-1 mb-1">
      <input type="text" value="${esc(d.nombre || '')}" placeholder="Defecto"
        class="field text-[11px] p-1 flex-1 min-w-[110px]" onchange="onCambioLista(this)"
        data-cal-linea="${lineaId}" data-cal-toma="${i}" data-cal-lista="defectos" data-cal-fila="${j}" data-cal-campo="nombre">
      <input type="number" step="0.01" min="0" value="${numAttr(d.pct)}" placeholder="%"
        class="field text-[11px] p-1 w-16" onchange="onCambioLista(this)"
        data-cal-linea="${lineaId}" data-cal-toma="${i}" data-cal-lista="defectos" data-cal-fila="${j}" data-cal-campo="pct">
      <input type="text" value="${esc(d.aclaracion || '')}" placeholder="Aclaración (opcional)"
        class="field text-[11px] p-1 flex-1 min-w-[120px]" onchange="onCambioLista(this)"
        data-cal-linea="${lineaId}" data-cal-toma="${i}" data-cal-lista="defectos" data-cal-fila="${j}" data-cal-campo="aclaracion">
      <button type="button" class="text-rose-500 font-bold text-sm px-1" title="Eliminar defecto"
        onclick="quitarFilaCalidad('${lineaId}', ${i}, 'defectos', ${j})">✕</button>
    </div>`).join('');
  return `${filas}
    <button type="button" class="text-[11px] font-bold text-rose-600 hover:underline"
      onclick="agregarFilaCalidad('${lineaId}', ${i}, 'defectos')">+ agregar defecto</button>`;
}

/** Filas del mini-form de ROTURA por defecto (nombre + %). */
function htmlRoturas(lineaId, i, roturas) {
  const filas = roturas.map((d, j) => `
    <div class="flex flex-wrap items-center gap-1 mb-1">
      <input type="text" value="${esc(d.nombre || '')}" placeholder="Defecto a rotura"
        class="field text-[11px] p-1 flex-1 min-w-[110px]" onchange="onCambioLista(this)"
        data-cal-linea="${lineaId}" data-cal-toma="${i}" data-cal-lista="roturas" data-cal-fila="${j}" data-cal-campo="nombre">
      <input type="number" step="0.01" min="0" value="${numAttr(d.pct)}" placeholder="%"
        class="field text-[11px] p-1 w-16" onchange="onCambioLista(this)"
        data-cal-linea="${lineaId}" data-cal-toma="${i}" data-cal-lista="roturas" data-cal-fila="${j}" data-cal-campo="pct">
      <input type="text" value="${esc(d.aclaracion || '')}" placeholder="Aclaración (opcional)"
        class="field text-[11px] p-1 flex-1 min-w-[120px]" onchange="onCambioLista(this)"
        data-cal-linea="${lineaId}" data-cal-toma="${i}" data-cal-lista="roturas" data-cal-fila="${j}" data-cal-campo="aclaracion">
      <button type="button" class="text-rose-500 font-bold text-sm px-1" title="Eliminar"
        onclick="quitarFilaCalidad('${lineaId}', ${i}, 'roturas', ${j})">✕</button>
    </div>`).join('');
  return `${filas}
    <button type="button" class="text-[11px] font-bold text-slate-600 hover:underline"
      onclick="agregarFilaCalidad('${lineaId}', ${i}, 'roturas')">+ agregar defecto a rotura</button>`;
}

/** Filas del mini-form de ACCIONES (texto libre). */
function htmlAcciones(lineaId, i, acciones) {
  const filas = acciones.map((a, j) => `
    <div class="flex items-center gap-1 mb-1">
      <input type="text" value="${esc(a || '')}" placeholder="Ej: calibración de Qualitron"
        class="field text-[11px] p-1 flex-1" onchange="onCambioAccion(this)"
        data-cal-linea="${lineaId}" data-cal-toma="${i}" data-cal-accion="${j}">
      <button type="button" class="text-rose-500 font-bold text-sm px-1" title="Eliminar acción"
        onclick="quitarAccionCalidad('${lineaId}', ${i}, ${j})">✕</button>
    </div>`).join('');
  return `${filas}
    <button type="button" class="text-[11px] font-bold text-emerald-600 hover:underline"
      onclick="agregarAccionCalidad('${lineaId}', ${i})">+ agregar acción</button>`;
}

/** Miniaturas de fotos con botón eliminar + zona de carga (drag & drop / archivo). */
function htmlFotos(lineaId, i, fotos) {
  // Botón de carga: una BARRA FINA arriba (no compite en tamaño con las fotos)
  // y toda la zona acepta arrastrar. Las fotos van SIEMPRE en 2 columnas (de a
  // pares, una al lado de la otra) con marco de alto FIJO (h-64 = 256px) para
  // que la carga de tomas no ocupe demasiado scroll. object-contain muestra la
  // foto completa dentro del marco (vertical u horizontal), sin recorte. Al
  // sumar fotos se acomodan en filas de 2 sin romper la sección.
  // Para cambiar el alto de las fotos, ajustar "h-64".
  const cols = 'grid-cols-2';
  const minis = fotos.map((src, j) => `
    <div class="relative group">
      <div class="w-full h-64 bg-slate-100 rounded-lg border border-slate-300 overflow-hidden flex items-center justify-center cursor-zoom-in shadow-sm"
        onclick="ampliarFotoCalidad('${src.replace(/'/g, "\\'")}')">
        <img src="${src}" class="max-w-full max-h-full object-contain" alt="foto defecto">
      </div>
      <button type="button" class="absolute top-1 right-1 bg-rose-600 text-white rounded-full w-6 h-6 text-xs leading-none font-bold shadow"
        title="Eliminar foto" onclick="quitarFotoCalidad('${lineaId}', ${i}, ${j})">✕</button>
    </div>`).join('');
  return `
    <div class="border-2 border-dashed border-slate-300 rounded-lg p-3 hover:border-sky-400 transition"
      ondragover="event.preventDefault()" ondrop="soltarFotoCalidad(event, '${lineaId}', ${i})">
      <!-- Botón de carga compacto (no ocupa una celda de foto) -->
      <label class="cursor-pointer flex items-center justify-center gap-2 border-2 border-dashed border-slate-300 rounded-lg py-2 mb-3 text-slate-400 hover:border-sky-400 hover:text-sky-500 text-sm">
        <span class="text-xl leading-none">+</span>
        <span>Subir o arrastrar fotos</span>
        <input type="file" accept="image/*" multiple class="hidden" onchange="subirFotoCalidad(this, '${lineaId}', ${i})">
      </label>
      ${fotos.length
        ? `<div class="grid ${cols} gap-3 items-start">${minis}</div>`
        : '<p class="text-[11px] text-slate-400 italic text-center py-2">Sin fotos cargadas.</p>'}
    </div>`;
}

/** HTML de una toma completa (tarjeta apilada). */
function htmlTomaCalidad(lineaId, toma, i) {
  const enviada = toma.enviada === true;
  return `
    <div class="border ${enviada ? 'border-emerald-300' : 'border-sky-200'} rounded-lg bg-white overflow-hidden mb-3">
      <div class="flex items-center justify-between ${enviada ? 'bg-emerald-600' : 'bg-sky-600'} text-white px-3 py-1.5">
        <!-- Separación entre "Toma N" y la Hora: ajustar el valor de "gap-6"
             (más chico = más pegado, más grande = más lejos. Ej: gap-2, gap-10). -->
        <div class="flex flex-wrap items-center gap-6">
          <span class="text-xs font-black uppercase">Toma ${i + 1}${enviada ? ' · enviada' : ''}</span>
          <label class="text-[10px] font-bold uppercase flex items-center gap-1">Hora
            ${inputToma(lineaId, i, 'hora', 'time', toma.hora || '')}</label>
          <label class="text-[10px] font-bold uppercase flex items-center gap-1" title="Cargá solo si en esta toma entra un producto nuevo">Producto
            <input type="text" value="${esc(toma.producto || '')}" placeholder="(cambio)"
              class="text-xs text-slate-800 rounded px-2 py-0.5 w-36" onchange="onCambioCalidad(this)"
              data-cal-linea="${lineaId}" data-cal-toma="${i}" data-cal-sub="producto"></label>
          <label class="text-[10px] font-bold uppercase flex items-center gap-1">Formato
            <input type="text" value="${esc(toma.formato || '')}" placeholder="(cambio)"
              class="text-xs text-slate-800 rounded px-2 py-0.5 w-24" onchange="onCambioCalidad(this)"
              data-cal-linea="${lineaId}" data-cal-toma="${i}" data-cal-sub="formato"></label>
        </div>
        <button type="button" class="text-white/80 hover:text-white font-bold text-xs" title="Vaciar toma"
          onclick="quitarTomaCalidad('${lineaId}', ${i})">🗑</button>
      </div>

      <div class="p-3">
        <!-- 2 columnas: IZQUIERDA datos ~33% · DERECHA fotos ~67% -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">

          <!-- COLUMNA IZQUIERDA (~33%): mediciones + defectos + rotura + acciones -->
          <div class="space-y-3 min-w-0 lg:col-span-1">
            <!-- Mediciones apiladas en 2 columnas angostas -->
            <div class="grid grid-cols-2 gap-2">
              <label class="text-[9px] font-black text-sky-700 uppercase">Calidad global %
                ${inputToma(lineaId, i, 'global', 'number', toma.global, 'bg-sky-50', '', '0.01')}</label>
              <label class="text-[9px] font-black text-emerald-700 uppercase">Calidad parcial %
                ${inputToma(lineaId, i, 'parcial1', 'number', toma.parcial1, 'bg-emerald-50', '', '0.01')}</label>
              <label class="text-[9px] font-black text-slate-600 uppercase">Tono
                ${inputToma(lineaId, i, 'tono', 'number', toma.tono, '', 'nº', '1')}</label>
              <label class="text-[9px] font-black text-slate-600 uppercase">M² clasificados
                ${inputToma(lineaId, i, 'm2', 'number', toma.m2, '', 'm²', '1')}</label>
              <label class="text-[9px] font-black text-slate-600 uppercase">Vacío horno (min)
                ${inputToma(lineaId, i, 'vacioHorno', 'number', toma.vacioHorno, '', 'min', '1')}</label>
              <label class="text-[9px] font-black text-amber-700 uppercase">2da calidad %
                ${inputToma(lineaId, i, 'segunda', 'number', toma.segunda, 'bg-amber-50', '', '0.01')}</label>
            </div>

            <!-- Defectos -->
            <div class="border border-rose-200 rounded p-2 bg-rose-50/40">
              <div class="text-[10px] font-black text-rose-700 uppercase mb-1">Defectos de calidad</div>
              <div>${htmlDefectos(lineaId, i, toma.defectos)}</div>
            </div>

            <!-- Rotura / descarte -->
            <div class="border border-orange-200 rounded p-2 bg-orange-50/40">
              <div class="flex items-center gap-2 mb-1">
                <span class="text-[10px] font-black text-orange-700 uppercase">Rotura / descarte —</span>
                <label class="text-[9px] font-bold text-orange-700 uppercase flex items-center gap-1">Total %
                  ${inputToma(lineaId, i, 'rotura', 'number', toma.rotura, 'bg-orange-50 w-20', '', '0.01')}</label>
              </div>
              <div>${htmlRoturas(lineaId, i, toma.roturas)}</div>
            </div>

            <!-- Acciones -->
            <div class="border border-emerald-200 rounded p-2 bg-emerald-50/40">
              <div class="text-[10px] font-black text-emerald-700 uppercase mb-1">Acciones de calidad</div>
              <div>${htmlAcciones(lineaId, i, toma.acciones)}</div>
            </div>
          </div>

          <!-- COLUMNA DERECHA (~67%): fotos -->
          <div class="border border-slate-200 rounded p-2 bg-slate-50/60 lg:col-span-2">
            <div class="text-[10px] font-black text-slate-600 uppercase mb-1">Fotos de defectos</div>
            <div>${htmlFotos(lineaId, i, toma.fotos)}</div>
          </div>
        </div>

        <div class="text-right mt-3">
          <button type="button" class="btn ${enviada ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-sky-700 hover:bg-sky-800'} text-white text-xs px-4 py-1.5"
            onclick="enviarTomaCalidad('${lineaId}', ${i})">${enviada ? '✓ Enviada · actualizar' : 'Enviar datos'}</button>
        </div>
      </div>
    </div>`;
}


/**
 * Renderiza el sinóptico de calidad INLINE en #panelCalidadInline, para la
 * línea seleccionada en "Área monitoreada". Llamado desde renderTodo().
 */
export function renderPlanillaCalidadInline() {
  const cont = document.getElementById('panelCalidadInline');
  if (!cont) return;

  const lineaId = lineaCalidadActual();
  if (!lineaId) {
    cont.innerHTML = '<p class="text-xs text-slate-500 italic">No hay líneas configuradas todavía.</p>';
    return;
  }

  const o = objDe(lineaId);
  if (!Array.isArray(o.tomasCalidad) || !o.tomasCalidad.length) {
    o.tomasCalidad = Array(8).fill(null).map(() => crearTomaCalidad());
  }

  cont.innerHTML = `
    <div class="flex flex-wrap justify-between items-center gap-2 mb-3">
      <div>
        <h2 class="font-black text-sky-700 uppercase text-sm">Carga de calidad · ${esc(nombreLinea(lineaId))}</h2>
        <p class="text-[11px] text-slate-500">Cada toma agrupa todo lo cargado en una hora. Se guarda solo; "Enviar datos" lo refleja en Vista de Planta. Cambiá de línea desde "Área monitoreada".</p>
      </div>
      <div class="flex items-center gap-2 bg-sky-600 text-white rounded-lg px-4 py-2 shadow">
        <span class="text-xs font-black uppercase leading-tight">Objetivo<br>de calidad</span>
        <input type="number" step="0.01" value="${o.calidad != null ? o.calidad : ''}" placeholder="%"
          class="w-24 text-2xl font-black text-slate-800 rounded px-2 py-1 text-center"
          onchange="onCambioCalidad(this)" data-cal-linea="${lineaId}" data-cal-meta="calidad">
        <span class="text-xl font-black">%</span>
      </div>
    </div>

    <div class="space-y-0">
      ${o.tomasCalidad.map((t, i) => htmlTomaCalidad(lineaId, t, i)).join('')}
    </div>

    <div class="text-center mt-2">
      <button type="button" class="btn bg-sky-600 text-white hover:bg-sky-700 text-xs px-4 py-1.5"
        onclick="agregarTomaCalidad('${lineaId}')">+ Agregar toma</button>
    </div>

    <!-- Observaciones generales del turno (por línea) -->
    <div class="mt-4 border-2 border-slate-200 rounded-lg p-3 bg-slate-50/60">
      <div class="text-xs font-black text-slate-600 uppercase mb-2">Observaciones del turno (Calidad)</div>
      <textarea rows="3" placeholder="Notas generales del turno: incidencias, tendencias, avisos para el próximo turno…"
        class="field w-full text-sm p-2" onchange="onCambioObservacionesCalidad(this)"
        data-cal-linea="${lineaId}">${esc(o.observacionesCalidad || '')}</textarea>
    </div>`;
}

/**
 * Actualiza los KPIs derivados que consumen los gráficos, a partir de las
 * tomas de una línea (última toma con dato). Mantiene lecturasCalidad (formato
 * viejo) para no romper el análisis existente.
 */
function derivarKpisCalidad(o) {
  const tomas = o.tomasCalidad || [];
  const ultGlobal = [...tomas].reverse().find(t => t.global != null);
  o.realCalidad = ultGlobal ? ultGlobal.global : 0;
  const ultParcial = [...tomas].reverse().find(t => t.parcial1 != null);
  o.calidadParcial = ultParcial ? ultParcial.parcial1 : 0;
  o.horaCalidadParcial = ultParcial ? ultParcial.hora : '';
  o.lecturasCalidad = tomas.map(t => ({ hora: t.hora, global: t.global, parcial: t.parcial1 }));

  // Derivar los quiebres de producto para el gráfico de calidad: recorriendo
  // las tomas por hora, cada vez que el PRODUCTO cargado cambia respecto del
  // vigente se marca un quiebre (línea vertical) a la hora de esa toma.
  const ordenadas = [...tomas]
    .filter(t => t.hora)
    .sort((a, b) => a.hora.localeCompare(b.hora));
  let productoVigente = '';
  const quiebres = [];
  ordenadas.forEach(t => {
    const prod = (t.producto || '').trim();
    if (prod && prod !== productoVigente) {
      quiebres.push({ tipo: 'producto', hora: t.hora, productoNuevo: prod });
      productoVigente = prod;
    }
  });
  o.quiebresProducto = quiebres;
}

/**
 * Producto y formato VIGENTES de una línea: los de la última toma (por hora)
 * que los tenga cargados. Se usan para reflejarlos en la cabecera.
 */
export function productoVigenteCalidad(lineaId) {
  const o = objDe(lineaId);
  const conProd = (o.tomasCalidad || [])
    .filter(t => t.hora && (t.producto || t.formato))
    .sort((a, b) => a.hora.localeCompare(b.hora));
  let producto = '', formato = '';
  conProd.forEach(t => {
    if ((t.producto || '').trim()) producto = t.producto.trim();
    if ((t.formato || '').trim()) formato = t.formato.trim();
  });
  return { producto, formato };
}

/**
 * Sincroniza s.defectos (la fuente que alimenta el TOP de defectos, el mapa de
 * defectos y el "defecto preponderante") a partir de los defectos cargados en
 * las tomas ENVIADAS de calidad de todas las líneas.
 *
 * Cada defecto de calidad se agrupa por (línea + nombre) y su % es el PROMEDIO
 * entre las tomas donde aparece. Los registros derivados llevan id con prefijo
 * "cal:" para poder regenerarlos sin pisar defectos cargados a mano (si los
 * hubiera). Así el gráfico TOP refleja siempre lo último enviado.
 */
function sincronizarDefectosDesdeTomas() {
  const s = sesion();
  asegurarDefectosSesion(s);

  // Agrupar por línea + nombre: sumamos % y contamos para promediar.
  const acum = {}; // clave `${lineaId}||${nombre}` -> {linea, nombre, suma, cant, hora}
  lineasActivas().forEach(l => {
    const o = s.objetivos?.porLinea?.[l.id];
    if (!o || !Array.isArray(o.tomasCalidad)) return;
    o.tomasCalidad.filter(t => t.enviada === true).forEach(t => {
      (t.defectos || []).forEach(d => {
        const nombre = (d.nombre || '').trim();
        if (!nombre || d.pct == null) return;
        const clave = `${l.id}||${nombre.toLowerCase()}`;
        if (!acum[clave]) acum[clave] = { linea: l.id, nombre, suma: 0, cant: 0, hora: t.hora || '' };
        acum[clave].suma += Number(d.pct);
        acum[clave].cant += 1;
        if (t.hora) acum[clave].hora = t.hora; // última hora vista
      });
    });
  });

  const derivados = Object.entries(acum).map(([clave, v]) => ({
    id: `cal:${clave}`,
    linea: v.linea,
    hora: v.hora,
    nombre: v.nombre,
    porcentaje: +(v.suma / v.cant).toFixed(2),
    accion: '',
    obs: 'Derivado de la planilla de calidad'
  }));

  // Conservar defectos NO derivados (cargados a mano, sin prefijo cal:) y
  // reemplazar solo los derivados.
  const manuales = (s.defectos || []).filter(d => !String(d.id).startsWith('cal:'));
  s.defectos = [...manuales, ...derivados];

  // Reconstruir lecturasDefectos POR LÍNEA: un snapshot por toma enviada
  // {hora, defectos:[{nombre, porcentaje}]}. Esto alimenta el gráfico de
  // evolución hora a hora del TOP de defectos (continuo por toma). Es por
  // línea: los datos de L1 nunca se mezclan con los de L2.
  lineasActivas().forEach(l => {
    const o = s.objetivos?.porLinea?.[l.id];
    if (!o || !Array.isArray(o.tomasCalidad)) return;
    o.lecturasDefectos = o.tomasCalidad
      .filter(t => t.enviada === true && t.hora)
      .map(t => ({
        hora: t.hora,
        defectos: (t.defectos || [])
          .filter(d => (d.nombre || '').trim() && d.pct != null)
          .map(d => ({ nombre: d.nombre.trim(), porcentaje: Number(d.pct) }))
      }))
      .filter(snap => snap.defectos.length)
      .sort((a, b) => a.hora.localeCompare(b.hora));
  });
}

// ----------------------------------------------------------
// GUARDADO AUTOMÁTICO (onchange, sin re-render para no perder foco)
// ----------------------------------------------------------

/** Campo simple de toma (mediciones) o cabecera (objetivo de calidad). */
export function onCambioCalidad(el) {
  const lineaId = el.getAttribute('data-cal-linea');
  if (!lineaId) return;
  const o = objDe(lineaId);
  const raw = el.value;

  const meta = el.getAttribute('data-cal-meta');
  if (meta === 'calidad') {
    const n = numOrNull(raw);
    if (n != null) o.calidad = n;
  } else {
    const i = parseInt(el.getAttribute('data-cal-toma'), 10);
    const toma = o.tomasCalidad?.[i];
    if (!toma) return;
    const sub = el.getAttribute('data-cal-sub');
    if (sub === 'hora' || sub === 'producto' || sub === 'formato') toma[sub] = raw.trim ? raw.trim() : raw;
    else toma[sub] = numOrNull(raw); // global, parcial1, tono, m2, vacioHorno, segunda, rotura
  }
  derivarKpisCalidad(o);
  // El producto/formato vigente se refleja en la cabecera (Producto/Formato).
  if (window.cargarCabeceraCalidad) window.cargarCabeceraCalidad();
  persistir();
}

/** Observaciones generales del turno de una línea (texto libre). */
export function onCambioObservacionesCalidad(el) {
  const lineaId = el.getAttribute('data-cal-linea');
  if (!lineaId) return;
  const o = objDe(lineaId);
  o.observacionesCalidad = el.value;
  persistir();
}

/** Campo de una fila de defectos/roturas (nombre/pct/aclaracion). */
export function onCambioLista(el) {
  const lineaId = el.getAttribute('data-cal-linea');
  const i = parseInt(el.getAttribute('data-cal-toma'), 10);
  const lista = el.getAttribute('data-cal-lista'); // 'defectos' | 'roturas'
  const fila = parseInt(el.getAttribute('data-cal-fila'), 10);
  const campo = el.getAttribute('data-cal-campo'); // 'nombre' | 'pct' | 'aclaracion'
  const toma = tomaDe(lineaId, i);
  if (!toma || !Array.isArray(toma[lista]) || !toma[lista][fila]) return;
  toma[lista][fila][campo] = campo === 'pct' ? numOrNull(el.value) : el.value.trim();
  // Si es un defecto de calidad de una toma ya enviada, actualizar el TOP en vivo.
  if (lista === 'defectos' && toma.enviada) sincronizarDefectosDesdeTomas();
  persistir();
}

/** Campo de una acción (texto). */
export function onCambioAccion(el) {
  const lineaId = el.getAttribute('data-cal-linea');
  const i = parseInt(el.getAttribute('data-cal-toma'), 10);
  const fila = parseInt(el.getAttribute('data-cal-accion'), 10);
  const toma = tomaDe(lineaId, i);
  if (!toma || !Array.isArray(toma.acciones)) return;
  toma.acciones[fila] = el.value;
  persistir();
}

// ----------------------------------------------------------
// ACCIONES sobre tomas / filas (re-renderizan: cambia la estructura)
// ----------------------------------------------------------

/** Agrega una toma nueva, con la hora del sistema. */
export function agregarTomaCalidad(lineaId) {
  const o = objDe(lineaId);
  o.tomasCalidad = Array.isArray(o.tomasCalidad) ? o.tomasCalidad : [];
  o.tomasCalidad.push(crearTomaCalidad({ hora: horaSistema() }));
  persistir();
  renderPlanillaCalidadInline();
}

/** Vacía/elimina una toma (deja al menos una). */
export function quitarTomaCalidad(lineaId, indice) {
  const o = objDe(lineaId);
  if (!Array.isArray(o.tomasCalidad) || o.tomasCalidad.length <= 1) {
    // Si es la última, la vaciamos en vez de dejar la línea sin tomas.
    o.tomasCalidad = [crearTomaCalidad()];
  } else {
    o.tomasCalidad.splice(indice, 1);
  }
  derivarKpisCalidad(o);
  persistir();
  renderPlanillaCalidadInline();
}

/**
 * Vuelca al modelo lo que hay tipeado en el DOM de una toma ANTES de un
 * re-render, para que agregar/quitar filas no pierda datos que el usuario
 * escribió pero cuyo onchange todavía no disparó (p. ej. hace click en "+"
 * mientras el foco está en un input).
 */
function volcarDomToma(lineaId, i) {
  const toma = tomaDe(lineaId, i);
  if (!toma) return;
  // Todo el volcado va en try/catch: si algún selector falla, NUNCA debe
  // impedir que se agregue/quite la fila (ese era el bug de los botones "+").
  try {
    const get = sel => { try { return document.querySelector(sel); } catch { return null; } };
    // Campos simples de la toma.
    ['global', 'parcial1', 'tono', 'm2', 'vacioHorno', 'segunda', 'rotura', 'hora'].forEach(sub => {
      const el = get(`[data-cal-linea="${lineaId}"][data-cal-toma="${i}"][data-cal-sub="${sub}"]`);
      if (el) toma[sub] = sub === 'hora' ? el.value : numOrNull(el.value);
    });
    // Listas de defectos y roturas.
    ['defectos', 'roturas'].forEach(lista => {
      if (!Array.isArray(toma[lista])) return;
      toma[lista].forEach((fila, j) => {
        ['nombre', 'pct', 'aclaracion'].forEach(campo => {
          const el = get(`[data-cal-linea="${lineaId}"][data-cal-toma="${i}"][data-cal-lista="${lista}"][data-cal-fila="${j}"][data-cal-campo="${campo}"]`);
          if (el) fila[campo] = campo === 'pct' ? numOrNull(el.value) : el.value.trim();
        });
      });
    });
    // Acciones: sus inputs llevan data-cal-accion (para no confundir con las
    // filas de defectos/roturas que también usan data-cal-fila).
    if (Array.isArray(toma.acciones)) {
      toma.acciones.forEach((_, j) => {
        const el = get(`[data-cal-linea="${lineaId}"][data-cal-toma="${i}"][data-cal-accion="${j}"]`);
        if (el) toma.acciones[j] = el.value;
      });
    }
  } catch (e) {
    // Silencioso a propósito: el volcado es "mejor esfuerzo".
  }
}

/** Agrega una fila a la lista de defectos o roturas de una toma. */
export function agregarFilaCalidad(lineaId, i, lista) {
  volcarDomToma(lineaId, i);
  const toma = tomaDe(lineaId, i);
  if (!toma) return;
  toma[lista] = Array.isArray(toma[lista]) ? toma[lista] : [];
  toma[lista].push(lista === 'defectos' ? { nombre: '', pct: null, aclaracion: '' } : { nombre: '', pct: null });
  persistir();
  renderPlanillaCalidadInline();
}

/** Quita una fila de defectos o roturas. */
export function quitarFilaCalidad(lineaId, i, lista, fila) {
  volcarDomToma(lineaId, i);
  const toma = tomaDe(lineaId, i);
  if (!toma || !Array.isArray(toma[lista])) return;
  toma[lista].splice(fila, 1);
  if (lista === 'defectos' && toma.enviada) sincronizarDefectosDesdeTomas();
  persistir();
  renderPlanillaCalidadInline();
}

/** Agrega una acción vacía. */
export function agregarAccionCalidad(lineaId, i) {
  volcarDomToma(lineaId, i);
  const toma = tomaDe(lineaId, i);
  if (!toma) return;
  toma.acciones = Array.isArray(toma.acciones) ? toma.acciones : [];
  toma.acciones.push('');
  persistir();
  renderPlanillaCalidadInline();
}

/** Quita una acción. */
export function quitarAccionCalidad(lineaId, i, fila) {
  volcarDomToma(lineaId, i);
  const toma = tomaDe(lineaId, i);
  if (!toma || !Array.isArray(toma.acciones)) return;
  toma.acciones.splice(fila, 1);
  persistir();
  renderPlanillaCalidadInline();
}

/** Marca la toma como enviada (se refleja en Vista de Planta) y avisa. */
export function enviarTomaCalidad(lineaId, i) {
  const toma = tomaDe(lineaId, i);
  if (!toma) return;
  if (!toma.hora) toma.hora = horaSistema();
  toma.enviada = true;
  const o = objDe(lineaId);
  derivarKpisCalidad(o);
  // Volcar los defectos de las tomas enviadas al TOP de defectos / mapa.
  sincronizarDefectosDesdeTomas();
  persistir();
  renderPlanillaCalidadInline();
  // Refrescar dashboard/Vista de Planta para que el TOP de defectos y KPIs
  // reflejen lo recién enviado.
  if (typeof window.renderTodo === 'function') window.renderTodo();
  mostrarAlertaKira(`Toma de las ${toma.hora} enviada. Se refleja en Vista de Planta.`, 'Calidad', 'exito');
}

// ----------------------------------------------------------
// FOTOS: compresión a base64 y guardado
// ----------------------------------------------------------

/**
 * Comprime un File de imagen a un dataURL JPEG redimensionado (máx `maxLado`
 * px por lado, calidad `q`). Devuelve una promesa con el dataURL, para que
 * las fotos ocupen poco en localStorage (~50-150KB c/u).
 */
function comprimirImagen(file, maxLado = 1000, q = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxLado) { height = Math.round(height * maxLado / width); width = maxLado; }
        else if (height > maxLado) { width = Math.round(width * maxLado / height); height = maxLado; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', q));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/** Procesa una lista de File (input o drop): comprime y guarda en la toma. */
async function agregarFotos(lineaId, i, fileList) {
  const toma = tomaDe(lineaId, i);
  if (!toma) return;
  toma.fotos = Array.isArray(toma.fotos) ? toma.fotos : [];
  const files = [...fileList].filter(f => f.type.startsWith('image/'));
  try {
    for (const f of files) {
      const dataUrl = await comprimirImagen(f);
      toma.fotos.push(dataUrl);
    }
    persistir();
    renderPlanillaCalidadInline();
  } catch (e) {
    mostrarAlertaKira('No se pudo procesar alguna imagen. Probá con otra.', 'Fotos de calidad', 'advertencia');
  }
}

/** onchange del input file. */
export function subirFotoCalidad(input, lineaId, i) {
  if (input.files?.length) agregarFotos(lineaId, i, input.files);
}

/** ondrop de la zona de carga. */
export function soltarFotoCalidad(ev, lineaId, i) {
  ev.preventDefault();
  const files = ev.dataTransfer?.files;
  if (files?.length) agregarFotos(lineaId, i, files);
}

/** Quita una foto de la toma. */
export function quitarFotoCalidad(lineaId, i, fotoIdx) {
  const toma = tomaDe(lineaId, i);
  if (!toma || !Array.isArray(toma.fotos)) return;
  toma.fotos.splice(fotoIdx, 1);
  persistir();
  renderPlanillaCalidadInline();
}

// ----------------------------------------------------------
// REFLEJO EN VISTA DE PLANTA (tomas enviadas, solo lectura)
// ----------------------------------------------------------

/** Chip con etiqueta + valor, si el valor existe. */
function chip(label, valor, sufijo = '') {
  if (valor == null || valor === '') return '';
  return `<span class="inline-block bg-white border border-slate-200 rounded px-2 py-0.5 text-[11px] mr-1 mb-1">
    <b class="text-slate-500">${label}:</b> ${esc(String(valor))}${sufijo}</span>`;
}

/** HTML de una toma ENVIADA (solo lectura) para Vista de Planta. */
function htmlTomaVista(toma, i) {
  const meds = [
    chip('Global', toma.global, '%'),
    chip('Parcial', toma.parcial1, '%'),
    chip('Tono', toma.tono),
    chip('M²', toma.m2),
    chip('Vacío horno', toma.vacioHorno, ' min'),
    chip('2da', toma.segunda, '%'),
    chip('Rotura', toma.rotura, '%')
  ].join('');

  const defs = (toma.defectos || []).filter(d => d.nombre || d.pct != null).map(d =>
    `<li>${esc(d.nombre || '—')}${d.pct != null ? `: <b>${d.pct}%</b>` : ''}${d.aclaracion ? ` <span class="text-slate-400">(${esc(d.aclaracion)})</span>` : ''}</li>`).join('');
  const rots = (toma.roturas || []).filter(d => d.nombre || d.pct != null).map(d =>
    `<li>${esc(d.nombre || '—')}${d.pct != null ? `: <b>${d.pct}%</b>` : ''}${d.aclaracion ? ` <span class="text-slate-400">(${esc(d.aclaracion)})</span>` : ''}</li>`).join('');
  const accs = (toma.acciones || []).filter(a => a.trim()).map(a => `<li>${esc(a)}</li>`).join('');
  const fotos = (toma.fotos || []).map(src =>
    `<div class="w-20 h-20 bg-slate-100 rounded border border-slate-300 overflow-hidden flex items-center justify-center cursor-pointer" onclick="ampliarFotoCalidad('${src.replace(/'/g, "\\'")}')">
      <img src="${src}" class="max-w-full max-h-full object-contain" alt="foto defecto">
    </div>`).join('');

  return `
    <div class="border border-emerald-200 rounded-lg bg-emerald-50/30 p-3">
      <div class="text-xs font-black text-emerald-700 uppercase mb-2">${toma.hora || 'Sin hora'} · Toma ${i + 1}</div>
      <div class="mb-2">${meds || '<span class="text-[11px] text-slate-400 italic">Sin mediciones</span>'}</div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-700">
        ${defs ? `<div><div class="font-black text-rose-700 uppercase text-[10px] mb-0.5">Defectos</div><ul class="list-disc pl-4 space-y-0.5">${defs}</ul></div>` : ''}
        ${rots ? `<div><div class="font-black text-orange-700 uppercase text-[10px] mb-0.5">A rotura</div><ul class="list-disc pl-4 space-y-0.5">${rots}</ul></div>` : ''}
        ${accs ? `<div><div class="font-black text-emerald-700 uppercase text-[10px] mb-0.5">Acciones</div><ul class="list-disc pl-4 space-y-0.5">${accs}</ul></div>` : ''}
      </div>
      ${fotos ? `<div class="flex flex-wrap gap-2 mt-2">${fotos}</div>` : ''}
    </div>`;
}

/**
 * Llena #vpCalidadTomas (Vista de Planta) con las tomas ENVIADAS de la línea
 * monitoreada, ordenadas por hora. Solo lectura. Llamado desde renderVistaPlanta.
 */
export function renderTomasEnviadasVistaPlanta() {
  const cont = document.getElementById('vpCalidadTomas');
  if (!cont) return;

  const lineaId = lineaCalidadActual();
  if (!lineaId) { cont.innerHTML = ''; return; }

  const o = objDe(lineaId);
  const enviadas = (o.tomasCalidad || [])
    .map((t, i) => ({ t, i }))
    .filter(x => x.t.enviada === true)
    .sort((a, b) => (a.t.hora || '').localeCompare(b.t.hora || ''));

  if (!enviadas.length) {
    cont.innerHTML = `<div class="panel p-3 text-[11px] text-slate-500 italic">
      Todavía no se enviaron tomas de calidad en este turno. Cargá y presioná "Enviar datos" en la pantalla de carga.</div>`;
    return;
  }

  cont.innerHTML = `
    <div class="panel p-3">
      <h2 class="font-black text-emerald-700 uppercase text-sm mb-3">Calidad del turno · ${esc(nombreLinea(lineaId))} · ${enviadas.length} toma(s)</h2>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
        ${enviadas.map(x => htmlTomaVista(x.t, x.i)).join('')}
      </div>
      ${(o.observacionesCalidad || '').trim() ? `
        <div class="mt-3 border-t border-slate-200 pt-2">
          <div class="text-[10px] font-black text-slate-600 uppercase mb-1">Observaciones del turno (Calidad)</div>
          <p class="text-[12px] text-slate-700 whitespace-pre-line">${esc(o.observacionesCalidad)}</p>
        </div>` : ''}
    </div>`;
}

/** Abre una foto en grande en una capa modal simple. */
export function ampliarFotoCalidad(src) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-[9999] p-4';
  overlay.onclick = () => overlay.remove();
  overlay.innerHTML = `<img src="${src}" class="max-w-full max-h-full rounded shadow-lg" alt="foto">`;
  document.body.appendChild(overlay);
}

// ==========================================================
// EXPOSICIÓN A window (onchange/onclick del HTML generado)
// ==========================================================
window.onCambioCalidad = onCambioCalidad;
window.onCambioObservacionesCalidad = onCambioObservacionesCalidad;
window.onCambioLista = onCambioLista;
window.onCambioAccion = onCambioAccion;
window.agregarTomaCalidad = agregarTomaCalidad;
window.quitarTomaCalidad = quitarTomaCalidad;
window.agregarFilaCalidad = agregarFilaCalidad;
window.quitarFilaCalidad = quitarFilaCalidad;
window.agregarAccionCalidad = agregarAccionCalidad;
window.quitarAccionCalidad = quitarAccionCalidad;
window.enviarTomaCalidad = enviarTomaCalidad;
window.productoVigenteCalidad = productoVigenteCalidad;
window.subirFotoCalidad = subirFotoCalidad;
window.soltarFotoCalidad = soltarFotoCalidad;
window.quitarFotoCalidad = quitarFotoCalidad;
window.ampliarFotoCalidad = ampliarFotoCalidad;
