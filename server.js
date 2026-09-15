/* ========================================================== */
/* KIRA INDUSTRIAL PLATFORM — SERVIDOR PRINCIPAL (EXPRESS)    */
/* ========================================================== */

import http from 'http';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

import { CONFIGURACION } from './servidor/configuracion/entorno.js';
import { conectarSQLServer } from './servidor/base-de-datos/conexion.js';
import { iniciarWebSockets } from './servidor/tiempo-real/plantaSocket.js';
import routerAutenticacion from './servidor/rutas/autenticacion.js';
import routerTurnos from './servidor/rutas/turnos.js';
import routerCalidad from './servidor/rutas/calidad.js';
import routerParadas from './servidor/rutas/paradas.js';
import routerIA from './servidor/rutas/ia.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PUERTO = CONFIGURACION.puerto || 3000;

// Servidor HTTP base para Express y Socket.io
const servidorHttp = http.createServer(app);

// Inicializar WebSockets para tiempo real en planta
iniciarWebSockets(servidorHttp);

// Middleware para procesar cuerpos JSON (hasta 10MB para datos o fotos de planta)
app.use(express.json({ limit: '10mb' }));

// 1. Ruta de verificación de salud del servidor
app.get('/api/health', (req, res) => {
  res.json({ 
    estado: 'ok', 
    sistema: 'KIRA Industrial Platform',
    timestamp: new Date().toISOString()
  });
});

// 2. Rutas de la API de KIRA
app.use('/api/auth', routerAutenticacion);
app.use('/api/turnos', routerTurnos);
app.use('/api/calidad', routerCalidad);
app.use('/api/paradas', routerParadas);
app.use('/api/gemini', routerIA);

// 3. Servir archivos estáticos del frontend (HTML, CSS, JS, Vendor)
app.use(express.static(__dirname));

// 4. Redirección por defecto a index.html para rutas no encontradas
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Iniciar servidor escuchando en todas las interfaces de red para acceso en planta
servidorHttp.listen(PUERTO, '0.0.0.0', async () => {
  console.log(`=======================================================`);
  console.log(`🚀 KIRA Server corriendo en http://0.0.0.0:${PUERTO}`);
  console.log(`📁 Modo: Backend Modular Node.js Express + WebSockets`);
  console.log(`🔒 Seguridad: Contraseñas encriptadas con PBKDF2-SHA512`);
  
  // Intentar conectar a Microsoft SQL Server (o activar modo local si IT aún no configuró credenciales)
  await conectarSQLServer();
  
  console.log(`=======================================================`);
});

export { app, servidorHttp };
export default app;
