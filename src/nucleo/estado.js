/* ========================================================== */
/* ESTADO.JS — Modelo de planta y sesión activa               */
/* ========================================================== */
/*
  Acá vive el "cerebro" de KIRA: la estructura de líneas/equipos
  de la planta, y la sesión de turno actualmente en pantalla.

  Nota de arquitectura: tipoEquipo() vive acá (y no en
  clasificacionEquipos.js, donde semánticamente encajaría mejor)
  para evitar una dependencia circular: crearLineaInicial() la
  necesita para construir el modelo de planta, y clasificacionEquipos.js
  ya importa varias funciones de este archivo. El flujo de dependencias
  de todo KIRA va siempre en un solo sentido: modulos/ → nucleo/,
  nunca al revés.
*/

import { db, persistir } from './almacenamiento.js';
import { valor } from './utilidades.js';

// Duración de un turno de trabajo en minutos (8 horas). Se usa en todos
// los cálculos de disponibilidad, porcentajes de parada/vacío, etc.
export const TURNO_MIN = 480;

// Inventario inicial de equipos por línea. Se usa solo la primera vez
// que se arma el modelo de planta; después el Constructor de Planta
// administra los equipos de forma dinámica.
export const EQUIPOS_INICIALES = {
  L1: ['Prensa 1', 'Prensa 2', 'Secadero', 'Transporte línea esmalte', 'Cabina de agua', 'Campanas de esmaltado', 'Rotocolor', 'Kerajet', 'Rotomatrix', 'Maxi SIMA', 'Maxi SITI', 'Entrada de horno'],
  L2: ['Prensa 3', 'Prensa 4', 'Prensa 5', 'Secadero', 'Transporte línea esmalte', 'Cabina de agua', 'Campanas de esmaltado', 'Rotocolor', 'Kerajet', 'Rotomatrix', 'Maxi SIMA', 'Maxi SITI', 'Entrada de horno'],
  GENERAL: ['Parada de línea', 'Parada de planta', 'Horno de cocción', 'Línea de selección', 'Servicios generales', 'Otro sector']
};

// Índice rápido { lineaId: [nombresDeEquiposActivos] }, se reconstruye
// cada vez que cambia el modelo de planta (ver actualizarIndiceEquipos).
export let equipos = {};

/**
 * Determina el "tipo" de un equipo según su nombre, para poder
 * asignarle el catálogo de motivos de parada correspondiente.
 * Función pura, sin dependencias — por eso puede vivir en el núcleo.
 */
export function tipoEquipo(nombre) {
  if (!nombre) return 'General';
  if (nombre.includes('Prensa')) return 'Prensa';
  if (nombre.includes('Secadero')) return 'Secadero';
  if (['Kerajet', 'Rotocolor', 'Rotomatrix'].some(x => nombre.includes(x))) return 'Digital';
  if (['Transporte', 'SIMA', 'SITI', 'Entrada'].some(x => nombre.includes(x))) return 'Transporte';
  if (['Cabina', 'Campanas'].some(x => nombre.includes(x))) return 'Esmalte';
  return 'General';
}

/** Crea la estructura inicial de una línea de producción con sus equipos. */
export function crearLineaInicial(id, nombre, descripcion, nombresEquipos) {
  return {
    id,
    nombre,
    descripcion,
    activa: true,
    equipos: nombresEquipos.map((nombreEquipo, i) => ({
      id: `${id}-E${String(i + 1).padStart(2, '0')}`,
      nombre: nombreEquipo,
      tipo: tipoEquipo(nombreEquipo),
      activo: true
    }))
  };
}

/**
 * Normaliza nombres de equipos históricos: unifica "Maxi SIMA 1" / "Maxi SIMA 2"
 * bajo el mismo nombre base "Maxi SIMA", para que el histórico los reconozca
 * como el mismo equipo aunque la variante haya cambiado.
 */
export function normalizarEquipoHistorico(nombre = '') {
  const val = String(nombre).trim();
  return (val.includes('Maxi SIMA') || val.includes('Maxi SITI'))
    ? val.replace(/ [12]$/, '').trim()
    : val;
}

/**
 * Garantiza que db.planta exista con la estructura mínima esperada.
 * Se llama una sola vez al arrancar la aplicación (ver app.js).
 * También repara vínculos equipoId faltantes en paradas históricas.
 */
export function asegurarModeloPlanta() {
  if (!db.sesiones) db.sesiones = {};
  if (!db.planta || !Array.isArray(db.planta.lineas)) {
    db.planta = {
      version: 1,
      lineas: [
        crearLineaInicial('L1', 'Línea 1', 'Prensas 1 y 2', EQUIPOS_INICIALES.L1),
        crearLineaInicial('L2', 'Línea 2', 'Prensas 3, 4 y 5', EQUIPOS_INICIALES.L2)
      ]
    };
  }

  Object.values(db.sesiones).forEach(s => {
    (s.paradas || []).forEach(p => {
      if (p.equipoId) return;
      const linea = db.planta.lineas.find(l => l.id === p.linea);
      const base = normalizarEquipoHistorico(p.equipo);
      const eq = linea?.equipos.find(e => e.nombre === base);
      if (eq) p.equipoId = eq.id;
    });
  });
  actualizarIndiceEquipos();
  persistir();
}

/** Reconstruye el índice rápido "equipos" a partir del modelo de planta actual. */
export function actualizarIndiceEquipos() {
  equipos = { GENERAL: [...EQUIPOS_INICIALES.GENERAL] };
  db.planta.lineas.forEach(l => {
    equipos[l.id] = l.equipos.filter(e => e.activo !== false).map(e => e.nombre);
  });
}

/** Devuelve solo las líneas de producción marcadas como activas. */
export function lineasActivas() {
  return db.planta.lineas.filter(l => l.activa !== false);
}

/** Busca una línea por su id. */
export function lineaPorId(id) {
  return db.planta.lineas.find(l => l.id === id);
}

/** Devuelve el nombre visible de una línea (o "Otras paradas" para GENERAL). */
export function nombreLinea(id) {
  if (id === 'GENERAL') return 'Otras paradas';
  return lineaPorId(id)?.nombre || id;
}

/** Busca un equipo dentro de una línea por su id. */
export function equipoPorId(lineaId, equipoId) {
  return lineaPorId(lineaId)?.equipos.find(e => e.id === equipoId);
}

/** Busca un equipo dentro de una línea por su nombre (normalizado). */
export function equipoPorNombre(lineaId, nombre) {
  const base = normalizarEquipoHistorico(nombre);
  return lineaPorId(lineaId)?.equipos.find(e => e.nombre === base);
}

/** Construye la clave única 'fecha|turno' que identifica una sesión de trabajo. */
export function claveSesion(fecha = valor('fecha'), turno = valor('turno')) {
  return `${fecha}|${turno}`;
}

/** Crea una sesión de turno nueva y vacía, con los valores por defecto de KIRA. */
export function nuevaSesion() {
  return {
    supervisor: '',
    paradas: [],
    acciones: [],
    defectos: [],
    notaTurno: '', // observaciones generales del turno, mostradas en Vista de Planta
    indicadores: { calidad: 0, objCalidad: 95, productividad: 0, objProductividad: 90, objEficiencia: 90, objVacio: 30 },
    objetivos: {
      l1: { calidad: 92.00, produccion: 5600, vacioMax: 30 },
      l2: { calidad: 90.00, produccion: 5200, vacioMax: 30 },
      planta: { calidad: 91.00, produccion: 10800, vacioMax: 60 }
    },
    actualizada: new Date().toISOString()
  };
}

/** Devuelve la sesión de turno actualmente activa (fecha + turno seleccionados). */
export function sesion() {
  const fecha = valor('fecha');
  const turno = valor('turno');
  const key = claveSesion(fecha, turno);
  if (!db.sesiones[key]) db.sesiones[key] = nuevaSesion();
  // BUG HEREDADO CORREGIDO: el campo "turno" nunca quedaba guardado
  // dentro del objeto de sesión (solo se usaba para armar la clave
  // de almacenamiento). Esto hacía que el cálculo de Rendimiento en
  // vistaDePlanta.js siempre asumiera turno "Mañana" (hora de inicio
  // 5) sin importar el turno real, para Tarde y Noche. Se sincroniza
  // acá, en cada acceso, así también repara sesiones viejas guardadas
  // antes de este fix.
  db.sesiones[key].turno = turno;
  return db.sesiones[key];
}

/*
  OBJETIVOS — Inicialización y compatibilidad de sesión
  ------------------------------------------------------------
  El objetivo de quemado es por línea y aplica a los 3 turnos.
  Las lecturas reales pertenecen al turno/sesión actual.
*/

/** Garantiza que la sesión tenga la estructura de objetivos por línea, migrando datos viejos si hace falta. */
export function asegurarObjetivosSesion(s) {
  if (!s.objetivos) s.objetivos = {};
  if (!s.objetivos.porLinea) {
    s.objetivos.porLinea = {};
    if (s.objetivos.l1) s.objetivos.porLinea['L1'] = { ...s.objetivos.l1 };
    if (s.objetivos.l2) s.objetivos.porLinea['L2'] = { ...s.objetivos.l2 };
  }

  lineasActivas().forEach(l => {
    if (!s.objetivos.porLinea[l.id]) {
      s.objetivos.porLinea[l.id] = {
        calidad: 90, produccion: 0, vacioMax: 30,
        rendimientoObj: 0, realCalidad: 0, realProd: 0,
        // Tomas reales de m² quemados (POR TURNO): SOLO hora + valor. El
        // formato/ciclo con que se evalúa cada toma se deduce de los eventos
        // de producción del DÍA (db.produccionDia), no de acá.
        lecturasQuemado: Array(3).fill(null).map(() => ({ hora: '', real: 0 })),
        // Objetivo dinámico de m²/turno, calculado a partir de los eventos del día.
        produccionProyectada: 0
      };
    } else {
      const o = s.objetivos.porLinea[l.id];
      if (typeof o.rendimientoObj !== 'number') o.rendimientoObj = 0;
      if (!Array.isArray(o.lecturasCalidad)) {
        o.lecturasCalidad = Array(8).fill(null).map(() => ({ hora: '', global: null, parcial: null }));
      }

      // lecturasQuemado se normaliza a solo {hora, real}.
      if (!Array.isArray(o.lecturasQuemado)) {
        o.lecturasQuemado = Array(3).fill(null).map(() => ({ hora: '', real: 0 }));
      } else {
        o.lecturasQuemado = o.lecturasQuemado.map(t => ({
          hora: t?.hora || '',
          real: Number(t?.real) || 0
        }));
      }

      if (typeof o.produccionProyectada !== 'number') o.produccionProyectada = 0;
      // NOTA: o.eventosProduccion (modelo viejo por turno) se conserva si
      // existe en storage, para que eventosProduccionDia() pueda migrarlo.
    }
  });
}

/**
 * Devuelve el catálogo de formatos de horno guardado en la base (o null si
 * nunca se personalizó). Vive a nivel global de la app, no por sesión, porque
 * los formatos son un dato de planta común a todos los turnos.
 */
export function formatosHornoGuardados() {
  return Array.isArray(db.formatosHorno) ? db.formatosHorno : null;
}

/** Persiste el catálogo de formatos de horno en la base. */
export function guardarFormatosHorno(lista) {
  db.formatosHorno = Array.isArray(lista) ? lista : [];
  persistir();
}

/* ==========================================================
   PRODUCCIÓN CONTINUA DEL DÍA (eventos de producto/ciclo)
   ----------------------------------------------------------
   La producción del horno es un proceso continuo de 24 h: el producto y el
   ciclo que corren no se reinician al cambiar de turno. Por eso los eventos
   de producción (producto inicial + cambios de producto/ciclo) viven a NIVEL
   DEL DÍA y por línea, compartidos por los 3 turnos de esa fecha:

       db.produccionDia[fecha][lineaId] = [ {tipo, hora, producto, formatoId, ciclo}, ... ]

   Así el operario solo carga cambios cuando realmente ocurren; el producto
   vigente lo hereda del último evento del día, sin recargarlo cada turno.
   ========================================================== */

/**
 * Devuelve la lista de eventos de producción del día para una línea.
 * Si nunca se cargó nada, migra automáticamente desde los eventos que
 * hubiera guardados por turno en las sesiones de esa fecha (modelo viejo),
 * para no perder datos ya cargados.
 * @param {string} lineaId
 * @param {string} fecha  fecha administrativa del día (por defecto la seleccionada)
 */
export function eventosProduccionDia(lineaId, fecha = valor('fecha')) {
  if (!db.produccionDia) db.produccionDia = {};
  if (!db.produccionDia[fecha]) db.produccionDia[fecha] = {};

  if (!Array.isArray(db.produccionDia[fecha][lineaId])) {
    // Migración: juntar los eventos que pudieran existir en las 3 sesiones
    // (turnos) de esta fecha para esta línea, deduplicando por hora.
    const migrados = [];
    const vistos = new Set();
    Object.entries(db.sesiones || {}).forEach(([key, s]) => {
      if (!key.startsWith(fecha + '|')) return;
      const evs = s.objetivos?.porLinea?.[lineaId]?.eventosProduccion;
      if (!Array.isArray(evs)) return;
      evs.forEach(ev => {
        if (!ev || (!ev.producto && !ev.formatoId && !ev.ciclo)) return;
        const clave = `${ev.hora}|${ev.producto}|${ev.formatoId}|${ev.ciclo}`;
        if (vistos.has(clave)) return;
        vistos.add(clave);
        migrados.push({
          tipo: ev.tipo || 'producto',
          hora: ev.hora || '',
          producto: ev.producto || '',
          formatoId: ev.formatoId || '',
          ciclo: Number(ev.ciclo) || 0
        });
      });
    });
    migrados.sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));
    // Si el primero no es 'inicial', marcarlo como tal (arranque del día).
    if (migrados.length) migrados[0].tipo = 'inicial';
    else migrados.push({ tipo: 'inicial', hora: '', producto: '', formatoId: '', ciclo: 0 });
    db.produccionDia[fecha][lineaId] = migrados;
  }

  return db.produccionDia[fecha][lineaId];
}

/** Guarda la lista de eventos de producción del día para una línea. */
export function guardarEventosProduccionDia(lineaId, eventos, fecha = valor('fecha')) {
  if (!db.produccionDia) db.produccionDia = {};
  if (!db.produccionDia[fecha]) db.produccionDia[fecha] = {};
  db.produccionDia[fecha][lineaId] = Array.isArray(eventos) ? eventos : [];
  persistir();
}

/** Garantiza que la sesión tenga la estructura de producto/formato por línea. */
export function asegurarProduccionSesion(s) {
  if (!s.productoPorLinea) s.productoPorLinea = {};
  lineasActivas().forEach(l => {
    if (!s.productoPorLinea[l.id]) {
      s.productoPorLinea[l.id] = { producto: '', formato: '' };
    }
  });
}

/** Guarda el producto o formato cargado para una línea en la sesión actual. */
export function guardarProduccionLinea(lineaId, campo, valorNuevo) {
  const s = sesion();
  asegurarProduccionSesion(s);
  s.productoPorLinea[lineaId][campo] = valorNuevo.trim();
  s.actualizada = new Date().toISOString();
  persistir();
}

// ==========================================================
// EXPOSICIÓN A window
// ----------------------------------------------------------
// guardarProduccionLinea: única función de este archivo que se
// llama directo desde onchange="..." generado dinámicamente en
// vistaDePlanta.js (inputs de producto/formato por línea). El
// resto de nucleo/estado.js no necesita esto porque nada más de
// acá se invoca directo desde el HTML.
// ==========================================================
window.guardarProduccionLinea = guardarProduccionLinea;