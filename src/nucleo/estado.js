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
    operarioCalidad: '',
    operarioProduccion: '',
    productoCalidad: '',
    formatoCalidad: '',
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

/**
 * Busca el último producto y formato registrado en la sesión más reciente.
 * Garantiza la continuidad de la línea de proceso continuo al cambiar de turno.
 */
export function ultimoProductoFormato() {
  const keys = Object.keys(db.sesiones || {}).sort((a, b) => b.localeCompare(a));
  for (const k of keys) {
    const s = db.sesiones[k];
    if (s && ((s.productoCalidad && s.productoCalidad.trim()) || (s.formatoCalidad && s.formatoCalidad.trim()))) {
      return {
        producto: (s.productoCalidad || '').trim(),
        formato: (s.formatoCalidad || '').trim()
      };
    }
  }
  return { producto: '', formato: '' };
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
  if (typeof db.sesiones[key].operarioCalidad !== 'string') db.sesiones[key].operarioCalidad = '';
  if (typeof db.sesiones[key].operarioProduccion !== 'string') db.sesiones[key].operarioProduccion = '';
  if (typeof db.sesiones[key].productoCalidad !== 'string') db.sesiones[key].productoCalidad = '';
  if (typeof db.sesiones[key].formatoCalidad !== 'string') db.sesiones[key].formatoCalidad = '';

  // Continuidad de proceso continuo: si la sesión no tiene producto/formato cargado,
  // hereda automáticamente el último producto y formato del turno anterior
  if (!db.sesiones[key].productoCalidad.trim() && !db.sesiones[key].formatoCalidad.trim()) {
    const ult = ultimoProductoFormato();
    if (ult.producto) db.sesiones[key].productoCalidad = ult.producto;
    if (ult.formato) db.sesiones[key].formatoCalidad = ult.formato;
  }

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
 * Catálogo completo de defectos de calidad (abreviatura + nombre), ordenado
 * alfabéticamente por código. Se siembra la primera vez y migra si el
 * catálogo guardado tiene menos entradas que este listado oficial.
 */
const DEFECTOS_CALIDAD_INICIALES = [
  { codigo: 'B',     nombre: 'Balsa · Corte de campana' },
  { codigo: 'BP',    nombre: 'Baldosa perdida por QNG' },
  { codigo: 'BR',    nombre: 'Placa partida o baldosa rota' },
  { codigo: 'BS',    nombre: 'Borde arrollado / saltado' },
  { codigo: 'CH',    nombre: 'Camino de hormiga' },
  { codigo: 'CN',    nombre: 'Corazón negro' },
  { codigo: 'D',     nombre: 'Desplazado · Defecto de decorado' },
  { codigo: 'DP',    nombre: 'Falta o defecto de protectora' },
  { codigo: 'DT',    nombre: 'Diferencia de tono' },
  { codigo: 'DTE',   nombre: 'Despunte · Vértice saltado' },
  { codigo: 'EA',    nombre: 'Esmalte abierto' },
  { codigo: 'F',     nombre: 'Filtrado' },
  { codigo: 'FD',    nombre: 'Falta de decorado' },
  { codigo: 'FDF',   nombre: 'Falso defecto' },
  { codigo: 'FR',    nombre: 'Franjeado de esmalte · Martillado' },
  { codigo: 'G',     nombre: 'Grumo' },
  { codigo: 'GA',    nombre: 'Gota de aceite' },
  { codigo: 'GE',    nombre: 'Gota de esmalte' },
  { codigo: 'GEN',   nombre: 'Gota de engobe rulo' },
  { codigo: 'GG',    nombre: 'Gota de agua' },
  { codigo: 'GH',    nombre: 'Gota de horno' },
  { codigo: 'GI',    nombre: 'Grieta interna' },
  { codigo: 'GL',    nombre: 'Grieta lateral o en borde' },
  { codigo: 'GNER',  nombre: 'Grieta en nervadura' },
  { codigo: 'GRES',  nombre: 'Grieta de esmalte' },
  { codigo: 'GT',    nombre: 'Gota de tinta' },
  { codigo: 'H',     nombre: 'Pinchado o hervido' },
  { codigo: 'MA',    nombre: 'Mancha · Mancha blanca' },
  { codigo: 'MO',    nombre: 'Montado horno' },
  { codigo: 'MP',    nombre: 'Marcado de prensa' },
  { codigo: 'PC',    nombre: 'Polvo contaminado · Explosión' },
  { codigo: 'PD',    nombre: 'Placa deformada' },
  { codigo: 'PLANAR',nombre: 'Torcido por planar' },
  { codigo: 'PSD',   nombre: 'Placa sin decorar' },
  { codigo: 'PTN',   nombre: 'Punto negro' },
  { codigo: 'RP',    nombre: 'Raya de pasta' },
  { codigo: 'RY',    nombre: 'Raya de Kerajet' },
  { codigo: 'RYC',   nombre: 'Raya de campana' },
  { codigo: 'S',     nombre: 'Solapado' },
  { codigo: 'SB',    nombre: 'Suciedad sobre bizcocho' },
  { codigo: 'SE',    nombre: 'Suciedad sobre esmalte' },
  { codigo: 'T',     nombre: 'Torcido' }
];

/** Devuelve el catálogo de defectos de calidad (depurando duplicados y garantizando catálogo único). */
export function catalogoDefectosCalidad() {
  const mapa = new Map();

  // 1. Catálogo base oficial
  DEFECTOS_CALIDAD_INICIALES.forEach(d => {
    const k = d.codigo.trim().toUpperCase();
    mapa.set(k, { codigo: d.codigo.trim(), nombre: (d.nombre || '').trim() });
  });

  // 2. Si el usuario agregó defectos manuales válidos en db.defectosCalidad, preservarlos
  if (Array.isArray(db.defectosCalidad)) {
    db.defectosCalidad.forEach(d => {
      if (!d || !d.codigo) return;
      let cod = String(d.codigo).trim();
      let nom = String(d.nombre || '').trim();

      // Si el código vino contaminado como "COD - Nombre", extraer solo la sigla
      if (cod.includes(' - ')) {
        const partes = cod.split(' - ');
        cod = partes[0].trim();
        nom = partes.slice(1).join(' - ').trim();
      }

      const k = cod.toUpperCase();
      // Si no existe en el mapa oficial, agregarlo como nuevo defecto
      if (!mapa.has(k) && cod.length > 0 && cod.length <= 12) {
        mapa.set(k, { codigo: cod, nombre: nom || cod });
      }
    });
  }

  // Lista ordenada alfabéticamente por código
  const listaLimpia = Array.from(mapa.values()).sort((a, b) => a.codigo.localeCompare(b.codigo));
  db.defectosCalidad = listaLimpia;
  return db.defectosCalidad;
}

/**
 * Guarda un defecto de calidad en el catálogo si el código todavía no existe.
 * @param {string} codigo  abreviatura (GL, DTE, ...) o texto
 * @param {string} nombre  nombre completo opcional
 */
export function guardarDefectoCalidadSiEsNuevo(codigo, nombre = '') {
  let cod = String(codigo || '').trim();
  let nom = String(nombre || '').trim();
  if (!cod) return;

  // Si vino en formato "COD - Nombre", separar sigla y nombre
  if (cod.includes(' - ')) {
    const partes = cod.split(' - ');
    cod = partes[0].trim();
    if (!nom || nom === codigo) nom = partes.slice(1).join(' - ').trim();
  }

  const cat = catalogoDefectosCalidad();
  const existe = cat.find(d => d.codigo.toUpperCase() === cod.toUpperCase());
  if (existe) {
    if (nom && !existe.nombre) existe.nombre = nom;
  } else {
    cat.push({ codigo: cod, nombre: nom || cod });
    cat.sort((a, b) => a.codigo.localeCompare(b.codigo));
  }
  persistir();
}

/**
 * Intenta sincronizar el catálogo de defectos desde defectos.json (en la raíz)
 * cuando la aplicación corre bajo un servidor web (HTTP/HTTPS).
 */
export async function cargarCatalogoDefectosDesdeJson() {
  try {
    if (typeof window !== 'undefined' && window.location && window.location.protocol.startsWith('http')) {
      const resp = await fetch('./defectos.json');
      if (resp.ok) {
        const datos = await resp.json();
        if (Array.isArray(datos) && datos.length > 0) {
          catalogoDefectosCalidad();
          const codigos = new Set((db.defectosCalidad || []).map(d => d.codigo.toUpperCase()));
          let cambio = false;
          datos.forEach(d => {
            if (d && d.codigo && !codigos.has(d.codigo.toUpperCase())) {
              db.defectosCalidad.push({ codigo: d.codigo.trim(), nombre: (d.nombre || '').trim() });
              codigos.add(d.codigo.toUpperCase());
              cambio = true;
            }
          });
          if (cambio) {
            persistir();
            if (typeof window.refrescarDatalistDefectos === 'function') {
              window.refrescarDatalistDefectos();
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('Carga de defectos.json no disponible:', err);
  }
}

const PREDETERMINADOS_KEY = 'kira_objetivos_predeterminados';

/** Obtiene los objetivos predeterminados de planta para una línea. */
export function obtenerObjetivosPredeterminados(lineaId) {
  try {
    if (db.objetivosPredeterminados && db.objetivosPredeterminados[lineaId]) {
      return db.objetivosPredeterminados[lineaId];
    }
    const guardados = JSON.parse(localStorage.getItem(PREDETERMINADOS_KEY) || '{}');
    if (guardados[lineaId]) {
      if (!db.objetivosPredeterminados) db.objetivosPredeterminados = {};
      db.objetivosPredeterminados[lineaId] = guardados[lineaId];
      return guardados[lineaId];
    }
  } catch (e) {
    console.warn('Error leyendo objetivos predeterminados:', e);
  }
  return null;
}

/** Guarda los objetivos predeterminados fijados por producción para que apliquen a todos los turnos futuros. */
export function guardarObjetivosPredeterminados(lineaId, objs) {
  try {
    if (!db.objetivosPredeterminados) db.objetivosPredeterminados = {};
    const limpio = {
      vacioMax: objs.vacioMax != null && !isNaN(objs.vacioMax) ? Number(objs.vacioMax) : 30,
      paradasMax: objs.paradasMax != null && !isNaN(objs.paradasMax) ? Number(objs.paradasMax) : 60,
      calidad: objs.calidad != null && !isNaN(objs.calidad) ? Number(objs.calidad) : 90,
      defectoMax: objs.defectoMax != null && !isNaN(objs.defectoMax) ? Number(objs.defectoMax) : 1.0
    };
    db.objetivosPredeterminados[lineaId] = limpio;
    let guardados = {};
    try { guardados = JSON.parse(localStorage.getItem(PREDETERMINADOS_KEY) || '{}'); } catch {}
    guardados[lineaId] = limpio;
    localStorage.setItem(PREDETERMINADOS_KEY, JSON.stringify(guardados));
  } catch (e) {
    console.warn('Error guardando objetivos predeterminados:', e);
  }
}

/** Garantiza que la sesión tenga la estructura de objetivos por línea, migrando datos viejos si hace falta. */
export function asegurarObjetivosSesion(s) {
  if (!s.objetivos) s.objetivos = {};
  if (typeof s.operarioCalidad !== 'string') s.operarioCalidad = '';
  if (typeof s.operarioProduccion !== 'string') s.operarioProduccion = '';
  if (typeof s.productoCalidad !== 'string') s.productoCalidad = '';
  if (typeof s.formatoCalidad !== 'string') s.formatoCalidad = '';

  if (!s.objetivos.porLinea) {
    s.objetivos.porLinea = {};
    if (s.objetivos.l1) s.objetivos.porLinea['L1'] = { ...s.objetivos.l1 };
    if (s.objetivos.l2) s.objetivos.porLinea['L2'] = { ...s.objetivos.l2 };
  }

  lineasActivas().forEach(l => {
    const defaults = obtenerObjetivosPredeterminados(l.id);
    const defVacio = defaults?.vacioMax ?? 30;
    const defParadas = defaults?.paradasMax ?? 60;
    const defCalidad = defaults?.calidad ?? 90;
    const defDefecto = defaults?.defectoMax ?? 1.0;

    if (!s.objetivos.porLinea[l.id]) {
      s.objetivos.porLinea[l.id] = {
        // --- OBJETIVOS DE PRODUCCIÓN (cargables en el mini-form) ---
        vacioMax: defVacio,       // objetivo: minutos máx. de vacío de horno
        paradasMax: defParadas,   // objetivo: minutos máx. de paradas de máquina
        calidad: defCalidad,      // objetivo: % mínimo de calidad global
        defectoMax: defDefecto,   // objetivo: % máximo de defecto individual
        realCalidad: 0,
        // Tomas de m² quemados (POR TURNO): hora + valor. Solo para mostrar
        // (hora a hora); ya no alimentan cálculos de rendimiento/proyección.
        lecturasQuemado: Array(3).fill(null).map(() => ({ hora: '', real: 0 })),
        // --- CALIDAD (planilla del auditor de calidad) ---
        operarioCalidad: s.operarioCalidad || '',
        observacionesCalidad: '', // texto libre: observaciones generales del turno
        tomasCalidad: Array(8).fill(null).map(() => crearTomaCalidad()),
        // Respuestas de producción a los defectos (flag de "enviado" para reflejar en Vista de Planta).
        accionesProdEnviadas: false
      };
    } else {
      const o = s.objetivos.porLinea[l.id];
      // Objetivos de producción.
      if (typeof o.vacioMax !== 'number') o.vacioMax = defVacio;
      if (typeof o.paradasMax !== 'number') o.paradasMax = defParadas;
      if (typeof o.calidad !== 'number') o.calidad = defCalidad;
      if (typeof o.defectoMax !== 'number') o.defectoMax = defDefecto;

      if (!Array.isArray(o.lecturasCalidad)) {
        o.lecturasCalidad = Array(8).fill(null).map(() => ({ hora: '', global: null, parcial: null }));
      }
      // Migración/normalización de la planilla de calidad por tomas.
      if (typeof o.operarioCalidad !== 'string') o.operarioCalidad = s.operarioCalidad || o.auditor || '';
      if (!s.operarioCalidad && o.operarioCalidad) s.operarioCalidad = o.operarioCalidad;
      if (s.operarioCalidad && !o.operarioCalidad) o.operarioCalidad = s.operarioCalidad;
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