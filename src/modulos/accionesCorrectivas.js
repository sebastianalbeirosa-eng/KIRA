/* ========================================================== */
/* ACCIONES-CORRECTIVAS.JS — CRUD de acciones correctivas     */
/* ========================================================== */
/*
  Registro de acciones tomadas durante el turno (con o sin una
  parada asociada), incluyendo comprobantes fotográficos adjuntos.
*/

import { persistir, emitirSincronizacionBloque } from '../nucleo/almacenamiento.js';
import { valor, abrir, cerrar } from '../nucleo/utilidades.js';
import { sesion, lineasActivas } from '../nucleo/estado.js';
import { mostrarConfirmacionKira, mostrarAlertaKira } from '../nucleo/alertasKira.js';
import { usuarioActual } from '../nucleo/roles.js';

import { renderTodo } from './vistaDePlanta.js';

/** Buffer temporal de fotos para la acción que se está creando o editando en el modal. */
let accionFotosTemp = [];

/** Comprime un File de imagen a un dataURL JPEG redimensionado para evitar llenar localStorage. */
function comprimirImagen(file, maxLado = 1000, q = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        if (w > maxLado || h > maxLado) {
          if (w >= h) {
            h = Math.round(h * (maxLado / w));
            w = maxLado;
          } else {
            w = Math.round(w * (maxLado / h));
            h = maxLado;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', q));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/** Dibuja la cuadrícula de vista previa de fotos en el modal de acción correctiva. */
export function renderPreviewFotosAccion() {
  const cont = document.getElementById('previewFotosAccion');
  const countBadge = document.getElementById('cantidadFotosAccionModal');
  if (countBadge) countBadge.textContent = `${accionFotosTemp.length} foto(s)`;
  if (!cont) return;

  if (!accionFotosTemp.length) {
    cont.innerHTML = '<div class="col-span-full text-center text-[11px] text-slate-400 italic py-1">Sin comprobantes adjuntos para esta acción.</div>';
    return;
  }

  cont.innerHTML = accionFotosTemp.map((src, idx) => `
    <div class="relative group rounded border border-slate-300 bg-white overflow-hidden shadow-xs">
      <div class="w-full h-20 flex items-center justify-center bg-slate-100 cursor-zoom-in"
           onclick="window.ampliarFotoCalidad && window.ampliarFotoCalidad('${src.replace(/'/g, "\\'")}')"
           title="Click para ampliar imagen">
        <img src="${src}" class="max-w-full max-h-full object-contain" alt="Comprobante ${idx + 1}">
      </div>
      <button type="button" class="absolute top-1 right-1 bg-rose-600 hover:bg-rose-700 text-white rounded-full w-5 h-5 text-[10px] leading-none font-bold shadow flex items-center justify-center transition"
              title="Eliminar foto" onclick="quitarFotoAccion(${idx})">✕</button>
    </div>
  `).join('');
}

/** Procesa archivos de imagen subidos al modal. */
async function procesarArchivosAccion(files) {
  const validos = [...files].filter(f => f.type && f.type.startsWith('image/'));
  if (!validos.length) return;
  try {
    for (const f of validos) {
      const dataUrl = await comprimirImagen(f);
      accionFotosTemp.push(dataUrl);
    }
    renderPreviewFotosAccion();
  } catch (err) {
    mostrarAlertaKira('No se pudo procesar alguna imagen. Probá con otra.', 'Comprobantes', 'advertencia');
  }
}

/** Onchange del input de archivo en el modal de acción. */
export function subirFotosAccion(input) {
  if (input.files?.length) {
    procesarArchivosAccion(input.files);
    input.value = '';
  }
}

/** Ondrop del área de fotos en el modal de acción. */
export function soltarFotosAccion(ev) {
  ev.preventDefault();
  const files = ev.dataTransfer?.files;
  if (files?.length) procesarArchivosAccion(files);
}

/** Quita una foto del buffer temporal del modal de acción. */
export function quitarFotoAccion(idx) {
  accionFotosTemp.splice(idx, 1);
  renderPreviewFotosAccion();
}

/** Pide confirmación antes de eliminar la acción correctiva actualmente abierta en el modal. */
export function eliminarAccionActual(id) {
  mostrarConfirmacionKira('¿Eliminar este registro de acción correctiva?', 'Eliminar Acción', () => {
    eliminarAccionDirecta(id);
    cerrar('modalAccion');
  }, 'Eliminar');
}

/**
 * Abre el modal de acción correctiva.
 * @param {Object|null} accionObj - Si viene con datos, es edición; si no, es alta nueva ("sin parada").
 */
export function abrirAccion(accionObj = null) {
  const primeraLinea = lineasActivas()[0]?.id || 'GENERAL';
  const usr = usuarioActual();
  const nombreDefecto = usr?.nombre || usr?.usuario || usr?.username || '';

  if (accionObj) {
    document.getElementById('modalAccionTitulo').textContent = 'Modificar acción correctiva';
    document.getElementById('editAccionId').value = accionObj.id;
    document.getElementById('aLinea').value = accionObj.linea;
    document.getElementById('aHora').value = accionObj.hora;
    document.getElementById('aEquipo').value = accionObj.equipo;
    document.getElementById('aDetalle').value = accionObj.detalle;
    document.getElementById('aResponsable').value = accionObj.responsable || nombreDefecto;
    document.getElementById('btnEliminarAccionContainer').innerHTML = `<button type="button" class="btn bg-rose-600 text-white text-xs hover:bg-rose-700" onclick="eliminarAccionActual('${accionObj.id}')">Eliminar acción</button>`;
    accionFotosTemp = Array.isArray(accionObj.fotos) ? [...accionObj.fotos] : [];
  } else {
    document.getElementById('modalAccionTitulo').textContent = 'Nueva acción correctiva';
    document.getElementById('editAccionId').value = '';
    document.getElementById('aLinea').value = valor('lineaVista') === 'TODAS' ? primeraLinea : valor('lineaVista');
    document.getElementById('aHora').value = new Date().toTimeString().slice(0, 5);
    document.getElementById('aEquipo').value = '';
    document.getElementById('aDetalle').value = '';
    document.getElementById('aResponsable').value = nombreDefecto;
    document.getElementById('btnEliminarAccionContainer').innerHTML = '';
    accionFotosTemp = [];
  }
  renderPreviewFotosAccion();
  abrir('modalAccion');
}

/** Guarda (alta o edición) el registro de acción correctiva del formulario modal. */
export function guardarAccion(e) {
  e.preventDefault();
  const editId = valor('editAccionId');
  const resp = valor('aResponsable').trim();
  const item = {
    id: editId || String(Date.now()),
    linea: valor('aLinea'),
    hora: valor('aHora'),
    equipo: valor('aEquipo').trim(),
    detalle: valor('aDetalle').trim(),
    responsable: resp,
    fotos: [...accionFotosTemp]
  };

  const s = sesion();
  const usr = usuarioActual();
  if (usr && (usr.rol === 'produccion' || usr.rol === 'operario') && (usr.nombre || usr.usuario)) {
    s.operarioProduccion = usr.nombre || usr.usuario;
  } else if (resp && (!s.operarioProduccion || s.operarioProduccion === 'Operario Producción')) {
    s.operarioProduccion = resp;
  }

  if (editId) {
    const idx = s.acciones.findIndex(x => x.id === editId);
    if (idx !== -1) s.acciones[idx] = item;
  } else {
    s.acciones.push(item);
  }
  s.actualizada = new Date().toISOString();
  persistir();
  cerrar('modalAccion');
  renderTodo();
  if (typeof window.renderVistaPlanta === 'function') window.renderVistaPlanta();
  emitirSincronizacionBloque('guardarAccion');
  mostrarAlertaKira('Acción correctiva guardada y enviada a Vista de Planta.', 'Acciones Correctivas', 'exito');
}

/** Elimina una acción correctiva sin pedir confirmación adicional (ya se confirmó en eliminarAccionActual). */
export function eliminarAccionDirecta(id) {
  const s = sesion();
  s.acciones = s.acciones.filter(x => x.id !== id);
  persistir();
  renderTodo();
  if (typeof window.renderVistaPlanta === 'function') window.renderVistaPlanta();
  emitirSincronizacionBloque('eliminarAccion');
}

/** Abre el modal de acción correctiva en modo edición, buscando el registro por id. */
export function editarAccion(id) {
  const accion = sesion().acciones.find(x => x.id === id);
  if (!accion) return;
  abrirAccion(accion);
}

// ==========================================================
// EXPOSICIÓN A window
// ----------------------------------------------------------
window.abrirAccion = abrirAccion;
window.guardarAccion = guardarAccion;
window.editarAccion = editarAccion;
window.eliminarAccionDirecta = eliminarAccionDirecta;
window.eliminarAccionActual = eliminarAccionActual;
window.subirFotosAccion = subirFotosAccion;
window.soltarFotosAccion = soltarFotosAccion;
window.quitarFotoAccion = quitarFotoAccion;