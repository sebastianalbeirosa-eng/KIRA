/* ========================================================== */
/* AUTENTICACION.JS — Rutas de Login y Seguridad de Sesión   */
/* ========================================================== */
/*
  Maneja la autenticación segura de usuarios para KIRA:
  - Verificación de credenciales con hash y sal criptográfica.
  - Las contraseñas NUNCA viajan ni se guardan en texto plano.
  - Emisión de tokens de sesión firmados.
*/

import express from 'express';
import { CONFIGURACION } from '../configuracion/entorno.js';
import { crearHashPassword, verificarPassword, generarTokenSesion, verificarTokenSesion } from '../seguridad/encriptacion.js';

const router = express.Router();

import { baseDeDatos } from '../base-de-datos/adaptador.js';

// Usuarios iniciales del sistema protegidos con hash criptográfico (para arranque sin DB o fallback)
const USUARIOS_SEMILLA = {
  'admin':      { nombre: 'Administrador',       rol: 'admin',      ...crearHashPassword('admin123') },
  'calidad':    { nombre: 'Operario Calidad',    rol: 'calidad',    ...crearHashPassword('calidad123') },
  'produccion': { nombre: 'Operario Producción',  rol: 'produccion', ...crearHashPassword('prod123') },
  'supervisor': { nombre: 'Supervisor',          rol: 'supervisor', ...crearHashPassword('super123') },
  'Marcelo':    { nombre: 'Marcelo Molina',      rol: 'produccion', ...crearHashPassword('Marce123') }
};

/**
 * Endpoint para consultar el estado de la base de datos
 * GET /api/auth/estado-db
 */
router.get('/estado-db', (req, res) => {
  res.json(baseDeDatos.obtenerEstado());
});

/**
 * Endpoint de Inicio de Sesión
 * POST /api/auth/login
 */
router.post('/login', async (req, res) => {
  try {
    const { usuario, password } = req.body || {};

    if (!usuario || !password) {
      return res.status(400).json({ 
        exito: false, 
        mensaje: 'Por favor, ingresá el usuario y la contraseña.' 
      });
    }

    const usuarioLimpio = String(usuario).trim();

    // 1. Buscar primero en la base de datos (SQL Server / Local)
    let registro = await baseDeDatos.obtenerUsuario(usuarioLimpio);

    // 2. Si no existe en la base, buscar en usuarios semilla del sistema
    if (!registro && USUARIOS_SEMILLA[usuarioLimpio]) {
      registro = USUARIOS_SEMILLA[usuarioLimpio];
      // Guardar en la base de datos para sincronizar
      baseDeDatos.guardarUsuario(usuarioLimpio, registro).catch(() => {});
    }

    if (!registro) {
      return res.status(401).json({ 
        exito: false, 
        mensaje: 'Usuario no encontrado.' 
      });
    }

    // 3. Verificar contraseña de forma criptográficamente segura
    const coincide = verificarPassword(password, registro.hash, registro.salt);

    if (!coincide) {
      return res.status(401).json({ 
        exito: false, 
        mensaje: 'Contraseña incorrecta.' 
      });
    }

    // 3. Generar token de sesión firmado
    const datosPublicos = {
      usuario: usuarioLimpio,
      nombre: registro.nombre,
      rol: registro.rol
    };

    const token = generarTokenSesion(datosPublicos, CONFIGURACION.claveSecretaToken, 24);

    return res.json({
      exito: true,
      mensaje: 'Autenticación exitosa',
      token,
      usuario: datosPublicos
    });

  } catch (error) {
    console.error('Error en ruta /login:', error);
    return res.status(500).json({ 
      exito: false, 
      mensaje: 'Error interno en el servidor de autenticación.' 
    });
  }
});

/**
 * Endpoint para Verificar Token de Sesión Activa
 * GET /api/auth/verificar
 */
router.get('/verificar', (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ valido: false, mensaje: 'Token no proporcionado.' });
  }

  const datosToken = verificarTokenSesion(token, CONFIGURACION.claveSecretaToken);

  if (!datosToken) {
    return res.status(401).json({ valido: false, mensaje: 'Token inválido o expirado.' });
  }

  return res.json({
    valido: true,
    usuario: {
      usuario: datosToken.usuario,
      nombre: datosToken.nombre,
      rol: datosToken.rol
    }
  });
});

export default router;

