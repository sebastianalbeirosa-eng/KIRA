/* ========================================================== */
/* PARADAS.JS — Rutas para Registro de Tiempos Muertos       */
/* ========================================================== */

import express from 'express';
import { baseDeDatos } from '../base-de-datos/adaptador.js';
import { notificarCambioPlanta } from '../tiempo-real/plantaSocket.js';

const router = express.Router();

/**
 * Obtiene todas las paradas de un turno
 * GET /api/paradas/:turnoId
 */
router.get('/:turnoId', async (req, res) => {
  try {
    const paradas = await baseDeDatos.obtenerParadasTurno(req.params.turnoId);
    return res.json({ exito: true, paradas });
  } catch (error) {
    return res.status(500).json({ exito: false, mensaje: error.message });
  }
});

/**
 * Registra o actualiza una parada de línea
 * POST /api/paradas
 */
router.post('/', async (req, res) => {
  try {
    const parada = req.body;
    if (!parada || !parada.id || !parada.turno_id || !parada.hora_inicio || !parada.duracion_minutos) {
      return res.status(400).json({ 
        exito: false, 
        mensaje: 'Datos incompletos: se requiere id, turno_id, hora_inicio y duracion_minutos.' 
      });
    }

    const guardada = await baseDeDatos.guardarParada(parada);

    // Notificar en tiempo real a todas las pantallas de planta
    notificarCambioPlanta('nueva_parada', guardada);

    return res.json({ 
      exito: true, 
      mensaje: 'Parada registrada con éxito.', 
      parada: guardada 
    });
  } catch (error) {
    return res.status(500).json({ exito: false, mensaje: error.message });
  }
});

export default router;

