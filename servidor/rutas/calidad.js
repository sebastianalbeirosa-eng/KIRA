/* ========================================================== */
/* CALIDAD.JS — Rutas para Tomas de Calidad y Defectos        */
/* ========================================================== */

import express from 'express';
import { baseDeDatos } from '../base-de-datos/adaptador.js';
import { notificarCambioPlanta } from '../tiempo-real/plantaSocket.js';

const router = express.Router();

/**
 * Obtiene todas las tomas de calidad de un turno
 * GET /api/calidad/:turnoId
 */
router.get('/:turnoId', async (req, res) => {
  try {
    const tomas = await baseDeDatos.obtenerTomasTurno(req.params.turnoId);
    return res.json({ exito: true, tomas });
  } catch (error) {
    return res.status(500).json({ exito: false, mensaje: error.message });
  }
});

/**
 * Registra o actualiza una toma de calidad hora a hora
 * POST /api/calidad/toma
 */
router.post('/toma', async (req, res) => {
  try {
    const toma = req.body;
    if (!toma || !toma.id || !toma.turno_id || !toma.hora) {
      return res.status(400).json({ 
        exito: false, 
        mensaje: 'Datos incompletos: se requiere id, turno_id y hora.' 
      });
    }

    const guardada = await baseDeDatos.guardarToma(toma);

    // Notificar en tiempo real a todas las pantallas de planta
    notificarCambioPlanta('nueva_toma', guardada);

    return res.json({ 
      exito: true, 
      mensaje: 'Toma de calidad registrada con éxito.', 
      toma: guardada 
    });
  } catch (error) {
    return res.status(500).json({ exito: false, mensaje: error.message });
  }
});

export default router;

