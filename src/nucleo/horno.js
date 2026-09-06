/* ========================================================== */
/* HORNO.JS — Cálculo de producción de quemado por ciclo       */
/* ========================================================== */
/*
  Modelo físico del horno de rodillos / túnel:

    - El horno tiene un largo fijo (LARGO_HORNO_M) y un paso constante
      entre filas de piezas (PASO_FILA_M). Ese paso es una característica
      mecánica del horno, NO depende del formato.

    - Cantidad de filas dentro del horno = LARGO_HORNO_M / PASO_FILA_M.
      Con 142,8 m y paso 0,4727 m ≈ 302,12 filas. A esa cantidad la
      llamamos FACTOR_HORNO.

    - El "ciclo" es el tiempo (en minutos) que tarda una pieza en recorrer
      todo el horno (tiempo de residencia). Cuanto menor el ciclo, más
      rápido avanza la vagoneta y más filas salen por hora.

    - Filas que salen por hora = FACTOR_HORNO / ciclo * 60 ... (ver abajo).
      Simplificando con la superficie de cada fila:

          m²/h = área_fila × (FACTOR_HORNO / ciclo_min)

      donde  área_fila = lado1 × lado2 × piezas_por_fila.

  Verificado contra la tabla real de planta (45×45=6 pzas y 33×45=8 pzas,
  ciclos 23–35 min) con error < 0,4 m²/h.
*/

// Filas equivalentes dentro del horno (142,8 m / paso ≈ 0,4726 m ≈ 302,19).
// Valor ajustado por mínimos cuadrados contra la tabla real de planta:
// reproduce ambos formatos (45×45 y 33×45) con error máximo 0,5 m²/h (< 0,1 %).
export const FACTOR_HORNO = 302.19;

// Rango de ciclos preestablecidos que se ofrecen en los selectores (minutos).
export const CICLO_MIN = 20;
export const CICLO_MAX = 40;

/**
 * Catálogo de formatos por defecto. Cada formato define los lados de la
 * pieza (en cm) y cuántas piezas entran por fila a lo ancho del horno.
 * Se puede ampliar en runtime con agregarFormato().
 */
export const FORMATOS_DEFAULT = [
  { id: '45x45', nombre: '45×45', lado1: 45, lado2: 45, piezasFila: 6 },
  { id: '33x45', nombre: '33×45', lado1: 33, lado2: 45, piezasFila: 8 },
  { id: '33x33', nombre: '33×33', lado1: 33, lado2: 33, piezasFila: 8 }
];

// Copia de trabajo (mutable) del catálogo de formatos, que la app puede ampliar.
let catalogoFormatos = FORMATOS_DEFAULT.map(f => ({ ...f }));

/** Devuelve el catálogo de formatos disponible actualmente. */
export function listarFormatos() {
  return catalogoFormatos.map(f => ({ ...f }));
}

/** Busca un formato por su id. Devuelve undefined si no existe. */
export function obtenerFormato(id) {
  return catalogoFormatos.find(f => f.id === id);
}

/**
 * Agrega (o actualiza) un formato al catálogo. Deja el sistema abierto a
 * nuevos formatos sin tocar código: basta pasar lados y piezas por fila.
 * @returns {object} el formato normalizado que quedó registrado.
 */
export function agregarFormato({ id, nombre, lado1, lado2, piezasFila }) {
  const l1 = Number(lado1), l2 = Number(lado2), pf = Number(piezasFila);
  if (!(l1 > 0) || !(l2 > 0) || !(pf > 0)) {
    throw new Error('Formato inválido: lados y piezas por fila deben ser mayores a 0.');
  }
  const nuevoId = id || `${l1}x${l2}`;
  const registro = {
    id: nuevoId,
    nombre: nombre || `${l1}×${l2}`,
    lado1: l1, lado2: l2, piezasFila: pf
  };
  const idx = catalogoFormatos.findIndex(f => f.id === nuevoId);
  if (idx >= 0) catalogoFormatos[idx] = registro;
  else catalogoFormatos.push(registro);
  return { ...registro };
}

/** Reemplaza todo el catálogo (por ejemplo al cargar formatos guardados en la sesión). */
export function fijarCatalogoFormatos(lista) {
  if (!Array.isArray(lista) || lista.length === 0) {
    catalogoFormatos = FORMATOS_DEFAULT.map(f => ({ ...f }));
    return;
  }
  catalogoFormatos = lista
    .filter(f => f && Number(f.lado1) > 0 && Number(f.lado2) > 0 && Number(f.piezasFila) > 0)
    .map(f => ({
      id: f.id || `${f.lado1}x${f.lado2}`,
      nombre: f.nombre || `${f.lado1}×${f.lado2}`,
      lado1: Number(f.lado1), lado2: Number(f.lado2), piezasFila: Number(f.piezasFila)
    }));
  if (catalogoFormatos.length === 0) catalogoFormatos = FORMATOS_DEFAULT.map(f => ({ ...f }));
}

/**
 * Superficie de una fila de piezas, en m².
 * área_fila = lado1(m) × lado2(m) × piezas_por_fila.
 */
export function areaFila(formato) {
  if (!formato) return 0;
  const l1 = Number(formato.lado1) / 100; // cm → m
  const l2 = Number(formato.lado2) / 100;
  const pf = Number(formato.piezasFila);
  return l1 * l2 * pf;
}

/**
 * Producción teórica en m² por hora para un formato y un ciclo dados.
 *
 *   filas que salen por hora = FACTOR_HORNO × (60 / ciclo_min)
 *   m²/h = área_fila × filas_por_hora = área_fila × FACTOR_HORNO × 60 / ciclo_min
 *
 * @param {object} formato  {lado1, lado2, piezasFila}
 * @param {number} cicloMin  minutos de ciclo del horno
 * @returns {number} m²/h (0 si los datos no son válidos)
 */
export function m2PorHora(formato, cicloMin) {
  const ciclo = Number(cicloMin);
  if (!formato || !(ciclo > 0)) return 0;
  return areaFila(formato) * FACTOR_HORNO * 60 / ciclo;
}

/**
 * m²/h a partir del id de formato (usa el catálogo actual).
 */
export function m2PorHoraPorId(formatoId, cicloMin) {
  return m2PorHora(obtenerFormato(formatoId), cicloMin);
}

/* ==========================================================
   TURNOS Y PROYECCIÓN DE PRODUCCIÓN POR TRAMOS
   ----------------------------------------------------------
   Turno de 8 h (480 min):
     Mañana: 05:00 → 13:00
     Tarde : 13:00 → 21:00
     Noche : 21:00 → 05:00 (cruza medianoche)
   ========================================================== */

export const TURNO_MINUTOS = 480;

// Hora de inicio de cada turno (en horas del día).
const INICIO_TURNO = { 'Mañana': 5, 'Tarde': 13, 'Noche': 21 };

/** Hora de inicio del turno en minutos absolutos desde 00:00. */
export function inicioTurnoMin(turno) {
  return (INICIO_TURNO[turno] ?? 5) * 60;
}

/**
 * Minutos transcurridos desde el inicio del turno hasta una hora 'HH:MM'.
 * Maneja el cruce de medianoche del turno Noche. Devuelve null si la hora
 * está vacía; recorta al rango [0, 480].
 */
export function minutosDesdeInicioTurno(hora, turno) {
  if (!hora) return null;
  const [h, m] = hora.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  let total = h * 60 + m;
  const inicio = inicioTurnoMin(turno);
  // Noche cruza medianoche: una hora como 02:00 pertenece al día siguiente.
  if (turno === 'Noche' && total < inicio) total += 24 * 60;
  return Math.max(0, Math.min(TURNO_MINUTOS, total - inicio));
}

/**
 * Proyecta la producción de m² de un turno completo (8 h) a partir de una
 * lista de tramos. Cada tramo aporta su ritmo (m²/h del formato+ciclo)
 * durante los minutos que dura, hasta que empieza el siguiente tramo o
 * termina el turno.
 *
 * @param {Array} tramos  cada uno: { hora:'HH:MM', formatoId, ciclo, producto }
 * @param {string} turno  'Mañana' | 'Tarde' | 'Noche'
 * @returns {object} {
 *   totalProyectado,          // m² proyectados a fin de turno
 *   tramos: [ {desde, hasta, minutos, m2h, m2Tramo, formatoId, ciclo, producto} ],
 *   quiebres: [ {hora, minutoTurno, productoPrevio, productoNuevo} ]
 * }
 */
export function proyectarProduccionTurno(tramos, turno) {
  const vacio = { totalProyectado: 0, tramos: [], quiebres: [] };
  if (!Array.isArray(tramos) || tramos.length === 0) return vacio;

  // Normalizar: quedarnos con tramos que tengan hora y formato+ciclo válidos,
  // convertir la hora a minutos de turno y ordenar cronológicamente.
  const normalizados = tramos
    .map(t => ({
      ...t,
      minutoInicio: minutosDesdeInicioTurno(t.hora, turno)
    }))
    .filter(t => t.minutoInicio !== null && t.formatoId && Number(t.ciclo) > 0)
    .sort((a, b) => a.minutoInicio - b.minutoInicio);

  if (normalizados.length === 0) return vacio;

  const resultado = { totalProyectado: 0, tramos: [], quiebres: [] };

  for (let i = 0; i < normalizados.length; i++) {
    const actual = normalizados[i];
    const desde = actual.minutoInicio;
    // El tramo dura hasta el inicio del próximo tramo, o hasta fin de turno.
    const hasta = (i + 1 < normalizados.length)
      ? normalizados[i + 1].minutoInicio
      : TURNO_MINUTOS;
    const minutos = Math.max(0, hasta - desde);
    const m2h = m2PorHoraPorId(actual.formatoId, actual.ciclo);
    const m2Tramo = m2h * (minutos / 60);

    resultado.tramos.push({
      desde, hasta, minutos,
      m2h,
      m2Tramo,
      formatoId: actual.formatoId,
      ciclo: Number(actual.ciclo),
      producto: actual.producto || '',
      hora: actual.hora
    });
    resultado.totalProyectado += m2Tramo;

    // Detectar quiebre respecto del tramo anterior y clasificar su tipo:
    //  - 'producto' : cambió el producto (y/o el formato) → posible impacto
    //                 en calidad por defectos propios del producto nuevo.
    //  - 'ciclo'    : mismo producto pero cambió la velocidad del horno.
    if (i > 0) {
      const previo = normalizados[i - 1];
      const cambioProducto = (actual.producto || '') !== (previo.producto || '');
      const cambioFormato = actual.formatoId !== previo.formatoId;
      const cambioCiclo = Number(actual.ciclo) !== Number(previo.ciclo);
      if (cambioProducto || cambioFormato || cambioCiclo) {
        resultado.quiebres.push({
          tipo: (cambioProducto || cambioFormato) ? 'producto' : 'ciclo',
          hora: actual.hora,
          minutoTurno: desde,
          productoPrevio: previo.producto || '',
          productoNuevo: actual.producto || '',
          formatoPrevio: previo.formatoId,
          formatoNuevo: actual.formatoId,
          cicloPrevio: Number(previo.ciclo),
          cicloNuevo: Number(actual.ciclo)
        });
      }
    }
  }

  return resultado;
}

/**
 * Objetivo (m² teóricos) que el horno debería haber quemado ACUMULADO desde
 * el inicio del turno hasta un minuto de turno dado, según los tramos de
 * producción (producto/formato/ciclo vigente en cada momento).
 *
 * Es el objetivo dinámico: si a mitad de turno cambia el ciclo, los minutos
 * posteriores se cuentan con la nueva velocidad.
 *
 * @param {Array} tramos       lista de eventos {hora, formatoId, ciclo, ...}
 * @param {string} turno       'Mañana' | 'Tarde' | 'Noche'
 * @param {number} minutoHasta minuto de turno (0..480) hasta el cual acumular
 * @returns {number} m² teóricos acumulados hasta ese minuto
 */
export function objetivoAcumuladoHasta(tramos, turno, minutoHasta) {
  const proy = proyectarProduccionTurno(tramos, turno);
  if (!proy.tramos.length) return 0;
  const limite = Math.max(0, Math.min(TURNO_MINUTOS, Number(minutoHasta) || 0));

  let acumulado = 0;
  for (const t of proy.tramos) {
    if (t.desde >= limite) break;               // tramo posterior al límite
    const finEfectivo = Math.min(t.hasta, limite);
    const minutosContados = Math.max(0, finEfectivo - t.desde);
    acumulado += t.m2h * (minutosContados / 60);
  }
  return acumulado;
}

/**
 * Rendimiento (%) de una toma: compara los m² reales acumulados hasta la hora
 * de la toma contra el objetivo teórico acumulado hasta esa misma hora.
 *
 * @param {number} m2RealesAcumulados  m² reales medidos hasta esa hora
 * @param {Array}  tramos              eventos de producción del turno
 * @param {string} turno               turno actual
 * @param {string} horaToma            'HH:MM' de la toma
 * @returns {number|null} porcentaje de rendimiento, o null si no hay objetivo
 */
export function rendimientoEnToma(m2RealesAcumulados, tramos, turno, horaToma) {
  const minuto = minutosDesdeInicioTurno(horaToma, turno);
  if (minuto === null || minuto <= 0) return null;
  const objetivo = objetivoAcumuladoHasta(tramos, turno, minuto);
  if (!(objetivo > 0)) return null;
  return (Number(m2RealesAcumulados) / objetivo) * 100;
}
