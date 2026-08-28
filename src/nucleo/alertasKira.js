/* ========================================================== */
/* ALERTAS-KIRA.JS — Modales de aviso y confirmación propios   */
/* ========================================================== */
/*
  Reemplaza por completo a los alert()/confirm() nativos del navegador
  por modales con el estilo visual de KIRA. Usado transversalmente
  por casi todos los módulos (gestionParadas, gestionDefectos,
  accionesCorrectivas, historicos, gestionTurno, etc.)
*/

import { esc } from './utilidades.js';

/**
 * Muestra un aviso simple con un solo botón "Aceptar".
 * @param {string} mensaje - Texto a mostrar (puede tener \n para saltos de línea)
 * @param {string} titulo - Título del modal
 * @param {'info'|'error'|'exito'} tipo - Define el color del borde superior
 * @param {Function|null} onAceptar - Callback opcional al aceptar
 */
export function mostrarAlertaKira(mensaje, titulo = "Aviso del Sistema", tipo = "info", onAceptar = null) {
  const modal = document.getElementById('kiraModalAlerta');
  const txtMensaje = document.getElementById('kiraAlertaMensaje');
  const txtTitulo = document.getElementById('kiraAlertaTitulo');
  const contenedorBotones = document.getElementById('kiraAlertaBotones');
  const panelBorde = modal?.querySelector('.panel');

  if (!modal || !txtMensaje) return;

  txtMensaje.innerHTML = esc(mensaje).replace(/\n/g, '<br>');
  txtTitulo.textContent = titulo;

  // Botón de confirmación simple
  contenedorBotones.innerHTML = `
    <button id="btnKiraAceptar" class="btn px-5 py-2 bg-sky-700 text-white text-xs font-bold hover:bg-sky-800 rounded shadow-sm">
      Aceptar
    </button>
  `;

  if (panelBorde) {
    panelBorde.className = panelBorde.className.replace(/border-t-4 border-t-\w+-\d+/g, '');
    if (tipo === 'error') panelBorde.classList.add('border-t-4', 'border-t-rose-600');
    else if (tipo === 'exito') panelBorde.classList.add('border-t-4', 'border-t-emerald-600');
    else panelBorde.classList.add('border-t-4', 'border-t-sky-600');
  }

  document.getElementById('btnKiraAceptar').onclick = () => {
    cerrarKiraAlerta();
    if (typeof onAceptar === 'function') onAceptar();
  };

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

/**
 * Muestra un modal de confirmación con botones "Cancelar" y de acción.
 * @param {string} mensaje - Texto de la pregunta
 * @param {string} titulo - Título del modal
 * @param {Function} onConfirmar - Callback que se ejecuta si el usuario confirma
 * @param {string} textoBotonConfirmar - Texto del botón de confirmación (ej: "Eliminar")
 *
 * NOTA HISTÓRICA: esta función estaba duplicada en el app.js original;
 * la segunda definición pisaba a esta y el parámetro textoBotonConfirmar
 * quedaba siempre ignorado (el botón decía "Sí, Borrar Pantalla" en TODOS
 * los casos, incluso al eliminar paradas/defectos/acciones). Corregido
 * al modularizar: ahora es la única definición y el texto del botón
 * respeta lo que le pase cada llamada.
 */
export function mostrarConfirmacionKira(mensaje, titulo = "Confirmación Requerida", onConfirmar, textoBotonConfirmar = "Confirmar") {
  const modal = document.getElementById('kiraModalAlerta');
  const txtMensaje = document.getElementById('kiraAlertaMensaje');
  const txtTitulo = document.getElementById('kiraAlertaTitulo');
  const contenedorBotones = document.getElementById('kiraAlertaBotones');
  const panelBorde = modal?.querySelector('.panel');

  if (!modal || !txtMensaje) return;

  txtMensaje.innerHTML = esc(mensaje).replace(/\n/g, '<br>');
  txtTitulo.textContent = titulo;

  // Inyección de botones sin disparar ningún cuadro nativo del navegador
  contenedorBotones.innerHTML = `
    <button id="btnKiraCancelar" class="btn px-4 py-2 bg-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-300 rounded shadow-sm">
      Cancelar
    </button>
    <button id="btnKiraConfirmarAccion" class="btn px-4 py-2 bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 rounded shadow-sm">
      ${esc(textoBotonConfirmar)}
    </button>
  `;

  if (panelBorde) {
    panelBorde.className = panelBorde.className.replace(/border-t-4 border-t-\w+-\d+/g, '');
    panelBorde.classList.add('border-t-4', 'border-t-amber-500');
  }

  document.getElementById('btnKiraCancelar').onclick = () => cerrarKiraAlerta();

  document.getElementById('btnKiraConfirmarAccion').onclick = () => {
    cerrarKiraAlerta();
    if (typeof onConfirmar === 'function') onConfirmar();
  };

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

/** Cierra el modal de alerta/confirmación de KIRA. */
export function cerrarKiraAlerta() {
  const modal = document.getElementById('kiraModalAlerta');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

// ==========================================================
// EXPOSICIÓN A window
// ----------------------------------------------------------
// cerrarKiraAlerta() se llama desde onclick="cerrarKiraAlerta()"
// generado dentro del propio innerHTML de este módulo.
// ==========================================================
window.cerrarKiraAlerta = cerrarKiraAlerta;