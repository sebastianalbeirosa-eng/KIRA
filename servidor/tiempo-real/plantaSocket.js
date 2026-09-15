/* ========================================================== */
/* PLANTASOCKET.JS — Tiempo Real con WebSockets (Socket.io)   */
/* ========================================================== */
/*
  Coordina las comunicaciones bidireccionales en tiempo real
  entre todas las terminales de planta (pantallas de línea,
  puestos de calidad, tableros de supervisión y vista general).
*/

import { Server } from 'socket.io';

let io = null;

/**
 * Inicializa el servidor de WebSockets adjunto al servidor HTTP.
 * @param {import('http').Server} servidorHttp 
 * @returns {Server} Instancia de Socket.io
 */
export function iniciarWebSockets(servidorHttp) {
  if (io) return io;

  io = new Server(servidorHttp, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    },
    // Optimización para redes industriales
    pingTimeout: 20000,
    pingInterval: 10000
  });

  io.on('connection', (socket) => {
    // console.log(`[Tiempo Real] 🟢 Terminal conectada: ${socket.id}`);

    // Cuando un cliente emite un cambio en bloque (ej: guardó una parada o toma)
    socket.on('cambio_planta', (data) => {
      // Reenviar a todas las demás terminales conectadas
      socket.broadcast.emit('cambio_planta', {
        ...data,
        timestamp: Date.now(),
        origenSocketId: socket.id
      });
    });

    socket.on('disconnect', () => {
      // console.log(`[Tiempo Real] 🔴 Terminal desconectada: ${socket.id}`);
    });
  });

  console.log(`[Tiempo Real] ⚡ Servidor de WebSockets activo y listo para sincronizar pantallas.`);
  return io;
}

/**
 * Devuelve la instancia global de Socket.io
 */
export function obtenerIO() {
  return io;
}

/**
 * Notifica un cambio operativo a TODAS las terminales conectadas en planta.
 * @param {string} tipo - Tipo de evento (ej: 'nueva_toma', 'nueva_parada', 'cambio_turno')
 * @param {object} datos - Información relevante del cambio
 */
export function notificarCambioPlanta(tipo, datos = {}) {
  if (!io) return;

  try {
    io.emit('cambio_planta', {
      tipo,
      datos,
      timestamp: Date.now()
    });
  } catch (err) {
    console.error('[Tiempo Real] Error al emitir evento a planta:', err.message);
  }
}

