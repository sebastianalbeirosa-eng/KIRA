/* ========================================================== */
/* ASISTENTE-CHAT.JS — Interfaz del panel de chat/análisis     */
/* ========================================================== */
/*
  Conecta el ícono flotante y el panel de chat con las funciones
  de datos de asistenteTurno.js. No hay ninguna IA acá: es
  reconocimiento simple de palabras clave + nombres de equipo
  sobre lo que el usuario escribe.
*/

import {
  detectarTendencias, detectarAlertas, generarResumenTurno,
  resumenRapidoTurno, formatearResumenRapido,
  analizarEquipo, formatearAnalisisEquipo, detectarEquipoEnTexto,
  equipoConMasParada, equipoConMasVacio,
  equipoConMasParadaDia, equipoConMasVacioDia,
  equipoConMasParadaPeriodo, equipoConMasVacioPeriodo,
  equipoConMenosParada, equipoConMenosVacio,
  equipoConMenosParadaDia, equipoConMenosVacioDia,
  equipoConMenosParadaPeriodo, equipoConMenosVacioPeriodo,
  defectoPrincipalTurno, defectoPrincipalDia, defectoPrincipalPeriodo,
  defectoMenorTurno, evolucionCalidadTurno
} from './asistenteTurno.js';
import { calcularKpisPlanta } from './vistaDePlanta.js';
import { consultarIA, resumenContextoIA } from './iaAsistente.js';

// Se vuelve true la primera vez que se abre el panel, para dibujar
// las preguntas prearmadas una sola vez (no hace falta repetirlo).
let preguntasYaRenderizadas = false;

// Última intención respondida (defecto/parada/vacio). Permite entender
// frases de seguimiento cortas como "y el que menos?" reutilizando el tema
// de la consulta anterior.
let ultimaIntencionRanking = null;

// Mensaje de bienvenida — se reutiliza al abrir el panel por primera
// vez y al limpiar la conversación con el botón 🗑️.
const MENSAJE_BIENVENIDA = 'Hola, soy el asistente de análisis de KIRA. Respondo con los datos que ya cargaste. Elegí una consulta o escribí el nombre de un equipo. Si cargás una API key en ⚙️ Ajustes, también puedo responder preguntas más abiertas con IA.';

/** Devuelve la línea actualmente filtrada en el header, o 'TODAS' si no hay selector visible. */
function lineaActual() {
  const el = document.getElementById('lineaVista');
  return el?.value || 'TODAS';
}

/**
 * Normaliza texto para el reconocimiento de palabras clave: minúsculas
 * y sin tildes ("máquina" y "maquina" deben reconocerse igual).
 */
function normalizarTexto(texto) {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // quita los acentos (tildes, diéresis)
}

/**
 * Detecta el período consultado dentro de un texto ya normalizado.
 * 'turno' es el valor por defecto si no se menciona ningún período,
 * ya que es el alcance más natural para una consulta rápida.
 */
function detectarPeriodo(textoLower) {
  if (/\bsemana(l)?\b|ultimos? 7|siete dias|esta semana/.test(textoLower)) return 'semana';
  if (/\bmes(ual)?\b|ultimos? 30|treinta dias|este mes/.test(textoLower)) return 'mes';
  if (/\bdia(rio)?\b|\bhoy\b|jornada|24\s?h|24 horas/.test(textoLower)) return 'dia';
  if (/\bturno\b|ahora|actual/.test(textoLower)) return 'turno';
  return 'turno';
}

/** Etiqueta legible del período (para textos de respuesta). */
function etiquetaPeriodo(periodo) {
  return { turno: 'este turno', dia: 'el día de hoy', semana: 'la última semana', mes: 'el último mes' }[periodo] || 'este turno';
}

/**
 * Cuenta cuántas palabras clave (o expresiones) de una lista aparecen en el
 * texto. Se usa para puntuar cada intención posible: gana la de mayor puntaje.
 * Es tolerante a variaciones porque no exige una frase exacta, sino la
 * presencia de términos relacionados.
 */
function puntuar(textoLower, terminos) {
  let puntos = 0;
  for (const t of terminos) {
    if (t instanceof RegExp) { if (t.test(textoLower)) puntos++; }
    else if (textoLower.includes(t)) puntos++;
  }
  return puntos;
}

/** Agrega una burbuja de mensaje al historial del chat y hace scroll hasta el final. */
function agregarMensaje(texto, tipo) {
  const contenedor = document.getElementById('asistenteMensajes');
  if (!contenedor) return;
  const burbuja = document.createElement('div');
  burbuja.className = `asistente-msg ${tipo === 'usuario' ? 'asistente-msg-usuario' : 'asistente-msg-bot'}`;
  burbuja.textContent = texto;
  contenedor.appendChild(burbuja);
  contenedor.scrollTop = contenedor.scrollHeight;
}

/** Abre/cierra el panel del asistente. Dibuja las preguntas prearmadas la primera vez. */
export function alternarAsistente() {
  const panel = document.getElementById('panelAsistente');
  if (!panel) return;
  const seVaAAbrir = panel.classList.contains('hidden');
  panel.classList.toggle('hidden');
  if (seVaAAbrir && !preguntasYaRenderizadas) {
    renderPreguntasAsistente();
    preguntasYaRenderizadas = true;
  }
}

/** Borra el historial de mensajes del chat y vuelve a mostrar el saludo inicial. */
export function limpiarChatAsistente() {
  const contenedor = document.getElementById('asistenteMensajes');
  if (!contenedor) return;
  contenedor.innerHTML = '';
  agregarMensaje(MENSAJE_BIENVENIDA, 'bot');
}

/** Dibuja los botones de preguntas prearmadas dentro del panel. */
function renderPreguntasAsistente() {
  const contenedor = document.getElementById('asistentePreguntas');
  if (!contenedor) return;
  const preguntas = [
    { texto: '📋 Resumen rápido', accion: manejarResumenRapido },
    { texto: '📝 Resumen del turno', accion: manejarResumenTurno },
    { texto: '📈 Tendencias del mes', accion: manejarTendencias },
    { texto: '⚠️ Alertas', accion: manejarAlertas },
    { texto: '🧭 Cómo investigar (guía)', accion: () => { agregarMensaje('Cómo investigar un problema', 'usuario'); responderGuiaRCA(); } },
    { texto: '❓ ¿Qué puedo preguntar?', accion: () => { agregarMensaje('¿Qué puedo preguntar?', 'usuario'); responderAyuda(true); } }
  ];
  contenedor.innerHTML = '';
  preguntas.forEach(p => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pregunta-chip';
    btn.textContent = p.texto;
    btn.onclick = p.accion;
    contenedor.appendChild(btn);
  });
}

/** Responde con el resumen rápido (defecto crítico, máquina crítica, vacío, quemado). */
function manejarResumenRapido() {
  agregarMensaje('Resumen rápido', 'usuario');
  const resumen = resumenRapidoTurno(lineaActual());
  agregarMensaje(formatearResumenRapido(resumen), 'bot');
}

/** Responde con el resumen narrativo del turno. */
function manejarResumenTurno() {
  agregarMensaje('Resumen del turno', 'usuario');
  agregarMensaje(generarResumenTurno(lineaActual()), 'bot');
}

/** Responde con las tendencias detectadas en los últimos 30 días. */
function manejarTendencias() {
  agregarMensaje('Tendencias del mes', 'usuario');
  const tendencias = detectarTendencias(lineaActual());
  if (!tendencias.length) {
    agregarMensaje('No detecté tendencias relevantes en los últimos 30 días con los datos actuales.', 'bot');
    return;
  }
  agregarMensaje(tendencias.map(t => `${t.severidad === 'atencion' ? '⚠️' : 'ℹ️'} ${t.mensaje}`).join('\n\n'), 'bot');
}

/** Responde con las alertas de anomalías del turno actual. */
function manejarAlertas() {
  agregarMensaje('Alertas', 'usuario');
  const alertas = detectarAlertas(lineaActual());
  if (!alertas.length) {
    agregarMensaje('No hay alertas: los valores del turno actual están dentro de lo normal según el historial.', 'bot');
    return;
  }
  agregarMensaje(alertas.map(a => `${a.severidad === 'critico' ? '🔴' : '⚠️'} ${a.mensaje}`).join('\n\n'), 'bot');
}

/**
 * Responde a "¿qué equipo paró/tuvo vacío más (o menos)" según el período
 * detectado (turno/día/semana/mes) y el orden ('max' = el que más, 'min' = el
 * que menos, entre los que tuvieron registros).
 */
function responderRankingEquipo(periodo, tipoDato, orden = 'max') {
  const esParada = tipoDato === 'parada';
  const esMin = orden === 'min';
  const linea = lineaActual();
  const palabraMasMenos = esMin ? 'menos' : 'más';

  // Selección de la función de datos según tipo + orden + período.
  let top;
  if (periodo === 'turno') {
    if (esParada) top = esMin ? equipoConMenosParada(linea) : equipoConMasParada(linea);
    else top = esMin ? equipoConMenosVacio(linea) : equipoConMasVacio(linea);
    const valorTop = esParada ? top?.mins : top?.vacio;
    agregarMensaje(
      top
        ? `El equipo con ${palabraMasMenos} ${esParada ? 'minutos de parada' : 'vacío de horno'} este turno es ${top.equipo} (${valorTop} min, línea ${top.lineaNombre}).${esMin ? ' (Entre los equipos que tuvieron registros; los que no pararon no se listan.)' : ''}`
        : `No hay ${esParada ? 'paradas' : 'registros de vacío'} en este turno todavía.`,
      'bot'
    );
    return;
  }

  const dias = periodo === 'semana' ? 7 : 30;
  const etiqueta = { dia: 'el día de hoy', semana: 'la última semana', mes: 'el último mes' }[periodo];

  if (periodo === 'dia') {
    if (esParada) top = esMin ? equipoConMenosParadaDia(linea) : equipoConMasParadaDia(linea);
    else top = esMin ? equipoConMenosVacioDia(linea) : equipoConMasVacioDia(linea);
  } else {
    if (esParada) top = esMin ? equipoConMenosParadaPeriodo(dias, linea) : equipoConMasParadaPeriodo(dias, linea);
    else top = esMin ? equipoConMenosVacioPeriodo(dias, linea) : equipoConMasVacioPeriodo(dias, linea);
  }

  const valorTop = esParada ? top?.minutos : top?.vacio;
  agregarMensaje(
    top
      ? `El equipo con ${palabraMasMenos} ${esParada ? 'paradas' : 'vacío de horno'} en ${etiqueta} es ${top.equipo} (${valorTop} min${esParada ? ` en ${top.eventos} evento${top.eventos === 1 ? '' : 's'}` : ' acumulados'}, línea ${top.lineaNombre}).${esMin ? ' (Entre los que tuvieron registros.)' : ''}`
      : `No hay ${esParada ? 'paradas' : 'registros de vacío'} en ${etiqueta}.`,
    'bot'
  );
}

/**
 * Responde sobre el defecto según el período y el orden: 'max' = el que más
 * impacta/preponderante (default), 'min' = el que menos impacta.
 */
function responderDefectoPrincipal(periodo, orden = 'max') {
  const linea = lineaActual();
  const esMin = orden === 'min';

  if (periodo === 'turno') {
    const d = esMin ? defectoMenorTurno(linea) : defectoPrincipalTurno(linea);
    agregarMensaje(
      d
        ? `El defecto que ${esMin ? 'menos impacta' : 'más impacta'} este turno es "${d.nombre}" (${d.porcentaje}%).${d.accion ? ` Acción: ${d.accion}` : ' Sin acción registrada.'}`
        : 'No hay defectos registrados en este turno.',
      'bot'
    );
    return;
  }

  const config = {
    dia: { fn: () => defectoPrincipalDia(linea, orden), etiqueta: 'del día de hoy' },
    semana: { fn: () => defectoPrincipalPeriodo(7, linea, orden), etiqueta: 'de la última semana' },
    mes: { fn: () => defectoPrincipalPeriodo(30, linea, orden), etiqueta: 'del último mes' }
  };
  const { fn, etiqueta } = config[periodo];
  const d = fn();

  agregarMensaje(
    d
      ? `El defecto que ${esMin ? 'menos impacta' : 'más impacta'} ${etiqueta} es "${d.nombre}", con un promedio de ${d.porcentajePromedio.toFixed(1)}% en ${d.cantidad} registro${d.cantidad === 1 ? '' : 's'}.${d.accionMasReciente ? ` Última acción registrada: ${d.accionMasReciente}` : ''}`
      : `No hay defectos registrados ${etiqueta}.`,
    'bot'
  );
}

/** Responde con el rendimiento del turno (m² reales vs objetivo teórico). */
function responderRendimiento() {
  const k = calcularKpisPlanta(lineaActual());
  if (k.rendimientoPct === null) {
    agregarMensaje('Todavía no puedo calcular el rendimiento: cargá las tomas de m² quemados en Indicadores y Objetivos.', 'bot');
    return;
  }
  const dif = k.m2Desvio;
  const estado = dif >= 0 ? `con ${dif} m² por encima del objetivo` : `con ${Math.abs(dif)} m² por debajo del objetivo`;
  agregarMensaje(
    `El rendimiento de este turno es ${k.rendimientoPct.toFixed(1)}%: se quemaron ${k.m2Real} m² reales sobre ${k.m2Objetivo} m² teóricos, ${estado}.`,
    'bot'
  );
}

/** Responde con la disponibilidad del turno (equipos y minutos de parada). */
function responderDisponibilidad() {
  const k = calcularKpisPlanta(lineaActual());
  agregarMensaje(
    `La disponibilidad de este turno es ${k.m.disponibilidad.toFixed(1)}% (${k.m.parada} min de parada sobre el turno). Equipos con problemas: ${k.equiposConProblema}.`,
    'bot'
  );
}

/** Responde con la eficiencia global (EGE) del turno. */
function responderEge() {
  const k = calcularKpisPlanta(lineaActual());
  agregarMensaje(
    `La eficiencia global (EGE) de este turno es ${k.egeTurno.toFixed(1)}%. Se calcula como Disponibilidad (${k.m.disponibilidad.toFixed(1)}%) × Rendimiento (${k.rendimientoPct === null ? 'N/D' : k.rendimientoPct.toFixed(1) + '%'}) × Calidad (${k.calidadReal.toFixed(1)}%).`,
    'bot'
  );
}

/** Responde con la calidad del turno (global y parcial). */
function responderCalidad() {
  const k = calcularKpisPlanta(lineaActual());
  agregarMensaje(
    `La calidad de este turno es ${k.calidadReal.toFixed(1)}% (global) y ${k.calidadParcial.toFixed(1)}% (parcial), con un objetivo de ${k.calidadObjetivo.toFixed(1)}%.`,
    'bot'
  );
}

/**
 * Responde sobre la EVOLUCIÓN de la calidad hora a hora: en qué horario empezó
 * a subir o a bajar, y dónde estuvo el mínimo/máximo del turno.
 */
function responderEvolucionCalidad(t) {
  const tipo = /parcial/.test(t) ? 'parcial' : 'global';
  const ev = evolucionCalidadTurno(tipo, lineaActual());
  if (!ev) {
    agregarMensaje('Todavía no tengo suficientes lecturas de calidad hora a hora en este turno para analizar su evolución. Cargalas en Indicadores y Objetivos.', 'bot');
    return;
  }

  const pideBaja = /baj|cae|cayo|empeora|empeoro|descend/.test(t);
  const partes = [];

  if (pideBaja) {
    partes.push(ev.primerBaja
      ? `La calidad ${tipo} empezó a bajar a las ${ev.primerBaja.hora} (${ev.primerBaja.valor}%).`
      : `La calidad ${tipo} no registró una baja en este turno.`);
  } else {
    partes.push(ev.primerAlza
      ? `La calidad ${tipo} empezó a subir a las ${ev.primerAlza.hora} (${ev.primerAlza.valor}%).`
      : `La calidad ${tipo} no registró una suba sostenida en este turno.`);
  }

  partes.push(`Mínimo del turno: ${ev.min.valor}% a las ${ev.min.hora}. Máximo: ${ev.max.valor}% a las ${ev.max.hora}.`);
  agregarMensaje(partes.join(' '), 'bot');
}

/** Responde con los minutos de vacío de horno del turno. */
function responderVacioTurno() {
  const k = calcularKpisPlanta(lineaActual());
  agregarMensaje(`Este turno acumula ${k.m.vacio} min de vacío de horno.`, 'bot');
}

/**
 * Guía al usuario para hacer un análisis de causa raíz A MANO (KIRA 3.0 no lo
 * hace automático todavía). Toma el problema principal detectado en los datos
 * y muestra los pasos de los 5 Porqués y las categorías de Ishikawa.
 */
function responderGuiaRCA() {
  const linea = lineaActual();
  const k = calcularKpisPlanta(linea);
  const maq = k.maquinaCritica;
  const def = k.defectoPreponderante;

  const partes = ['🧭 GUÍA DE ANÁLISIS DE CAUSA RAÍZ (paso a paso)'];
  partes.push('');

  if (maq) {
    partes.push(`Problema sugerido (paradas): ${maq.equipo} — ${maq.mins} min, motivo principal "${maq.motivo || 's/d'}".`);
  }
  if (def) {
    partes.push(`Problema sugerido (calidad): "${def.nombre}" con ${def.porcentaje}%.`);
  }
  if (!maq && !def) {
    partes.push('Todavía no hay un problema destacado en los datos de este turno. Cargá paradas o defectos y volvé a preguntar.');
  }

  partes.push('');
  partes.push('1) 5 PORQUÉS — preguntate "¿por qué?" hasta 5 veces:');
  partes.push('   • ¿Por qué ocurrió el problema?');
  partes.push('   • ¿Por qué pasó esa causa? (y así sucesivamente)');
  partes.push('   • Frená cuando llegues a una causa que, si la corregís, evita que vuelva a pasar.');
  partes.push('');
  partes.push('2) ISHIKAWA — revisá las 6 categorías (6M):');
  partes.push('   • Máquina · Material · Método · Mano de obra · Medición · Medio ambiente');
  partes.push('   Anotá para cada una qué pudo haber influido.');
  partes.push('');
  partes.push('3) Confirmá la causa raíz con el equipo y cargá una acción correctiva con responsable y fecha.');
  partes.push('');
  partes.push('💡 El análisis automático (RCA guiado) llegará en una próxima versión de KIRA.');

  agregarMensaje(partes.join('\n'), 'bot');
}

/**
 * Consulta a la IA (solo cuando las reglas no supieron responder y hay key).
 * Muestra una burbuja "Pensando..." que luego se reemplaza por la respuesta
 * o por un mensaje de error claro. Si algo falla, además ofrece la ayuda.
 */
async function preguntarIA(pregunta) {
  const proveedor = obtenerProveedorIA();
  const apiKey = obtenerApiKey();

  // Burbuja temporal de "pensando".
  const contenedor = document.getElementById('asistenteMensajes');
  const burbuja = document.createElement('div');
  burbuja.className = 'asistente-msg asistente-msg-bot';
  burbuja.textContent = '🤖 Pensando…';
  contenedor?.appendChild(burbuja);
  if (contenedor) contenedor.scrollTop = contenedor.scrollHeight;

  try {
    const contexto = resumenContextoIA(lineaActual());
    const respuesta = await consultarIA(proveedor, apiKey, pregunta, contexto);
    burbuja.textContent = respuesta;
  } catch (e) {
    burbuja.textContent = `No pude consultar la IA. ${e.message || ''}`.trim();
    // Además, dejamos a mano lo que sí sabe responder KIRA.
    responderAyuda(true);
  }
  if (contenedor) contenedor.scrollTop = contenedor.scrollHeight;
}

/** Muestra la lista de cosas que el asistente sabe responder (ayuda / fallback). */
function responderAyuda(conIntro = true) {
  const partes = [];
  if (conIntro) partes.push('Puedo ayudarte con estas consultas (escribilas como quieras):');
  partes.push('• Defecto preponderante / peor defecto (del turno, día, semana o mes)');
  partes.push('• Máquina o equipo con más paradas o más vacío (por período)');
  partes.push('• Rendimiento / producción (m² reales vs objetivo)');
  partes.push('• Disponibilidad · Calidad · Eficiencia (EGE)');
  partes.push('• Minutos de vacío de horno');
  partes.push('• Resumen del turno · Resumen rápido');
  partes.push('• Tendencias · Alertas');
  partes.push('• Análisis de un equipo (escribí su nombre, ej: "Prensa 1")');
  partes.push('• Cómo investigar un problema (guía de causa raíz)');
  agregarMensaje(partes.join('\n'), 'bot');
}

/**
 * Motor de intención por SCORING: en vez de una cadena rígida de if/else con
 * regex exactos, cada intención suma puntos según cuántos de sus términos
 * relacionados aparecen en la consulta. Gana la intención con más puntos.
 * Es tolerante a variaciones ("peor defecto", "qué defecto me afecta",
 * "defecto preponderante de la semana" → todas la misma intención).
 */
export function enviarConsultaAsistente(event) {
  event.preventDefault();
  const input = document.getElementById('asistenteInput');
  const texto = input.value.trim();
  if (!texto) return false;

  agregarMensaje(texto, 'usuario');
  input.value = '';

  const t = normalizarTexto(texto);
  const periodo = detectarPeriodo(t);
  const equipoDetectado = detectarEquipoEnTexto(texto);

  // ¿La consulta es "cuál equipo/máquina" (ranking) o el nombre de un equipo
  // puntual? Un ranking menciona "mas/menos/mayor/menor/peor" junto a máquina.
  const esRanking = /\bmas\b|\bmenos\b|mayor|menor|peor|mejor|minimo|maximo|top|ranking|cual|que maquina|que equipo/.test(t);

  // Orden del ranking: 'min' si pide el que MENOS, 'max' por defecto.
  const orden = /\bmenos\b|menor|minimo|mas baj|menor tiempo|menos tiempo/.test(t) ? 'min' : 'max';

  // Frase de seguimiento corta ("el que menos", "y el mas", "al reves") que no
  // menciona un tema: reutiliza la última intención de ranking respondida.
  const esSeguimientoCorto = /^(y )?(el |la )?(que )?(mas|menos|mayor|menor|al reves|inverso)\b/.test(t) && t.length <= 30;
  if (esSeguimientoCorto && ultimaIntencionRanking) {
    if (ultimaIntencionRanking === 'defecto') responderDefectoPrincipal(periodo, orden);
    else responderRankingEquipo(periodo, ultimaIntencionRanking, orden);
    return false;
  }

  // Pregunta por EVOLUCIÓN/HORARIO de la calidad: "en qué horario subió/bajó la
  // calidad", "cuándo empezó a mejorar", etc. O un seguimiento corto sobre el
  // horario después de haber hablado de calidad.
  const preguntaHorario = /horario|hora|cuando|en que momento|a que hora/.test(t);
  const mencionaEvolucion = /subi|subio|sube|bajo|baja|mejora|mejoro|empeora|evolucion|empezo/.test(t);
  const seguimientoHorarioCalidad = preguntaHorario && t.length <= 30 && ultimaIntencionRanking === 'calidad';
  if ((/calidad/.test(t) && (preguntaHorario || mencionaEvolucion)) ||
      (mencionaEvolucion && preguntaHorario) ||
      seguimientoHorarioCalidad) {
    responderEvolucionCalidad(t);
    ultimaIntencionRanking = 'calidad';
    return false;
  }

  // Puntaje por intención.
  const intenciones = {
    defecto: puntuar(t, ['defecto', 'defectos', 'calidad mala', 'falla de calidad', 'preponderante', /\bpeor\b/]),
    parada: puntuar(t, ['parada', 'paro', 'paro', 'detencion', 'detuvo', 'para mas', 'minutos perdidos', 'tiempo perdido']),
    vacio: puntuar(t, ['vacio', 'vacío', 'horno vacio']),
    rendimiento: puntuar(t, ['rendimiento', 'produccion', 'produjo', 'metros', 'm2', 'quemado', 'quemo', 'objetivo de produccion']),
    disponibilidad: puntuar(t, ['disponibilidad', 'disponible', 'uptime']),
    ege: puntuar(t, ['ege', 'eficiencia global', 'oee', 'eficiencia']),
    calidad: puntuar(t, ['calidad', 'qualitron', 'porcentaje de calidad']),
    resumen: puntuar(t, ['resumen', 'resumir', 'panorama', 'como venimos', 'como vamos', 'como va el turno']),
    tendencia: puntuar(t, ['tendencia', 'tendencias', 'evolucion', 'viene subiendo', 'viene bajando', 'empeorando', 'mejorando']),
    alerta: puntuar(t, ['alerta', 'alertas', 'anomalia', 'algo raro', 'atencion']),
    ayuda: puntuar(t, ['ayuda', 'que podes hacer', 'que sabes', 'opciones', 'como funciona', 'que puedo preguntar']),
    rca: puntuar(t, ['causa raiz', 'causa', 'investigar', 'ishikawa', '5 porque', 'cinco porque', 'porque paso', 'como analizo', 'analisis de causa'])
  };

  // Ajustes de desempate: "resumen rápido" es una intención específica.
  const esRapido = /rapido|rapida/.test(t) && intenciones.resumen > 0;

  // Elegir la intención de mayor puntaje.
  let intencion = null, max = 0;
  for (const [nombre, pts] of Object.entries(intenciones)) {
    if (pts > max) { max = pts; intencion = nombre; }
  }

  // Si menciona un equipo concreto y NO es una pregunta de ranking ni otra
  // intención más fuerte, se interpreta como análisis puntual de ese equipo.
  if (equipoDetectado && !esRanking && max <= 1) {
    agregarMensaje(formatearAnalisisEquipo(analizarEquipo(equipoDetectado)), 'bot');
    return false;
  }

  // Sin intención clara, pero el usuario mencionó un TEMA suelto (una sola
  // palabra como "máquina", "defecto", "horno"...). En vez de la ayuda
  // genérica, repreguntamos con las opciones concretas de ese tema.
  if (max === 0) {
    if (/\b(maquina|equipo|equipos|maquinas)\b/.test(t)) {
      agregarMensaje(
        'Sobre las máquinas puedo decirte:\n' +
        '• Qué máquina tuvo más paradas (del turno, día, semana o mes)\n' +
        '• Qué máquina generó más vacío de horno\n' +
        '• El análisis de una máquina puntual (escribí su nombre, ej: "Prensa 1")\n\n' +
        '¿Cuál querés?',
        'bot'
      );
      return false;
    }
    if (/\b(horno|hornos)\b/.test(t)) {
      agregarMensaje(
        'Sobre el horno puedo decirte los minutos de vacío del turno, o qué equipo generó más vacío por período. ¿Cuál querés?',
        'bot'
      );
      return false;
    }
    if (/\b(produccion|metros|m2|quemado)\b/.test(t)) {
      responderRendimiento();
      return false;
    }
    if (/\b(defecto|defectos|calidad)\b/.test(t)) {
      agregarMensaje(
        'Sobre calidad puedo decirte el defecto preponderante (del turno, día, semana o mes) o el porcentaje de calidad del turno. ¿Cuál querés?',
        'bot'
      );
      return false;
    }
    // Nada reconocible. Si hay API key cargada, delegamos en la IA (envía la
    // pregunta + resumen del turno al proveedor). Si no, ayuda de siempre.
    if (obtenerApiKey()) {
      preguntarIA(texto);
    } else {
      agregarMensaje('No estoy seguro de qué necesitás. Te dejo lo que puedo responder:', 'bot');
      responderAyuda(false);
    }
    return false;
  }

  switch (intencion) {
    case 'defecto':
      responderDefectoPrincipal(periodo, orden);
      ultimaIntencionRanking = 'defecto';
      break;
    case 'parada':
      responderRankingEquipo(periodo, 'parada', orden);
      ultimaIntencionRanking = 'parada';
      break;
    case 'vacio':
      if (esRanking) responderRankingEquipo(periodo, 'vacio', orden);
      else responderVacioTurno();
      ultimaIntencionRanking = 'vacio';
      break;
    case 'rendimiento':
      responderRendimiento();
      break;
    case 'disponibilidad':
      responderDisponibilidad();
      break;
    case 'ege':
      responderEge();
      break;
    case 'calidad':
      responderCalidad();
      ultimaIntencionRanking = 'calidad';
      break;
    case 'resumen':
      if (esRapido) agregarMensaje(formatearResumenRapido(resumenRapidoTurno(lineaActual())), 'bot');
      else agregarMensaje(generarResumenTurno(lineaActual()), 'bot');
      break;
    case 'tendencia': {
      const tendencias = detectarTendencias(lineaActual());
      agregarMensaje(
        tendencias.length
          ? tendencias.map(x => `${x.severidad === 'atencion' ? '⚠️' : 'ℹ️'} ${x.mensaje}`).join('\n\n')
          : 'No detecté tendencias relevantes en los últimos 30 días.',
        'bot'
      );
      break;
    }
    case 'alerta': {
      const alertas = detectarAlertas(lineaActual());
      agregarMensaje(
        alertas.length
          ? alertas.map(a => `${a.severidad === 'critico' ? '🔴' : '⚠️'} ${a.mensaje}`).join('\n\n')
          : 'No hay alertas activas en este turno.',
        'bot'
      );
      break;
    }
    case 'rca':
      responderGuiaRCA();
      break;
    case 'ayuda':
    default:
      responderAyuda(true);
      break;
  }

  return false;
}

/* ==========================================================
   AJUSTES DE IA — API KEY (guardado local y secreto)
   ----------------------------------------------------------
   La clave se guarda SOLO en este equipo (localStorage) bajo una clave
   propia, separada de la base de datos de KIRA. Nunca se muestra completa:
   una vez guardada solo se ve enmascarada (sk-•••••1234). En KIRA 3.0 no se
   envía a ningún servicio; queda lista para habilitar la IA en KIRA 4.0.
   ========================================================== */

const API_KEY_STORAGE = 'kira_ia_api_key';
const PROVEEDOR_STORAGE = 'kira_ia_proveedor';

/** Devuelve la API key guardada (o '' si no hay). Uso interno. */
function obtenerApiKey() {
  try { return localStorage.getItem(API_KEY_STORAGE) || ''; } catch { return ''; }
}

/** Devuelve el proveedor de IA elegido (gemini por defecto). */
function obtenerProveedorIA() {
  try { return localStorage.getItem(PROVEEDOR_STORAGE) || 'gemini'; } catch { return 'gemini'; }
}

/** Guarda el proveedor de IA elegido. Se llama desde el <select> de Ajustes. */
export function cambiarProveedorIA(valor) {
  try { localStorage.setItem(PROVEEDOR_STORAGE, valor || 'gemini'); } catch { /* nada */ }
}

/** Guarda el modelo de IA preferido (opcional). Vacío = automático. */
export function cambiarModeloIA(valor) {
  try {
    const v = (valor || '').trim();
    if (v) localStorage.setItem('kira_ia_modelo', v);
    else localStorage.removeItem('kira_ia_modelo');
  } catch { /* nada */ }
}

/** Enmascara la clave para mostrarla sin revelarla: sk-••••••••1234. */
function enmascararApiKey(key) {
  if (!key) return '';
  const visible = key.slice(-4);
  const prefijo = key.slice(0, 3);
  return `${prefijo}${'•'.repeat(Math.max(6, key.length - 7))}${visible}`;
}

/** Refresca el texto de estado del panel de ajustes según haya o no clave. */
function refrescarEstadoApiKey() {
  const el = document.getElementById('asistenteApiEstado');
  if (!el) return;
  const key = obtenerApiKey();
  if (key) {
    el.textContent = `✓ Clave guardada: ${enmascararApiKey(key)}`;
    el.className = 'text-[11px] font-bold mb-2 text-emerald-700';
  } else {
    el.textContent = 'Sin clave guardada. La IA está desactivada.';
    el.className = 'text-[11px] font-bold mb-2 text-slate-400';
  }
}

/** Abre/cierra el sub-panel de ajustes del asistente. */
export function abrirAjustesAsistente() {
  const panel = document.getElementById('asistenteAjustes');
  if (!panel) return;
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) {
    // Al abrir: limpiar el input (nunca precargamos la clave real), sincronizar
    // el proveedor elegido y mostrar el estado de la clave.
    const input = document.getElementById('asistenteApiKey');
    if (input) input.value = '';
    const sel = document.getElementById('asistenteProveedor');
    if (sel) sel.value = obtenerProveedorIA();
    const inpModelo = document.getElementById('asistenteModelo');
    if (inpModelo) { try { inpModelo.value = localStorage.getItem('kira_ia_modelo') || ''; } catch { inpModelo.value = ''; } }
    refrescarEstadoApiKey();
  }
}

/** Guarda la API key ingresada (solo local). No la vuelve a mostrar en claro. */
export function guardarApiKeyAsistente() {
  const input = document.getElementById('asistenteApiKey');
  const valorKey = (input?.value || '').trim();
  if (!valorKey) {
    agregarMensaje('No ingresaste ninguna clave.', 'bot');
    return;
  }
  try { localStorage.setItem(API_KEY_STORAGE, valorKey); } catch { /* almacenamiento no disponible */ }
  if (input) input.value = '';           // no dejar la clave visible en el campo
  refrescarEstadoApiKey();
  agregarMensaje('Clave guardada de forma segura en este equipo. Ahora puedo usar la IA para preguntas que no cubren mis reglas. Acordate de borrarla cuando dejes de usar KIRA.', 'bot');
}

/** Borra la API key guardada. */
export function borrarApiKeyAsistente() {
  try { localStorage.removeItem(API_KEY_STORAGE); } catch { /* nada */ }
  const input = document.getElementById('asistenteApiKey');
  if (input) input.value = '';
  refrescarEstadoApiKey();
  agregarMensaje('Clave borrada. La IA quedó desactivada.', 'bot');
}

// ==========================================================
// EXPOSICIÓN A window
// ----------------------------------------------------------
// alternarAsistente: onclick del ícono flotante y del botón cerrar.
// limpiarChatAsistente: onclick del botón 🗑️ del header del panel.
// enviarConsultaAsistente: onsubmit del formulario de texto libre.
// abrir/guardar/borrar ajustes: botones del sub-panel de ajustes.
// ==========================================================
window.alternarAsistente = alternarAsistente;
window.limpiarChatAsistente = limpiarChatAsistente;
window.enviarConsultaAsistente = enviarConsultaAsistente;
window.abrirAjustesAsistente = abrirAjustesAsistente;
window.guardarApiKeyAsistente = guardarApiKeyAsistente;
window.borrarApiKeyAsistente = borrarApiKeyAsistente;
window.cambiarProveedorIA = cambiarProveedorIA;
window.cambiarModeloIA = cambiarModeloIA;