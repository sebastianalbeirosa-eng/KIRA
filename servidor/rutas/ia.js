/* ========================================================== */
/* IA.JS — Rutas del Asistente de Inteligencia Artificial    */
/* ========================================================== */

import express from 'express';
import { CONFIGURACION } from '../configuracion/entorno.js';

const router = express.Router();

// Consulta de estado del servicio de IA
router.get('/status', (req, res) => {
  res.json({ configured: Boolean(CONFIGURACION.geminiApiKey || process.env.GEMINI_API_KEY) });
});

// Proxy seguro hacia la API de Google Gemini
router.post('/', async (req, res) => {
  const { prompt, model, systemInstruction, apiKey: clientKey } = req.body;
  const apiKey = CONFIGURACION.geminiApiKey || process.env.GEMINI_API_KEY || clientKey;

  if (!apiKey) {
    return res.status(400).json({ error: 'No se encontró la clave de API de Gemini en el servidor ni en la petición.' });
  }

  const selectedModel = model || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const bodyPayload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 800 }
  };

  if (systemInstruction) {
    bodyPayload.system_instruction = { parts: [{ text: systemInstruction }] };
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload)
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    return res.json({ text });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Error al comunicarse con Gemini' });
  }
});

export default router;

