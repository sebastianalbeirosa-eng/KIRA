/* ========================================================== */
/* KIRA Industrial Software Platform — ARCHIVO RAÍZ            */
/* Control de Tiempos Muertos, Vacíos de Horno y Acciones      */
/* ========================================================== */
/*
  Este archivo YA NO contiene la lógica de negocio de KIRA.
  Su único trabajo es:
    1. Importar todos los módulos del sistema.
    2. Arrancar la aplicación al cargar la página.
    3. Alojar las pocas funciones "orquestadoras" que necesitan
       tocar varios módulos a la vez (cambiar de pestaña, cambiar
       de sesión) — por eso viven acá y no en un módulo específico.

  MIGRACIÓN COMPLETA — los 17 archivos de nucleo/ + modulos/ existen:
    nucleo/almacenamiento.js, estado.js, utilidades.js, alertasKira.js
    modulos/clasificacionEquipos.js, gestionParadas.js, accionesCorrectivas.js,
    vistaDePlanta.js, notasTurno.js, gestionDefectos.js, indicadoresYObjetivos.js,
    constructorPlanta.js, graficosYAnalisis.js, historicos.js, exportarExcel.js,
    generarAsakai.js, gestionTurno.js

  NOTA DE ARQUITECTURA (dependencia circular controlada):
  Este archivo importa renderConstructor desde constructorPlanta.js,
  y constructorPlanta.js importa refrescarSelectoresLineas desde ACÁ.
  Es seguro en ES6 modules porque ambos usos ocurren dentro de
  cuerpos de función, nunca al cargar el módulo (ver nota completa
  en constructorPlanta.js).
*/

import { db, persistir } from './nucleo/almacenamiento.js';
import { asegurarModeloPlanta, sesion, lineasActivas } from './nucleo/estado.js';
import { valor, esc, hoyLocal } from './nucleo/utilidades.js';

import { renderTodo, renderVistaPlanta } from './modulos/vistaDePlanta.js';
import { renderAnalisis } from './modulos/graficosYAnalisis.js';
import { renderHistorico } from './modulos/historicos.js';
import { renderConstructor } from './modulos/constructorPlanta.js';
import { determinarTurnoAutomatico } from './modulos/gestionTurno.js';

// ==========================================================
// IMPORTS DE EFECTO SECUNDARIO (SIN LLAVES)
// ----------------------------------------------------------
// Estos 6 módulos no exponen ninguna función que app.js necesite
// llamar directo, PERO sí necesitan CARGARSE igual: es la única
// forma de que sus "window.funcion = funcion" (al final de cada
// archivo) lleguen a ejecutarse. En ES6 modules, un archivo que
// nadie importa (ni directa ni transitivamente) NUNCA se ejecuta,
// aunque exista en el disco. Sin este bloque, los botones que
// llaman a estas funciones desde onclick en index.html tiran
// "ReferenceError: x is not defined" — justo lo que pasaba antes
// de agregar este bloque.
// ==========================================================
import './modulos/clasificacionEquipos.js';
import './modulos/gestionParadas.js';
import './modulos/accionesCorrectivas.js';
import './modulos/indicadoresYObjetivos.js';
import './modulos/exportarExcel.js';
import './modulos/generarAsakai.js';
import './modulos/asistenteChat.js';

// ==========================================================
// ARRANQUE DE LA APLICACIÓN
// ==========================================================
asegurarModeloPlanta();

/**
 * Cambia de pestaña en la barra lateral y dispara el render
 * correspondiente a la vista que se acaba de mostrar.
 * Vive acá (y no en un módulo de "interfaz") porque orquesta
 * renders de CASI TODOS los módulos de features.
 */
export function mostrarTab(tab) {
  ['planta', 'analisis', 'historico', 'dash', 'constructor', 'acerca'].forEach(x => {
    document.getElementById('vista' + x[0].toUpperCase() + x.slice(1)).classList.toggle('hidden', x !== tab);
    document.getElementById('tab' + x[0].toUpperCase() + x.slice(1)).className = `side-link ${x === tab ? 'active' : ''}`;
  });
  document.getElementById('headerOperativo').classList.toggle('hidden', tab === 'acerca');
  if (tab === 'planta') renderVistaPlanta();
  if (tab === 'historico') renderHistorico();
  if (tab === 'analisis') renderAnalisis();
  if (tab === 'constructor') renderConstructor();
}

/**
 * Se dispara al cambiar fecha/turno en el header operativo.
 * Recarga el supervisor de la nueva sesión y refresca la vista activa.
 */
export function cambiarSesion() {
  const s = sesion();
  document.getElementById('supervisor').value = s.supervisor || '';
  renderTodo();
  if (!document.getElementById('vistaAnalisis').classList.contains('hidden')) renderAnalisis();
  if (!document.getElementById('vistaPlanta').classList.contains('hidden')) renderVistaPlanta();
}

/** Guarda el nombre del supervisor cargado en el header operativo. */
export function guardarMeta() {
  const s = sesion();
  s.supervisor = valor('supervisor').trim();
  s.actualizada = new Date().toISOString();
  persistir();
}

/**
 * Repuebla todos los selectores de línea de la interfaz (vista, histórico,
 * acción, defecto) según las líneas activas del modelo de planta actual.
 */
export function refrescarSelectoresLineas() {
  const activas = lineasActivas();
  const opciones = activas.map(l => `<option value="${esc(l.id)}">${esc(l.nombre)}</option>`).join('');

  const vista = document.getElementById('lineaVista');
  const vistaAnterior = vista?.value || 'TODAS';
  if (vista) {
    vista.innerHTML = `<option value="TODAS">Todas las líneas</option>${opciones}`;
    vista.value = vistaAnterior === 'TODAS' || activas.some(l => l.id === vistaAnterior) ? vistaAnterior : 'TODAS';
  }

  const historico = document.getElementById('histLinea');
  const histAnterior = historico?.value || '';
  if (historico) {
    historico.innerHTML = `<option value="">Todas</option>${opciones}<option value="GENERAL">Otras paradas</option>`;
    historico.value = histAnterior;
  }

  const accion = document.getElementById('aLinea');
  const accionAnterior = accion?.value || '';
  if (accion) {
    accion.innerHTML = `${opciones}<option value="GENERAL">General / planta</option>`;
    accion.value = activas.some(l => l.id === accionAnterior) ? accionAnterior : (activas[0]?.id || 'GENERAL');
  }

  const defecto = document.getElementById('dLinea');
  const defectoAnterior = defecto?.value || '';
  if (defecto) {
    defecto.innerHTML = `${opciones}<option value="GENERAL">General / planta</option>`;
    defecto.value = activas.some(l => l.id === defectoAnterior) ? defectoAnterior : (activas[0]?.id || 'GENERAL');
  }
}

// ==========================================================
// INICIALIZACIÓN AL CARGAR LA PÁGINA
// ----------------------------------------------------------
// Equivalente al viejo window.addEventListener('load', ...) del
// app.js monolítico: precarga fecha/turno de hoy, rango del
// histórico, y dispara el primer render de la sesión activa.
// ==========================================================
window.addEventListener('load', () => {
  refrescarSelectoresLineas();

  document.getElementById('fecha').value = hoyLocal();
  document.getElementById('turno').value = determinarTurnoAutomatico(); // Asignación automática por horario
  document.getElementById('histDesde').value = hoyLocal().slice(0, 8) + '01';
  document.getElementById('histHasta').value = hoyLocal();

  cambiarSesion();
});

// ==========================================================
// EXPOSICIÓN A window
// ----------------------------------------------------------
// mostrarTab, cambiarSesion y guardarMeta se llaman desde
// onclick="..." / onchange="..." en index.html.
// ==========================================================
window.mostrarTab = mostrarTab;
window.cambiarSesion = cambiarSesion;
window.guardarMeta = guardarMeta;