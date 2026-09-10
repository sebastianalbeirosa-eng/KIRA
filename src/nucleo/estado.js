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
  if (nombre.includes('Qualitron') || nombre.includes('QUALITRON')) return 'Calidad';
  if (['Kerajet', 'Rotocolor', 'Rotomatrix'].some(x => nombre.includes(x))) return 'Digital';
  if (['Transporte', 'SIMA', 'SITI', 'Entrada'].some(x => nombre.includes(x))) return 'Transporte';
  if (['Cabina', 'Campanas'].some(x => nombre.includes(x))) return 'Esmalte';
  return 'General';
}

/**
 * Área a la que pertenece un equipo: siempre 'produccion'. Los equipos del
 * sinóptico (prensas, secadero, ... y el Qualitron) los administra y monitorea
 * el rol producción. Calidad ya no tiene equipos propios: su carga es la
 * planilla de tomas, no el sinóptico. Se mantiene la función (en vez de
 * hardcodear el string) por si en el futuro vuelve a haber equipos por área.
 */
export function areaEquipo() {
  return 'produccion';
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
      area: areaEquipo(nombreEquipo),
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

  // Migración de ÁREA en equipos: todos los equipos del sinóptico son de
  // producción. Los equipos guardados sin 'area' o marcados como 'calidad'
  // (versión anterior, cuando el Qualitron era de calidad) se normalizan a
  // 'produccion'. El Qualitron, si existe, queda como un equipo más de la
  // línea que administra producción (ya no se agrega ni se trata aparte).
  db.planta.lineas.forEach(linea => {
    linea.equipos.forEach(eq => {
      if (eq.area !== 'produccion') eq.area = 'produccion';
    });
  });

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

/**
 * Devuelve los equipos ACTIVOS de una línea, opcionalmente filtrados por área
 * ('calidad' | 'produccion'). Si no se pasa área, devuelve todos. Un equipo sin
 * área definida se considera 'produccion' (compatibilidad con datos viejos).
 */
export function equiposDeLinea(lineaId, area = null) {
  const linea = lineaPorId(lineaId);
  if (!linea) return [];
  return linea.equipos.filter(e => {
    if (e.activo === false) return false;
    if (!area) return true;
    return (e.area || 'produccion') === area;
  });
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

/**
 * Crea/normaliza una "toma" de la planilla de calidad. Cada toma es una columna
 * de la planilla del auditor: TODO lo cargado a cierta hora del turno.
 *   hora        HH:MM de la medición (una sola por toma; el resto cuelga de acá)
 *   global      calidad global acumulada del turno (%)
 *   parcial1    calidad parcial medida en el momento (%)
 *   tono        número de tono medido
 *   m2          m² clasificados
 *   vacioHorno  vacío de horno (min)
 *   segunda     % que se está mandando a segunda calidad (%)
 *   rotura      % de rotura/descarte total en el momento (%)
 *   defectos    [{nombre, pct, aclaracion}] defectos de calidad de esta toma
 *   roturas     [{nombre, pct}] % de descarte a rotura por cada defecto
 *   acciones    [texto] acciones de calidad (ej. "calibración de Qualitron")
 *   fotos       [dataURL] imágenes (base64 comprimido) de los defectos
 *   enviada     true cuando el operario tocó "Enviar datos" (se refleja en Vista de Planta)
 */
export function crearTomaCalidad(base = {}) {
  const num = v => (v === '' || v === null || v === undefined || isNaN(parseFloat(v))) ? null : parseFloat(v);
  // IMPORTANTE: NO se filtran las filas vacías. crearTomaCalidad() se llama en
  // cada asegurarObjetivosSesion() para normalizar; si acá se descartaran las
  // filas sin datos, una fila recién agregada con el botón "+" (nombre vacío)
  // desaparecería al instante. El filtrado de vacíos se hace solo al mostrar
  // en Vista de Planta / sincronizar defectos, no en la normalización.
  // Cada defecto de calidad lleva además 'accionProd': la acción con que
  // producción responde a ese defecto (se carga desde el panel de producción).
  const defs = arr => Array.isArray(arr)
    ? arr.map(d => ({
        nombre: String(d?.nombre || '').trim(),
        pct: num(d?.pct),
        aclaracion: String(d?.aclaracion || '').trim(),
        accionProd: String(d?.accionProd || '').trim()
      }))
    : [];
  const rots = arr => Array.isArray(arr)
    ? arr.map(d => ({ nombre: String(d?.nombre || '').trim(), pct: num(d?.pct), aclaracion: String(d?.aclaracion || '').trim() }))
    : [];
  const texts = arr => Array.isArray(arr) ? arr.map(x => String(x || '')) : [];
  const imgs = arr => Array.isArray(arr) ? arr.filter(x => typeof x === 'string' && x.startsWith('data:')) : [];
  return {
    hora: base.hora || '',
    // Producto/formato de la toma: si se cargan y difieren de la toma previa,
    // marcan un cambio de producto que se remarca como quiebre en el gráfico.
    producto: String(base.producto || '').trim(),
    formato: String(base.formato || '').trim(),
    global: num(base.global),
    parcial1: num(base.parcial1),
    tono: num(base.tono),
    m2: num(base.m2),
    vacioHorno: num(base.vacioHorno),
    segunda: num(base.segunda),
    rotura: num(base.rotura),
    defectos: defs(base.defectos),
    roturas: rots(base.roturas),
    acciones: texts(base.acciones),
    fotos: imgs(base.fotos),
    enviada: base.enviada === true
  };
}

/**
 * Catálogo de defectos de calidad (abreviatura + nombre) a nivel planta, común
 * a todos los turnos. Se auto-completa: cuando el auditor escribe un código
 * nuevo, se guarda para ofrecerlo luego en un datalist (ver guardarDefectoCalidadSiEsNuevo).
 * Se siembra con las abreviaturas típicas la primera vez.
 */
const DEFECTOS_CALIDAD_INICIALES = [
  { codigo: 'GL', nombre: 'Grieta lateral' },
  { codigo: 'SB', nombre: 'Sopladura' },
  { codigo: 'SE', nombre: 'Separación' },
  { codigo: 'BS', nombre: 'Baja selección' },
  { codigo: 'DTE', nombre: 'Despunte' },
  { codigo: 'B', nombre: 'Bache' },
  { codigo: 'GI', nombre: 'Grieta interna' },
  { codigo: 'T', nombre: 'Tono' }
];

/** Devuelve el catálogo de defectos de calidad (sembrándolo la primera vez). */
export function catalogoDefectosCalidad() {
  if (!Array.isArray(db.defectosCalidad) || !db.defectosCalidad.length) {
    db.defectosCalidad = DEFECTOS_CALIDAD_INICIALES.map(d => ({ ...d }));
  }
  return db.defectosCalidad;
}

/**
 * Guarda un defecto de calidad en el catálogo si el código todavía no existe.
 * @param {string} codigo  abreviatura (GL, DTE, ...)
 * @param {string} nombre  nombre completo opcional
 */
export function guardarDefectoCalidadSiEsNuevo(codigo, nombre = '') {
  const cod = String(codigo || '').trim();
  if (!cod) return;
  const cat = catalogoDefectosCalidad();
  const existe = cat.find(d => d.codigo.toLowerCase() === cod.toLowerCase());
  if (existe) {
    if (nombre && !existe.nombre) existe.nombre = nombre.trim();
  } else {
    cat.push({ codigo: cod, nombre: (nombre || '').trim() });
  }
  persistir();
}

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
        // --- OBJETIVOS DE PRODUCCIÓN (cargables en el mini-form) ---
        vacioMax: 30,     // objetivo: minutos máx. de vacío de horno
        paradasMax: 60,   // objetivo: minutos máx. de paradas de máquina
        // Tomas de m² quemados (POR TURNO): hora + valor. Solo para mostrar
        // (hora a hora); ya no alimentan cálculos de rendimiento/proyección.
        lecturasQuemado: Array(3).fill(null).map(() => ({ hora: '', real: 0 })),
        // --- CALIDAD (planilla del auditor de calidad) ---
        calidad: 90, realCalidad: 0,
        operarioCalidad: '',
        observacionesCalidad: '', // texto libre: observaciones generales del turno
        tomasCalidad: Array(8).fill(null).map(() => crearTomaCalidad()),
        // Respuestas de producción a los defectos (flag de "enviado" para reflejar en Vista de Planta).
        accionesProdEnviadas: false
      };
    } else {
      const o = s.objetivos.porLinea[l.id];
      // Objetivos de producción.
      if (typeof o.vacioMax !== 'number') o.vacioMax = 30;
      if (typeof o.paradasMax !== 'number') o.paradasMax = 60;
      if (typeof o.calidad !== 'number') o.calidad = 90;

      if (!Array.isArray(o.lecturasCalidad)) {
        o.lecturasCalidad = Array(8).fill(null).map(() => ({ hora: '', global: null, parcial: null }));
      }
      // Migración/normalización de la planilla de calidad por tomas.
      if (typeof o.operarioCalidad !== 'string') o.operarioCalidad = o.auditor || '';
      if (typeof o.observacionesCalidad !== 'string') o.observacionesCalidad = '';
      if (typeof o.accionesProdEnviadas !== 'boolean') o.accionesProdEnviadas = false;
      if (!Array.isArray(o.tomasCalidad) || !o.tomasCalidad.length) {
        // Sembrar tomas desde las lecturas viejas (hora/global/parcial) si existían.
        const previas = (o.lecturasCalidad || []).filter(x => x && (x.hora || x.global != null || x.parcial != null));
        o.tomasCalidad = previas.length
          ? previas.map(x => crearTomaCalidad({ hora: x.hora || '', global: x.global, parcial1: x.parcial }))
          : Array(8).fill(null).map(() => crearTomaCalidad());
      } else {
        o.tomasCalidad = o.tomasCalidad.map(t => crearTomaCalidad(t));
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
    }
  });
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