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
    vistaDePlanta.js, notasTurno.js, gestionDefectos.js, cargaCalidad.js,
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
import { asegurarModeloPlanta, sesion, lineasActivas, asegurarObjetivosSesion } from './nucleo/estado.js';
import { valor, esc, hoyLocal } from './nucleo/utilidades.js';

import { renderTodo, renderVistaPlanta } from './modulos/vistaDePlanta.js';
import { renderAnalisis } from './modulos/graficosYAnalisis.js';
import { renderHistorico } from './modulos/historicos.js';
import { renderConstructor } from './modulos/constructorPlanta.js';
import { determinarTurnoAutomatico, detectarNuevoTurno } from './modulos/gestionTurno.js';
import { permisosActuales, puedeVerTab, areaDelRol } from './nucleo/roles.js';
import { renderUsuarios } from './modulos/gestionUsuarios.js';

// ==========================================================
// GESTIÓN DE SESIÓN DE USUARIO
// ==========================================================

let tiempoBloqueo = null;
let intervalTiempoBloqueo = null;

window.cargarInfoUsuario = function() {
  const sesion = sessionStorage.getItem('kiraSession') || localStorage.getItem('kiraSession');
  
  if (sesion) {
    try {
      const datos = JSON.parse(sesion);
      document.getElementById('usuarioNombre').textContent = datos.nombre;
      document.getElementById('usuarioRol').textContent = `Rol: ${datos.rol.charAt(0).toUpperCase() + datos.rol.slice(1)}`;
    } catch (e) {
      console.error('Error al cargar información del usuario:', e);
    }
  }
}

window.cerrarSesion = function() {
  if (confirm('¿Estás seguro de que querés cerrar sesión?')) {
    sessionStorage.removeItem('kiraSession');
    localStorage.removeItem('kiraSession');
    window.location.href = 'login.html';
  }
}

window.bloquearSesion = function() {
  const sesion = sessionStorage.getItem('kiraSession') || localStorage.getItem('kiraSession');
  
  if (!sesion) {
    window.location.href = 'login.html';
    return;
  }
  
  try {
    const datos = JSON.parse(sesion);
    
    // Guardar datos de bloqueo
    tiempoBloqueo = Date.now();
    sessionStorage.setItem('sesionBloqueada', JSON.stringify({
      usuario: datos.usuario,
      nombre: datos.nombre,
      timestamp: tiempoBloqueo
    }));
    
    // Mostrar pantalla de bloqueo
    document.getElementById('pantallaBloqueo').style.display = 'flex';
    document.getElementById('bloqueoUsuarioNombre').textContent = datos.nombre;
    document.getElementById('passwordDesbloqueo').value = '';
    document.getElementById('passwordDesbloqueo').focus();
    
    // Actualizar tiempo de bloqueo cada minuto
    actualizarTiempoBloqueo();
    intervalTiempoBloqueo = setInterval(actualizarTiempoBloqueo, 60000);
    
  } catch (e) {
    console.error('Error al bloquear sesión:', e);
  }
}

function actualizarTiempoBloqueo() {
  if (!tiempoBloqueo) return;
  
  const ahora = Date.now();
  const diff = ahora - tiempoBloqueo;
  const minutos = Math.floor(diff / 60000);
  
  let texto = '';
  if (minutos < 1) {
    texto = 'Bloqueado hace unos momentos';
  } else if (minutos === 1) {
    texto = 'Bloqueado hace 1 minuto';
  } else if (minutos < 60) {
    texto = `Bloqueado hace ${minutos} minutos`;
  } else {
    const horas = Math.floor(minutos / 60);
    const mins = minutos % 60;
    texto = `Bloqueado hace ${horas}h ${mins}m`;
  }
  
  document.getElementById('tiempoBloqueo').textContent = texto;
}

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
  // Control de acceso: si el rol no puede ver esa pestaña, se redirige a la
  // pestaña inicial de su rol (defensa por si se llama mostrarTab a mano).
  if (!puedeVerTab(tab)) {
    tab = permisosActuales().tabInicial;
  }
  ['planta', 'analisis', 'historico', 'dash', 'constructor', 'acerca', 'usuarios'].forEach(x => {
    const vista = document.getElementById('vista' + x[0].toUpperCase() + x.slice(1));
    const boton = document.getElementById('tab' + x[0].toUpperCase() + x.slice(1));
    if (vista) vista.classList.toggle('hidden', x !== tab);
    if (boton) boton.className = `side-link ${x === tab ? 'active' : ''}`;
  });
  document.getElementById('headerOperativo').classList.toggle('hidden', tab === 'acerca' || tab === 'usuarios');
  if (tab === 'planta') renderVistaPlanta();
  if (tab === 'historico') renderHistorico();
  if (tab === 'analisis') renderAnalisis();
  if (tab === 'constructor') renderConstructor();
  if (tab === 'usuarios') renderUsuarios();
}

/**
 * Aplica los permisos del rol al menú lateral: oculta los botones de las
 * pestañas que el rol no puede ver y abre su pestaña inicial. Se llama una
 * vez al arrancar la app, después de conocer el rol de la sesión.
 */
export function aplicarPermisosMenu() {
  const permisos = permisosActuales();

  // 1) Pestañas del menú lateral según el rol.
  ['planta', 'analisis', 'historico', 'dash', 'constructor', 'acerca', 'usuarios'].forEach(x => {
    const boton = document.getElementById('tab' + x[0].toUpperCase() + x.slice(1));
    if (boton) boton.classList.toggle('hidden', !permisos.tabs.includes(x));
  });

  // 2) Elementos marcados con data-cap="...": visibles solo si el rol tiene
  //    esa capacidad. Sirve para separar la carga de datos (calidad vs
  //    producción) dentro de una misma pestaña.
  document.querySelectorAll('[data-cap]').forEach(el => {
    const cap = el.getAttribute('data-cap');
    el.classList.toggle('hidden', !permisos.caps[cap]);
  });

  // 3) Modo solo-lectura (supervisor): marca el body para que el CSS oculte
  //    los botones/acciones editables (ej. "Eliminar" en el histórico).
  document.body.classList.toggle('rol-solo-lectura', !!permisos.caps.soloLectura);

  // 3b) Título del header según el rol: calidad ve "Control de Calidad".
  const tit = document.getElementById('tituloApp');
  const sub = document.getElementById('subtituloApp');
  if (tit && sub) {
    if (areaDelRol() === 'calidad') {
      tit.textContent = 'Control de Calidad';
      sub.textContent = 'Monitoreo de Defectos y Desvíos';
    } else {
      tit.textContent = 'Control Operativo de Producción';
      sub.textContent = 'Gestión de paradas, vacío de horno y acciones correctivas';
    }
  }

  // 4) Abrir la pestaña inicial del rol.
  mostrarTab(permisos.tabInicial);
}

/**
 * Se dispara al cambiar fecha/turno en el header operativo.
 * Recarga el supervisor de la nueva sesión y refresca la vista activa.
 */
export function cambiarSesion() {
  const s = sesion();
  document.getElementById('supervisor').value = s.supervisor || '';
  cargarCabeceraCalidad();
  renderTodo();
  if (!document.getElementById('vistaAnalisis').classList.contains('hidden')) renderAnalisis();
  if (!document.getElementById('vistaPlanta').classList.contains('hidden')) renderVistaPlanta();
}

/**
 * Rellena los campos de cabecera propios del rol calidad (operario, producto,
 * formato) desde la sesión. El operario es por línea (la monitoreada); el
 * producto/formato son de la sesión. Se llama al cambiar sesión o de línea.
 */
export function cargarCabeceraCalidad() {
  const s = sesion();
  const lineaId = valor('lineaVista');
  const lid = (lineaId && lineaId !== 'TODAS' && lineaId !== 'GENERAL') ? lineaId : (lineasActivas()[0]?.id || '');
  asegurarObjetivosSesion(s);

  // Producto/formato VIGENTE: se toma de las tomas de calidad (el último
  // producto/formato cargado en una toma). Si aún no hay ninguno, cae al valor
  // manual guardado en la sesión.
  const vig = (lid && window.productoVigenteCalidad) ? window.productoVigenteCalidad(lid) : { producto: '', formato: '' };
  const prodEl = document.getElementById('productoCabecera');
  if (prodEl) prodEl.value = vig.producto || s.productoCalidad || '';
  const fmtEl = document.getElementById('formatoCabecera');
  if (fmtEl) fmtEl.value = vig.formato || s.formatoCalidad || '';

  const opEl = document.getElementById('operarioCalidad');
  if (opEl) opEl.value = (lid && s.objetivos?.porLinea?.[lid]?.operarioCalidad) || '';
}

/**
 * Se dispara al cambiar el TURNO en el header. Refresca la sesión (igual que
 * cambiarSesion) y, además, avisa "Nuevo turno detectado", ofreciendo empezar
 * limpio si ese turno ya tenía datos cargados.
 */
export function cambiarTurno() {
  cambiarSesion();
  detectarNuevoTurno(valor('fecha'), valor('turno'));
}

/** Guarda el nombre del supervisor cargado en el header operativo. */
export function guardarMeta() {
  const s = sesion();
  s.supervisor = valor('supervisor').trim();

  // Campos de la cabecera propios del rol calidad (solo existen si están
  // montados). Producto/formato de calidad se guardan a nivel sesión; el
  // operario de calidad, en el objeto de calidad de la línea monitoreada.
  const opEl = document.getElementById('operarioCalidad');
  if (opEl) {
    const lineaId = valor('lineaVista');
    const lid = (lineaId && lineaId !== 'TODAS' && lineaId !== 'GENERAL') ? lineaId : (lineasActivas()[0]?.id || '');
    if (lid) {
      asegurarObjetivosSesion(s);
      const o = s.objetivos?.porLinea?.[lid];
      if (o) o.operarioCalidad = opEl.value.trim();
    }
  }
  const prodEl = document.getElementById('productoCabecera');
  if (prodEl) s.productoCalidad = prodEl.value.trim();
  const fmtEl = document.getElementById('formatoCabecera');
  if (fmtEl) s.formatoCalidad = fmtEl.value.trim();

  s.actualizada = new Date().toISOString();
  persistir();
}

/**
 * Colapsa/expande el menú lateral (sidebar). Útil sobre todo en
 * Vista de Planta y en monitores chicos, para ganar ancho de
 * pantalla. Como el sidebar es un flex-item, al achicarlo el
 * contenido principal (.app-main, que es flex:1) se expande solo,
 * sin necesidad de recalcular nada por JS. La preferencia se
 * recuerda en localStorage entre sesiones.
 */
export function alternarSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  sidebar.classList.toggle('colapsado');
  try {
    localStorage.setItem('kira_sidebar_colapsado', sidebar.classList.contains('colapsado') ? '1' : '0');
  } catch {
    // localStorage puede fallar en navegación privada estricta; no es crítico, se ignora.
  }
}

/**
 * Repuebla todos los selectores de línea de la interfaz (vista, histórico,
 * acción, defecto) según las líneas activas del modelo de planta actual.
 */
export function refrescarSelectoresLineas() {
  const activas = lineasActivas();
  const opciones = activas.map(l => `<option value="${esc(l.id)}">${esc(l.nombre)}</option>`).join('');

  const vista = document.getElementById('lineaVista');
  const vistaAnterior = vista?.value || '';
  if (vista) {
    // Sin opción "Todas las líneas": se debe elegir una línea concreta para
    // no mezclar fechas/turnos de líneas distintas en los gráficos.
    vista.innerHTML = opciones;
    // Conservar la línea previa si sigue activa; si no, seleccionar la primera.
    vista.value = activas.some(l => l.id === vistaAnterior) ? vistaAnterior : (activas[0]?.id || '');
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
  // Cargar información del usuario desde la sesión
  cargarInfoUsuario();
  
  refrescarSelectoresLineas();

  document.getElementById('fecha').value = hoyLocal();
  document.getElementById('turno').value = determinarTurnoAutomatico(); // Asignación automática por horario
  document.getElementById('histDesde').value = hoyLocal().slice(0, 8) + '01';
  document.getElementById('histHasta').value = hoyLocal();

  // Restaurar la preferencia de sidebar colapsado/expandido, si el
  // usuario la había dejado así en una sesión anterior.
  try {
    if (localStorage.getItem('kira_sidebar_colapsado') === '1') {
      document.getElementById('sidebar')?.classList.add('colapsado');
    }
  } catch {
    // localStorage puede fallar en navegación privada estricta; no es crítico, se ignora.
  }

  cambiarSesion();

  // Adaptar el workspace (menú y pestaña inicial) al rol del usuario logueado.
  aplicarPermisosMenu();
});

// ==========================================================
// EXPOSICIÓN A window
// ----------------------------------------------------------
// mostrarTab, cambiarSesion, guardarMeta y alternarSidebar se
// llaman desde onclick="..." / onchange="..." en index.html.
// ==========================================================
window.mostrarTab = mostrarTab;
window.cambiarSesion = cambiarSesion;
window.cambiarTurno = cambiarTurno;
window.guardarMeta = guardarMeta;
window.cargarCabeceraCalidad = cargarCabeceraCalidad;
window.alternarSidebar = alternarSidebar;