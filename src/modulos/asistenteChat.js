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
  defectoPrincipalTurno, defectoPrincipalDia, defectoPrincipalPeriodo
} from './asistenteTurno.js';

// Se vuelve true la primera vez que se abre el panel, para dibujar
// las preguntas prearmadas una sola vez (no hace falta repetirlo).
let preguntasYaRenderizadas = false;

// Mensaje de bienvenida — se reutiliza al abrir el panel por primera
// vez y al limpiar la conversación con el botón 🗑️.
const MENSAJE_BIENVENIDA = 'Hola, soy el asistente de análisis de KIRA. No uso IA externa — trabajo 100% con los datos que ya cargaste. Elegí una consulta o escribí el nombre de un equipo.';

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
  if (/\bsemana(l)?\b/.test(textoLower)) return 'semana';
  if (/\bmes(ual)?\b/.test(textoLower)) return 'mes';
  if (/\bdia(rio)?\b|\bhoy\b/.test(textoLower)) return 'dia';
  return 'turno';
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
    { texto: '⚠️ Alertas', accion: manejarAlertas }
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

/** Responde a "¿qué equipo paró/tuvo vacío más" según el período detectado (turno/día/semana/mes). */
function responderRankingEquipo(periodo, tipoDato) {
  const esParada = tipoDato === 'parada';
  const linea = lineaActual();

  if (periodo === 'turno') {
    const top = esParada ? equipoConMasParada(linea) : equipoConMasVacio(linea);
    const valorTop = esParada ? top?.mins : top?.vacio;
    agregarMensaje(
      top
        ? `El equipo con más ${esParada ? 'minutos de parada' : 'vacío de horno'} este turno es ${top.equipo} (${valorTop} min, línea ${top.lineaNombre}).`
        : `No hay ${esParada ? 'paradas' : 'registros de vacío'} en este turno todavía.`,
      'bot'
    );
    return;
  }

  const funciones = {
    dia: { fn: esParada ? equipoConMasParadaDia : equipoConMasVacioDia, etiqueta: 'el día de hoy' },
    semana: { fn: () => (esParada ? equipoConMasParadaPeriodo(7, linea) : equipoConMasVacioPeriodo(7, linea)), etiqueta: 'la última semana' },
    mes: { fn: () => (esParada ? equipoConMasParadaPeriodo(30, linea) : equipoConMasVacioPeriodo(30, linea)), etiqueta: 'el último mes' }
  };

  const { fn, etiqueta } = funciones[periodo];
  const top = periodo === 'dia' ? fn(linea) : fn();
  const valorTop = esParada ? top?.minutos : top?.vacio;

  agregarMensaje(
    top
      ? `El equipo que ${esParada ? 'más paró' : 'más vacío de horno tuvo'} en ${etiqueta} es ${top.equipo} (${valorTop} min${esParada ? ` en ${top.eventos} evento${top.eventos === 1 ? '' : 's'}` : ' acumulados'}, línea ${top.lineaNombre}).`
      : `No hay ${esParada ? 'paradas' : 'registros de vacío'} en ${etiqueta}.`,
    'bot'
  );
}

/** Responde a "¿cuál es el defecto más crítico/preponderante" según el período detectado. */
function responderDefectoPrincipal(periodo) {
  const linea = lineaActual();

  if (periodo === 'turno') {
    const d = defectoPrincipalTurno(linea);
    agregarMensaje(
      d
        ? `El defecto crítico de este turno es "${d.nombre}" (${d.porcentaje}%).${d.accion ? ` Acción: ${d.accion}` : ' Sin acción registrada.'}`
        : 'No hay defectos registrados en este turno.',
      'bot'
    );
    return;
  }

  const config = {
    dia: { fn: () => defectoPrincipalDia(linea), etiqueta: 'del día de hoy' },
    semana: { fn: () => defectoPrincipalPeriodo(7, linea), etiqueta: 'de la última semana' },
    mes: { fn: () => defectoPrincipalPeriodo(30, linea), etiqueta: 'del último mes' }
  };
  const { fn, etiqueta } = config[periodo];
  const d = fn();

  agregarMensaje(
    d
      ? `El defecto más frecuente ${etiqueta} es "${d.nombre}", con un promedio de ${d.porcentajePromedio.toFixed(1)}% en ${d.cantidad} registro${d.cantidad === 1 ? '' : 's'}.${d.accionMasReciente ? ` Última acción registrada: ${d.accionMasReciente}` : ''}`
      : `No hay defectos registrados ${etiqueta}.`,
    'bot'
  );
}

/**
 * Procesa el texto libre escrito por el usuario: busca palabras clave
 * (resumen, tendencia, alerta, período) y nombres de equipo. Si no
 * reconoce nada, responde sugiriendo las preguntas prearmadas.
 */
export function enviarConsultaAsistente(event) {
  event.preventDefault();
  const input = document.getElementById('asistenteInput');
  const texto = input.value.trim();
  if (!texto) return false;

  agregarMensaje(texto, 'usuario');
  input.value = '';

  const textoLower = normalizarTexto(texto);
  const equipoDetectado = detectarEquipoEnTexto(texto);
  const periodo = detectarPeriodo(textoLower);

  // "máquina/equipo con más parada(s)" — se chequea ANTES que equipo
  // detectado, por si el nombre de un equipo aparece dentro de la
  // pregunta general (ej: "qué prensa tuvo más paradas" no debería
  // interpretarse como consulta puntual de "Prensa 1").
  const preguntaPorMaquina = /\b(maquina|equipo)\b/.test(textoLower) && /\bmas\b/.test(textoLower);

  if (preguntaPorMaquina && /parada|\bparo\b/.test(textoLower)) {
    responderRankingEquipo(periodo, 'parada');
  } else if (preguntaPorMaquina && /\bvacio/.test(textoLower)) {
    responderRankingEquipo(periodo, 'vacio');
  } else if (/\bdefecto/.test(textoLower) && /\bmas\b|critico|preponderante|mayor/.test(textoLower)) {
    responderDefectoPrincipal(periodo);
  } else if (equipoDetectado) {
    const analisis = analizarEquipo(equipoDetectado);
    agregarMensaje(formatearAnalisisEquipo(analisis), 'bot');
  } else if (/rapido/.test(textoLower)) {
    agregarMensaje(formatearResumenRapido(resumenRapidoTurno(lineaActual())), 'bot');
  } else if (textoLower.includes('tendencia')) {
    const tendencias = detectarTendencias(lineaActual());
    agregarMensaje(
      tendencias.length
        ? tendencias.map(t => `${t.severidad === 'atencion' ? '⚠️' : 'ℹ️'} ${t.mensaje}`).join('\n\n')
        : 'No detecté tendencias relevantes en los últimos 30 días.',
      'bot'
    );
  } else if (textoLower.includes('alerta')) {
    const alertas = detectarAlertas(lineaActual());
    agregarMensaje(
      alertas.length
        ? alertas.map(a => `${a.severidad === 'critico' ? '🔴' : '⚠️'} ${a.mensaje}`).join('\n\n')
        : 'No hay alertas activas en este turno.',
      'bot'
    );
  } else if (textoLower.includes('resumen')) {
    agregarMensaje(generarResumenTurno(lineaActual()), 'bot');
  } else {
    agregarMensaje(
      'No reconocí esa consulta. Probá con alguna de las preguntas sugeridas arriba, o escribí el nombre de un equipo (ej: "Prensa 1") para ver su análisis.',
      'bot'
    );
  }

  return false;
}

// ==========================================================
// EXPOSICIÓN A window
// ----------------------------------------------------------
// alternarAsistente: onclick del ícono flotante y del botón cerrar.
// limpiarChatAsistente: onclick del botón 🗑️ del header del panel.
// enviarConsultaAsistente: onsubmit del formulario de texto libre.
// ==========================================================
window.alternarAsistente = alternarAsistente;
window.limpiarChatAsistente = limpiarChatAsistente;
window.enviarConsultaAsistente = enviarConsultaAsistente;