/* ========================================================== */
/* CARGA-PRODUCCION.JS — Objetivos, quemado y respuesta a      */
/* defectos de calidad (panel de producción)                  */
/* ========================================================== */
/*
  Panel EMBEBIDO en el dashboard (arriba del sinóptico), visible
  solo para el rol producción (data-cap="cargarProduccion" en
  #panelProduccionInline). Para la línea elegida en "Área
  monitoreada" (#lineaVista) permite:

    IZQUIERDA (agrupado, angosto):
      - Objetivo de vacío de horno (min máx.)
      - Objetivo de paradas de máquina (min máx.)
      - 3 tomas de m² quemados hora a hora (hora + valor) — solo
        informativo, sin cálculos.

    DERECHA:
      - Listado de los defectos que calidad ENVIÓ (una fila por
        cada defecto de cada toma: hora · defecto · %), con un
        campo para que producción escriba la ACCIÓN de respuesta.
        Se resaltan los que superan el objetivo de calidad.

  Botón "Enviar / actualizar datos": persiste y refresca Vista de
  Planta, donde se reflejan las acciones. Guardado automático en
  cada onchange igual. Cada línea es independiente.

  Al pie del panel de acciones correctivas (index.html) hay además
  una zona de fotos del turno de producción (ver htmlFotosProduccion
  y su render en #fotosProduccionInline).
*/

import { esc, valor } from '../nucleo/utilidades.js';
import { persistir } from '../nucleo/almacenamiento.js';
import { mostrarAlertaKira } from '../nucleo/alertasKira.js';
import {
  sesion, lineasActivas, lineaPorId, nombreLinea, asegurarObjetivosSesion
} from '../nucleo/estado.js';
// nivelPorValor/UMBRAL_DEFECTO: mismo criterio de criticidad que el mapa de
// calor de defectos. Dependencia circular con vistaDePlanta segura porque solo
// se usan dentro de funciones (nunca al cargar el módulo).
import { nivelPorValor, UMBRAL_DEFECTO } from './vistaDePlanta.js';
import { ultimaTomaEnviada } from './cargaCalidad.js';

const numOrNull = v => (v === '' || v === null || v === undefined || isNaN(parseFloat(v))) ? null : parseFloat(v);

/** Línea de producción en edición: la de "Área monitoreada". */
function lineaProduccionActual() {
  const l = valor('lineaVista');
  if (!l || l === 'TODAS' || l === 'GENERAL') return lineasActivas()[0]?.id || '';
  return lineaPorId(l) ? l : (lineasActivas()[0]?.id || '');
}

/** Objeto de objetivos de la línea (garantizando estructura). */
function objDe(lineaId) {
  const s = sesion();
  asegurarObjetivosSesion(s);
  return s.objetivos.porLinea[lineaId];
}

const numAttr = v => (v != null && !isNaN(v) && v !== 0) ? v : '';

/** Columna izquierda: objetivos + m² quemados. */
function htmlObjetivosQuemado(lineaId, o) {
  const tomas = Array.isArray(o.lecturasQuemado) && o.lecturasQuemado.length
    ? o.lecturasQuemado
    : [{ hora: '', real: 0 }, { hora: '', real: 0 }, { hora: '', real: 0 }];
  return `
    <div class="border border-slate-200 rounded-lg p-3 bg-slate-50/60 space-y-3">
      <!-- Objetivos: compactos, label a la izquierda + input angosto a la derecha -->
      <div class="space-y-2">
        <div class="text-[10px] font-black text-slate-500 uppercase">Objetivos del turno</div>
        <label class="flex items-center justify-between gap-2 text-[11px] font-bold text-slate-600">
          <span>Vacío horno (min)</span>
          <input type="number" step="1" min="0" value="${o.vacioMax != null ? o.vacioMax : ''}" class="field text-sm p-1 w-20 text-center"
            onchange="onCambioObjetivoProd(this)" data-prod-linea="${lineaId}" data-prod-campo="vacioMax"></label>
        <label class="flex items-center justify-between gap-2 text-[11px] font-bold text-slate-600">
          <span>Paradas (min)</span>
          <input type="number" step="1" min="0" value="${o.paradasMax != null ? o.paradasMax : ''}" class="field text-sm p-1 w-20 text-center"
            onchange="onCambioObjetivoProd(this)" data-prod-linea="${lineaId}" data-prod-campo="paradasMax"></label>
      </div>

      <div class="pt-2 border-t border-slate-200">
        <div class="text-[10px] font-black text-slate-500 uppercase mb-1.5">m² quemados (hora a hora)</div>
        <div class="space-y-1.5">
          ${tomas.map((t, i) => `
            <label class="flex items-center gap-2 text-[11px] font-bold text-slate-600">
              <span class="w-14 text-slate-400">Toma ${i + 1}</span>
              <input type="time" value="${esc(t.hora || '')}" class="field text-sm p-1 w-24"
                onchange="onCambioQuemado(this)" data-prod-linea="${lineaId}" data-prod-toma="${i}" data-prod-sub="hora">
              <input type="number" step="1" min="0" value="${numAttr(t.real)}" placeholder="m²" class="field text-sm p-1 w-20 text-center"
                onchange="onCambioQuemado(this)" data-prod-linea="${lineaId}" data-prod-toma="${i}" data-prod-sub="real">
            </label>`).join('')}
        </div>
      </div>
    </div>`;
}

/** Columna derecha: respuesta a los defectos de calidad enviados. */
function htmlRespuestaDefectos(lineaId, o) {
  // Solo los defectos de la ÚLTIMA toma enviada (la del momento). Cada toma
  // nueva de calidad reemplaza a la anterior: no se acumulan.
  const ult = ultimaTomaEnviada(o);
  const filas = [];
  if (ult) {
    const ti = ult.indice;
    (ult.toma.defectos || []).forEach((d, di) => {
      if (!(d.nombre || '').trim()) return;
      filas.push({ ti, di, hora: ult.toma.hora || '', nombre: d.nombre, pct: d.pct, accionProd: d.accionProd || '' });
    });
  }

  if (!filas.length) {
    return `
      <div class="text-xs text-slate-400 italic p-3 border border-dashed border-slate-200 rounded-lg">
        Todavía no hay defectos enviados por calidad para esta línea. Cuando calidad envíe una toma con defectos,
        aparecerán acá para que cargues la acción de respuesta.
      </div>`;
  }

  // Ordenar por % descendente: los más críticos primero (para centrar la
  // atención donde más duele).
  filas.sort((a, b) => (b.pct || 0) - (a.pct || 0));

  // Grilla de 2 columnas: las tarjetas se acomodan de a pares, no en un
  // listado que se estira hacia abajo. El color viene del MISMO criterio de
  // criticidad que el mapa de calor de defectos (nivelPorValor + UMBRAL_DEFECTO).
  return `
    <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
      ${filas.map(f => {
        const nivel = nivelPorValor(f.pct || 0, UMBRAL_DEFECTO);
        return `
        <div class="rounded-lg p-2.5 border ${nivel.rowBg} border-slate-200">
          <div class="flex items-center gap-2 mb-1.5">
            <span class="text-xs font-black text-slate-800">${esc(f.nombre)}</span>
            ${f.pct != null ? `<span class="badge ${nivel.badge} text-xs">${f.pct}%</span>` : ''}
            <span class="badge ${nivel.badge} text-[10px]">${nivel.label}</span>
            ${f.hora ? `<span class="text-[11px] text-slate-400 ml-auto">${esc(f.hora)} hs</span>` : ''}
          </div>
          <input type="text" value="${esc(f.accionProd)}" placeholder="Acción de producción…"
            class="field text-sm p-2 w-full"
            onchange="onCambioAccionProd(this)" data-prod-linea="${lineaId}" data-prod-toma="${f.ti}" data-prod-def="${f.di}">
        </div>`;
      }).join('')}
    </div>`;
}

/**
 * Renderiza el panel de producción en #panelProduccionInline, para la línea
 * seleccionada en "Área monitoreada". Llamado desde renderTodo().
 */
export function renderProduccionInline() {
  const cont = document.getElementById('panelProduccionInline');
  if (!cont) return;

  const lineaId = lineaProduccionActual();
  if (!lineaId) {
    cont.innerHTML = '<p class="text-xs text-slate-500 italic">No hay líneas configuradas todavía.</p>';
    return;
  }

  const o = objDe(lineaId);

  cont.innerHTML = `
    <div class="flex flex-wrap justify-between items-center gap-2 mb-3">
      <div>
        <h2 class="font-black text-slate-700 uppercase text-sm">Objetivos, quemado y respuesta a calidad · ${esc(nombreLinea(lineaId))}</h2>
        <p class="text-[11px] text-slate-500">Objetivos del turno, m² quemados y acciones frente a los defectos que envía calidad. Cambiá de línea desde "Área monitoreada".</p>
      </div>
      <button type="button" class="btn ${o.accionesProdEnviadas ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-sky-700 hover:bg-sky-800'} text-white text-xs px-4 py-1.5"
        onclick="enviarProduccion('${lineaId}')">${o.accionesProdEnviadas ? '✓ Enviado · actualizar' : 'Enviar / actualizar datos'}</button>
    </div>

    <!-- IZQUIERDA objetivos+quemado (compacto) · DERECHA respuesta a defectos (2 col) -->
    <div class="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <div class="lg:col-span-1">
        ${htmlObjetivosQuemado(lineaId, o)}
      </div>
      <div class="lg:col-span-3">
        <div class="text-[11px] font-black text-rose-700 uppercase mb-2">Respuesta a defectos de calidad</div>
        ${htmlRespuestaDefectos(lineaId, o)}
      </div>
    </div>

    <!-- Observaciones de producción del turno (se reflejan en Vista de Planta) -->
    <div class="mt-4 border-2 border-slate-200 rounded-lg p-3 bg-slate-50/60">
      <div class="flex items-center justify-between mb-2">
        <div class="text-xs font-black text-slate-600 uppercase">Observaciones de producción</div>
        <button type="button" class="btn bg-slate-600 text-white hover:bg-slate-700 text-[11px] px-3 py-1"
          onclick="enviarObsProduccion()">Enviar nota</button>
      </div>
      <textarea id="obsProduccionTxt" rows="2" placeholder="Ej: Se colocan prensas en 12,5 golpes para mejorar cargamento…"
        class="field w-full text-sm p-2" onchange="onCambioObsProduccion(this)">${esc(sesion().notaTurno || '')}</textarea>
    </div>`;
}

// ----------------------------------------------------------
// GUARDADO AUTOMÁTICO (onchange)
// ----------------------------------------------------------

/** Objetivo (vacioMax / paradasMax). */
export function onCambioObjetivoProd(el) {
  const lineaId = el.getAttribute('data-prod-linea');
  const campo = el.getAttribute('data-prod-campo');
  if (!lineaId || !campo) return;
  const o = objDe(lineaId);
  const n = numOrNull(el.value);
  o[campo] = n != null ? n : 0;
  persistir();
  if (typeof window.renderTodo === 'function') window.renderTodo();
}

/** Toma de m² quemados (hora / real). */
export function onCambioQuemado(el) {
  const lineaId = el.getAttribute('data-prod-linea');
  const i = parseInt(el.getAttribute('data-prod-toma'), 10);
  const sub = el.getAttribute('data-prod-sub');
  const o = objDe(lineaId);
  if (!Array.isArray(o.lecturasQuemado)) {
    o.lecturasQuemado = [{ hora: '', real: 0 }, { hora: '', real: 0 }, { hora: '', real: 0 }];
  }
  if (!o.lecturasQuemado[i]) o.lecturasQuemado[i] = { hora: '', real: 0 };
  if (sub === 'hora') o.lecturasQuemado[i].hora = el.value;
  else o.lecturasQuemado[i].real = numOrNull(el.value) || 0;
  persistir();
}

/** Acción de producción para un defecto de una toma de calidad. */
export function onCambioAccionProd(el) {
  const lineaId = el.getAttribute('data-prod-linea');
  const ti = parseInt(el.getAttribute('data-prod-toma'), 10);
  const di = parseInt(el.getAttribute('data-prod-def'), 10);
  const o = objDe(lineaId);
  const toma = o.tomasCalidad?.[ti];
  if (!toma || !Array.isArray(toma.defectos) || !toma.defectos[di]) return;
  toma.defectos[di].accionProd = el.value.trim();
  // Reflejar la acción en el mapa de calor de defectos (columna "Acción").
  if (typeof window.sincronizarDefectosCalidad === 'function') window.sincronizarDefectosCalidad();
  persistir();
}

/** Observaciones de producción del turno (texto libre, a nivel sesión). */
export function onCambioObsProduccion(el) {
  const s = sesion();
  s.notaTurno = el.value;
  persistir();
}

/** Envía la nota de producción: guarda lo tipeado y refresca Vista de Planta. */
export function enviarObsProduccion() {
  const el = document.getElementById('obsProduccionTxt');
  if (el) { sesion().notaTurno = el.value; persistir(); }
  if (typeof window.renderVistaPlanta === 'function') window.renderVistaPlanta();
  mostrarAlertaKira('Nota de producción enviada. Aparece en Vista de Planta.', 'Producción', 'exito');
}

/** Marca las acciones como enviadas y refresca Vista de Planta. */
export function enviarProduccion(lineaId) {
  const o = objDe(lineaId);
  o.accionesProdEnviadas = true;
  // Volcar las acciones al mapa de calor de defectos (s.defectos) antes de refrescar.
  if (typeof window.sincronizarDefectosCalidad === 'function') window.sincronizarDefectosCalidad();
  persistir();
  renderProduccionInline();
  if (typeof window.renderTodo === 'function') window.renderTodo();
  mostrarAlertaKira('Datos de producción enviados. Se reflejan en Vista de Planta.', 'Producción', 'exito');
}

// ----------------------------------------------------------
// REFLEJO EN VISTA DE PLANTA (solo lectura)
// ----------------------------------------------------------

/**
 * Llena #vpProduccionAcciones (Vista de Planta) con las respuestas de
 * producción a los defectos de calidad de la línea monitoreada. Se listan los
 * defectos enviados por calidad con la acción que cargó producción. Solo lectura.
 */
export function renderRespuestaDefectosVistaPlanta() {
  const cont = document.getElementById('vpProduccionAcciones');
  if (!cont) return;

  const lineaId = lineaProduccionActual();
  if (!lineaId) { cont.innerHTML = ''; return; }

  const o = objDe(lineaId);

  // Un COMPROBANTE (cuadro) por cada toma enviada de calidad que tenga
  // defectos, como los cuadros "Toma N" de calidad. Cada cuadro muestra la
  // hora de la toma y sus defectos con la acción que cargó producción.
  const tomas = (o.tomasCalidad || [])
    .map((t, i) => ({ t, i }))
    .filter(x => x.t.enviada === true && (x.t.defectos || []).some(d => (d.nombre || '').trim()))
    .sort((a, b) => (a.t.hora || '').localeCompare(b.t.hora || ''));

  if (!tomas.length) { cont.innerHTML = ''; return; }

  cont.innerHTML = `
    <div class="panel p-3">
      <h2 class="font-black text-slate-700 uppercase text-sm mb-3">Respuesta a defectos de calidad · ${esc(nombreLinea(lineaId))} · ${tomas.length} toma(s)</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        ${tomas.map((x, idx) => {
          const t = x.t;
          const defs = (t.defectos || []).filter(d => (d.nombre || '').trim());
          return `
          <div class="border border-slate-200 rounded-lg bg-slate-50/40 overflow-hidden">
            <div class="bg-slate-600 text-white px-2 py-1 text-[11px] font-black uppercase">
              ${t.hora ? esc(t.hora) + ' hs' : 'Sin hora'} · Toma ${idx + 1}
            </div>
            <div class="p-1.5 space-y-1">
              ${defs.map(d => {
                const nivel = nivelPorValor(d.pct || 0, UMBRAL_DEFECTO);
                return `
                <div class="rounded p-1.5 ${nivel.rowBg} border border-slate-200">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="text-[11px] font-black text-slate-800">${esc(d.nombre)}</span>
                    ${d.pct != null ? `<span class="badge ${nivel.badge} text-[10px]">${d.pct}%</span>` : ''}
                  </div>
                  <div class="text-[11px] text-slate-700 mt-0.5">
                    <b class="text-slate-500">Acción:</b> ${(d.accionProd || '').trim() ? esc(d.accionProd) : '<span class="text-slate-400 italic">sin acción</span>'}
                  </div>
                </div>`;
              }).join('')}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

// ----------------------------------------------------------
// FOTOS DEL TURNO (producción): compresión a base64 y guardado
// ----------------------------------------------------------

/** Comprime un File de imagen a un dataURL JPEG redimensionado (mismo criterio que calidad). */
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

/** Fotos del turno guardadas a nivel sesión (comunes a producción, no por línea). */
function fotosProd() {
  const s = sesion();
  if (!Array.isArray(s.fotosProduccion)) s.fotosProduccion = [];
  return s.fotosProduccion;
}

/** Renderiza la zona de fotos de producción en #fotosProduccionInline. */
export function renderFotosProduccion() {
  const cont = document.getElementById('fotosProduccionInline');
  if (!cont) return;
  const fotos = fotosProd();
  const cnt = document.getElementById('cantidadFotosProd');
  if (cnt) cnt.textContent = fotos.length;

  const minis = fotos.map((src, j) => `
    <div class="relative group">
      <div class="w-full h-40 bg-slate-100 rounded-lg border border-slate-300 overflow-hidden flex items-center justify-center cursor-zoom-in shadow-sm"
        onclick="ampliarFotoCalidad('${src.replace(/'/g, "\\'")}')">
        <img src="${src}" class="max-w-full max-h-full object-contain" alt="foto turno">
      </div>
      <button type="button" class="absolute top-1 right-1 bg-rose-600 text-white rounded-full w-6 h-6 text-xs leading-none font-bold shadow"
        title="Eliminar foto" onclick="quitarFotoProduccion(${j})">✕</button>
    </div>`).join('');

  cont.innerHTML = `
    <div class="border-2 border-dashed border-slate-300 rounded-lg p-3 hover:border-sky-400 transition"
      ondragover="event.preventDefault()" ondrop="soltarFotoProduccion(event)">
      <label class="cursor-pointer flex items-center justify-center gap-2 border-2 border-dashed border-slate-300 rounded-lg py-2 mb-3 text-slate-400 hover:border-sky-400 hover:text-sky-500 text-sm">
        <span class="text-xl leading-none">+</span>
        <span>Subir o arrastrar fotos</span>
        <input type="file" accept="image/*" multiple class="hidden" onchange="subirFotoProduccion(this)">
      </label>
      ${fotos.length ? `<div class="grid grid-cols-2 gap-3">${minis}</div>` : '<p class="text-[11px] text-slate-400 italic text-center py-2">Sin fotos cargadas.</p>'}
    </div>`;
}

/** Procesa una lista de File (input o drop): comprime y guarda en la sesión. */
async function agregarFotosProd(fileList) {
  const arr = fotosProd();
  const files = [...fileList].filter(f => f.type.startsWith('image/'));
  try {
    for (const f of files) arr.push(await comprimirImagen(f));
    persistir();
    renderFotosProduccion();
  } catch (e) {
    mostrarAlertaKira('No se pudo procesar alguna imagen. Probá con otra.', 'Fotos del turno', 'advertencia');
  }
}

/** onchange del input file. */
export function subirFotoProduccion(input) {
  if (input.files?.length) agregarFotosProd(input.files);
}

/** ondrop de la zona de carga. */
export function soltarFotoProduccion(ev) {
  ev.preventDefault();
  const files = ev.dataTransfer?.files;
  if (files?.length) agregarFotosProd(files);
}

/** Quita una foto del turno. */
export function quitarFotoProduccion(idx) {
  const arr = fotosProd();
  arr.splice(idx, 1);
  persistir();
  renderFotosProduccion();
}

// ==========================================================
// EXPOSICIÓN A window (onchange/onclick del HTML generado)
// ==========================================================
window.onCambioObjetivoProd = onCambioObjetivoProd;
window.onCambioObsProduccion = onCambioObsProduccion;
window.enviarObsProduccion = enviarObsProduccion;
window.subirFotoProduccion = subirFotoProduccion;
window.soltarFotoProduccion = soltarFotoProduccion;
window.quitarFotoProduccion = quitarFotoProduccion;
window.onCambioQuemado = onCambioQuemado;
window.onCambioAccionProd = onCambioAccionProd;
window.enviarProduccion = enviarProduccion;
