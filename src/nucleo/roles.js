/* ========================================================== */
/* ROLES.JS — Modelo central de roles y permisos (RBAC)        */
/* ========================================================== */
/*
  Única fuente de verdad sobre QUÉ puede ver y hacer cada rol.
  Todos los módulos consultan acá; no se decide permiso en ningún
  otro lado. Así, cuando en el futuro esto viaje al backend Flask,
  solo cambia de dónde se lee el rol, no la lógica de permisos.

  Roles:
    - calidad     : carga/edita/borra datos de CALIDAD. Ve planta/análisis/histórico/acerca (lectura).
    - produccion  : carga/edita/borra datos de PRODUCCIÓN. Ve planta/análisis/histórico/acerca (lectura).
    - supervisor  : SOLO visualiza (planta/análisis/histórico). No carga nada.
    - admin       : todo + constructor de planta + gestión de usuarios.
*/

/**
 * Permisos por rol.
 *   tabs        : pestañas del menú lateral que el rol puede ver.
 *   tabInicial  : pestaña que se abre al entrar.
 *   caps        : capacidades (banderas) que habilitan/bloquean acciones.
 *
 * Capacidades:
 *   cargarCalidad     : ver y editar formularios/datos de calidad.
 *   cargarProduccion  : ver y editar formularios/datos de producción.
 *   soloLectura       : true = no puede modificar nada (supervisor).
 *   gestionUsuarios   : administrar usuarios.
 *   constructorPlanta : usar el Constructor de Planta.
 */
export const PERMISOS = {
  calidad: {
    etiqueta: 'Calidad',
    tabs: ['planta', 'analisis', 'historico', 'dash', 'constructor', 'acerca'],
    tabInicial: 'dash',
    caps: { cargarCalidad: true, cargarProduccion: false, soloLectura: false, gestionUsuarios: false, constructorPlanta: true }
  },
  produccion: {
    etiqueta: 'Producción',
    tabs: ['planta', 'analisis', 'historico', 'dash', 'constructor', 'acerca'],
    tabInicial: 'dash',
    caps: { cargarCalidad: false, cargarProduccion: true, soloLectura: false, gestionUsuarios: false, constructorPlanta: true }
  },
  supervisor: {
    etiqueta: 'Supervisor',
    tabs: ['planta', 'analisis', 'historico'],
    tabInicial: 'planta',
    caps: { cargarCalidad: false, cargarProduccion: false, soloLectura: true, gestionUsuarios: false, constructorPlanta: false }
  },
  admin: {
    etiqueta: 'Administrador',
    tabs: ['planta', 'analisis', 'historico', 'dash', 'constructor', 'acerca', 'usuarios'],
    tabInicial: 'planta',
    caps: { cargarCalidad: true, cargarProduccion: true, soloLectura: false, gestionUsuarios: true, constructorPlanta: true }
  }
};

// Rol por defecto si la sesión no trae uno reconocido (comportamiento seguro:
// se asume el más restrictivo con capacidad de ver planta).
const ROL_DEFECTO = 'supervisor';

/**
 * Normaliza el rol leído de la sesión a uno de los 4 válidos.
 * Compatibilidad: el rol viejo 'operario' se mapea a 'produccion'.
 */
export function normalizarRol(rol) {
  const r = (rol || '').toLowerCase();
  if (r === 'operario') return 'produccion';       // migración de rol legacy
  if (PERMISOS[r]) return r;
  return ROL_DEFECTO;
}

/** Lee el rol del usuario logueado desde la sesión (sessionStorage/localStorage). */
export function rolActual() {
  try {
    const raw = sessionStorage.getItem('kiraSession') || localStorage.getItem('kiraSession');
    if (!raw) return ROL_DEFECTO;
    return normalizarRol(JSON.parse(raw).rol);
  } catch {
    return ROL_DEFECTO;
  }
}

/** Devuelve el objeto de permisos del rol actual. */
export function permisosActuales() {
  return PERMISOS[rolActual()] || PERMISOS[ROL_DEFECTO];
}

/** ¿El rol actual tiene la capacidad indicada? (ej: puede('cargarCalidad')) */
export function puede(capacidad) {
  return !!permisosActuales().caps[capacidad];
}

/** ¿El rol actual puede ver la pestaña indicada? */
export function puedeVerTab(tab) {
  return permisosActuales().tabs.includes(tab);
}

/** ¿El rol actual es de solo lectura (no modifica datos)? */
export function esSoloLectura() {
  return !!permisosActuales().caps.soloLectura;
}

/**
 * Área de equipos que corresponde ver/editar al rol actual:
 *   'calidad'    -> solo equipos de calidad (rol calidad)
 *   'produccion' -> solo equipos de producción (rol produccion)
 *   null         -> todas las áreas (admin, supervisor)
 * Usado por el Constructor y las cargas para no mezclar equipos de áreas.
 */
export function areaDelRol() {
  const caps = permisosActuales().caps;
  if (caps.cargarCalidad && !caps.cargarProduccion) return 'calidad';
  if (caps.cargarProduccion && !caps.cargarCalidad) return 'produccion';
  return null; // admin (ambas) o supervisor (solo mira, ve todo)
}
