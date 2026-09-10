import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Gemini status check
app.get('/api/gemini/status', (req, res) => {
  res.json({ configured: Boolean(process.env.GEMINI_API_KEY) });
});

// Server-side Gemini API proxy
app.post('/api/gemini', async (req, res) => {
  const { prompt, model, systemInstruction, apiKey: clientKey } = req.body;
  const apiKey = process.env.GEMINI_API_KEY || clientKey;

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

// Serve static assets
app.use(express.static(__dirname));

// Default fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`KIRA server running on http://0.0.0.0:${PORT}`);
});
