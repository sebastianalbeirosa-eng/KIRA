/* ========================================================== */
/* TURNOS.JS — Rutas para Gestión de Turnos en Planta         */
/* ========================================================== */

import express from 'express';
import { baseDeDatos } from '../base-de-datos/adaptador.js';
import { notificarCambioPlanta } from '../tiempo-real/plantaSocket.js';

const router = express.Router();

/**
 * Obtiene los datos de un turno específico
 * GET /api/turnos/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const turno = await baseDeDatos.obtenerTurno(req.params.id);
    if (!turno) {
      return res.status(404).json({ exito: false, mensaje: 'Turno no encontrado.' });
    }
    return res.json({ exito: true, turno });
  } catch (error) {
    return res.status(500).json({ exito: false, mensaje: error.message });
  }
});

/**
 * Guarda o actualiza un turno (producto, formato, ciclo vigente)
 * POST /api/turnos
 */
router.post('/', async (req, res) => {
  try {
    const { id, fecha, turno, productoVigente, formatoVigente, cicloVigente, abierto } = req.body || {};
    if (!id) {
      return res.status(400).json({ exito: false, mensaje: 'Falta el identificador del turno.' });
    }

    const guardado = await baseDeDatos.guardarTurno(id, {
      fecha,
      turno,
      productoVigente,
      formatoVigente,
      cicloVigente,
      abierto
    });

    // Notificar en tiempo real a todas las pantallas de planta
    notificarCambioPlanta('cambio_turno', guardado);

    return res.json({ exito: true, mensaje: 'Turno guardado exitosamente.', turno: guardado });
  } catch (error) {
    return res.status(500).json({ exito: false, mensaje: error.message });
  }
});

export default router;

