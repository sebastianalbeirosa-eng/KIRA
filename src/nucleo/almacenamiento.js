/* ========================================================== */
/* ALMACENAMIENTO.JS — Persistencia de datos (localStorage)   */
/* ========================================================== */
/*
  Este módulo es la ÚNICA parte del sistema que sabe que los datos
  viven en localStorage. El resto de KIRA no debería importarle
  "cómo" se guarda, solo llama a cargarDB() / persistir().

  Por qué importa esto para la migración a Electron:
  cuando cambiemos de localStorage a filesystem (o SQLite),
  solo se edita ESTE archivo. Ningún otro módulo se entera del cambio.
*/

// Clave bajo la cual se guarda toda la base de datos de KIRA en localStorage
export const STORAGE_KEY = 'kira_produccion_v3.0';

/**
 * Carga la base de datos completa desde localStorage.
 * Si no existe nada guardado (primer uso) o el JSON está corrupto,
 * devuelve una base de datos vacía con la estructura mínima esperada.
 */
export function cargarDB() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { sesiones: {} };
  } catch {
    return { sesiones: {} };
  }
}

// Base de datos en memoria. Se inicializa una sola vez al cargar el módulo
// y después se muta en el lugar (nunca se reasigna) desde el resto del sistema.
export let db = cargarDB();

/**
 * Recarga la base de datos en memoria desde localStorage mutando el objeto db.
 */
export function recargarDB() {
  try {
    const cargado = cargarDB();
    for (const k of Object.keys(db)) {
      delete db[k];
    }
    Object.assign(db, cargado);
  } catch {}
  return db;
}

export const SYNC_BLOQUE_KEY = 'kira_sync_bloque';
const canalKira = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('kira_sync') : null;

/**
 * Guarda el estado actual de "db" en localStorage (persistencia silenciosa).
 * Se llama tras cualquier cambio para no perder datos en borrador.
 */
export function persistir() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

/**
 * Emite la sincronización en tiempo real en bloque hacia todas las pantallas y pestañas.
 * Se invoca ÚNICAMENTE al presionar botones de guardar, enviar o actualizar datos.
 * @param {string} [origen] - Identificador de la acción (ej: 'guardarParada', 'enviarProduccion')
 */
export function emitirSincronizacionBloque(origen = '') {
  persistir();
  const timestamp = Date.now();
  try {
    localStorage.setItem(SYNC_BLOQUE_KEY, `${timestamp}|${origen}`);
  } catch {}
  try {
    canalKira?.postMessage({ tipo: 'sync_bloque', origen, timestamp });
  } catch {}
}

/**
 * Genera un identificador único simple, combinando timestamp + azar.
 * Se usa para crear IDs de paradas, acciones, defectos, etc.
 * @param {string} prefijo - Texto identificador del tipo de dato (ej: 'parada')
 */
export function crearId(prefijo) {
  return `${prefijo}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}