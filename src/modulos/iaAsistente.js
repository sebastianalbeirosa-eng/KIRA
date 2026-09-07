/* ========================================================== */
/* IA-ASISTENTE.JS — Puente hacia proveedores de IA (opcional) */
/* ========================================================== */
/*
  Este módulo SOLO se usa cuando el motor de reglas del asistente no supo
  responder Y el usuario cargó una API key. Arma un prompt con la pregunta
  + un resumen mínimo del turno y lo envía al proveedor elegido (Gemini,
  OpenAI o Anthropic). Devuelve el texto de la respuesta.

  Privacidad: al llamar acá, la pregunta y el resumen del turno SALEN a
  internet, al servidor del proveedor. Sin key, este módulo nunca se invoca.
  No se envía la base de datos completa: solo un resumen de KPIs del turno.
*/

import { calcularKpisPlanta } from './vistaDePlanta.js';

/**
 * Arma un resumen corto y legible del turno actual para dar contexto a la IA.
 * Se mantiene chico a propósito (menos tokens = más barato y rápido).
 * @param {string} linea  'TODAS' o id de línea
 * @returns {string}
 */
export function resumenContextoIA(linea) {
  let k;
  try { k = calcularKpisPlanta(linea); } catch { return 'Sin datos de turno disponibles.'; }

  const partes = [];
  partes.push(`Línea analizada: ${linea === 'TODAS' ? 'todas' : linea}.`);
  if (k.m) {
    partes.push(`Minutos de parada: ${k.m.parada}. Minutos de vacío de horno: ${k.m.vacio}. Disponibilidad: ${k.m.disponibilidad.toFixed(1)}%.`);
  }
  if (k.maquinaCritica) {
    partes.push(`Máquina más crítica: ${k.maquinaCritica.equipo} (${k.maquinaCritica.mins} min, motivo "${k.maquinaCritica.motivo || 's/d'}").`);
  }
  if (k.defectoPreponderante) {
    partes.push(`Defecto preponderante: ${k.defectoPreponderante.nombre} (${k.defectoPreponderante.porcentaje}%).`);
  }
  if (k.rendimientoPct !== null && k.rendimientoPct !== undefined) {
    partes.push(`Rendimiento: ${k.rendimientoPct.toFixed(1)}% (real ${k.m2Real} m² vs objetivo ${k.m2Objetivo} m²).`);
  }
  if (typeof k.calidadReal === 'number') {
    partes.push(`Calidad: ${k.calidadReal.toFixed(1)}% (objetivo ${k.calidadObjetivo?.toFixed(1) || '—'}%).`);
  }
  if (typeof k.egeTurno === 'number') {
    partes.push(`Eficiencia global (EGE): ${k.egeTurno.toFixed(1)}%.`);
  }
  return partes.join(' ');
}

/**
 * Instrucción de sistema: define el rol de la IA para que responda como
 * asistente industrial de KIRA, en español, breve y práctico.
 */
const SISTEMA = [
  'Sos el asistente de análisis de KIRA, un software de gestión de producción',
  'de una fábrica de pisos y revestimientos cerámicos. Respondé en español',
  'rioplatense, de forma breve, clara y práctica para un supervisor de planta.',
  'Usá los datos del turno que se te pasan como contexto. Si no tenés datos',
  'suficientes, decilo con honestidad y sugerí qué cargar. No inventes cifras.'
].join(' ');

/**
 * Llama al proveedor de IA correspondiente. Devuelve el texto de respuesta.
 * Lanza Error con mensaje claro si algo falla (key inválida, red, etc.).
 * @param {string} proveedor  'gemini' | 'openai' | 'anthropic'
 * @param {string} apiKey
 * @param {string} pregunta
 * @param {string} contexto  resumen del turno
 * @returns {Promise<string>}
 */
export async function consultarIA(proveedor, apiKey, pregunta, contexto) {
  const prompt = `Contexto del turno:\n${contexto}\n\nPregunta del supervisor:\n${pregunta}`;

  if (proveedor === 'gemini') return consultarGemini(apiKey, prompt);
  if (proveedor === 'openai') return consultarOpenAI(apiKey, prompt);
  if (proveedor === 'anthropic') return consultarAnthropic(apiKey, prompt);
  throw new Error(`Proveedor de IA no soportado: ${proveedor}`);
}

/* ---------- GOOGLE GEMINI ---------- */
// Modelos de Gemini a intentar, en orden. Google renombra/discontinúa modelos
// seguido, así que probamos varios: si uno da 404 "modelo no disponible",
// pasamos al siguiente automáticamente. El usuario también puede fijar uno
// propio en Ajustes (localStorage 'kira_ia_modelo'), que se prueba primero.
const MODELOS_GEMINI = [
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash'
];

function modelosGeminiAProbar() {
  let preferido = '';
  try { preferido = localStorage.getItem('kira_ia_modelo') || ''; } catch { /* nada */ }
  // El preferido va primero (si existe), luego la lista por defecto sin duplicar.
  return [preferido, ...MODELOS_GEMINI].filter((m, i, arr) => m && arr.indexOf(m) === i);
}

async function consultarGemini(apiKey, prompt) {
  const body = {
    system_instruction: { parts: [{ text: SISTEMA }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 500 }
  };

  const modelos = modelosGeminiAProbar();
  let ultimoError = null;

  for (const modelo of modelos) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${encodeURIComponent(apiKey)}`;
    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (e) {
      // Error de red: no tiene sentido seguir probando modelos.
      throw new Error('No hay conexión con Gemini. Revisá tu internet.');
    }

    if (resp.ok) {
      const data = await resp.json();
      const texto = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
      if (!texto) throw new Error('La IA (Gemini) no devolvió respuesta.');
      return texto.trim();
    }

    // 404 = modelo inexistente/discontinuado → probar el siguiente.
    if (resp.status === 404) {
      ultimoError = await mensajeError(resp, 'Gemini');
      continue;
    }
    // Otros errores (401/403/429...) no se arreglan cambiando de modelo.
    throw new Error(await mensajeError(resp, 'Gemini'));
  }

  throw new Error(
    (ultimoError ? ultimoError + ' ' : '') +
    'Ningún modelo de Gemini disponible respondió. Podés fijar el modelo correcto en Ajustes.'
  );
}

/* ---------- OPENAI ---------- */
async function consultarOpenAI(apiKey, prompt) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      max_tokens: 500,
      messages: [
        { role: 'system', content: SISTEMA },
        { role: 'user', content: prompt }
      ]
    })
  });
  if (!resp.ok) throw new Error(await mensajeError(resp, 'OpenAI'));
  const data = await resp.json();
  const texto = data?.choices?.[0]?.message?.content || '';
  if (!texto) throw new Error('La IA (OpenAI) no devolvió respuesta.');
  return texto.trim();
}

/* ---------- ANTHROPIC (CLAUDE) ---------- */
async function consultarAnthropic(apiKey, prompt) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-latest',
      max_tokens: 500,
      system: SISTEMA,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!resp.ok) throw new Error(await mensajeError(resp, 'Anthropic'));
  const data = await resp.json();
  const texto = (data?.content || []).map(c => c.text).join('') || '';
  if (!texto) throw new Error('La IA (Claude) no devolvió respuesta.');
  return texto.trim();
}

/** Construye un mensaje de error legible a partir de una respuesta HTTP fallida. */
async function mensajeError(resp, proveedor) {
  let detalle = '';
  try {
    const err = await resp.json();
    detalle = err?.error?.message || err?.message || '';
  } catch { /* sin cuerpo JSON */ }
  if (resp.status === 401 || resp.status === 403) {
    return `La API key de ${proveedor} parece inválida o sin permisos (${resp.status}). Revisala en Ajustes.`;
  }
  if (resp.status === 429) {
    return `${proveedor} rechazó por límite de uso o cuota (429). Probá más tarde.`;
  }
  return `Error al consultar ${proveedor} (${resp.status})${detalle ? ': ' + detalle : ''}.`;
}
