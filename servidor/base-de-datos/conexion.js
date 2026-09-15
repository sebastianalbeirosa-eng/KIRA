/* ========================================================== */
/* CONEXION.JS — Gestor de Conexión a Microsoft SQL Server    */
/* ========================================================== */
/*
  Gestiona el pool de conexiones hacia Microsoft SQL Server.
  Si el servidor SQL de la empresa no está disponible o las
  credenciales aún no fueron cargadas por el equipo de IT,
  el sistema lo detecta inmediatamente y activa el modo de
  almacenamiento local de respaldo sin interrumpir la aplicación.
*/

import { CONFIGURACION } from '../configuracion/entorno.js';

let pool = null;
let estado = {
  conectado: false,
  error: null,
  servidor: null,
  baseDeDatos: null
};

/**
 * Intenta establecer la conexión con Microsoft SQL Server.
 * @returns {Promise<object|null>} Pool de conexiones de mssql o null si falla.
 */
export async function conectarSQLServer() {
  if (pool && pool.connected) {
    return pool;
  }

  const { servidor, puerto, baseDeDatos, usuario, password, opciones } = CONFIGURACION.sqlServer;

  // Si no hay contraseña ni servidor configurado, no intentar para no demorar el arranque
  if (!password && (!servidor || servidor === 'localhost')) {
    estado = {
      conectado: false,
      error: 'Pendiente de configuración por IT',
      servidor,
      baseDeDatos
    };
    console.log(`[SQL Server] ℹ️ Sin credenciales configuradas en .env ni conexion-sqlserver.json.`);
    console.log(`[SQL Server] 👉 Operando en modo de respaldo local para desarrollo y pruebas.`);
    return null;
  }

  try {
    const mssql = await import('mssql');
    const sql = mssql.default || mssql;

    const config = {
      user: usuario,
      password: password,
      server: servidor,
      port: Number(puerto) || 1433,
      database: baseDeDatos,
      options: {
        encrypt: Boolean(opciones?.encriptado),
        trustServerCertificate: opciones?.confiarEnCertificado !== false,
        connectTimeout: Number(opciones?.tiempoEsperaConexionMs) || 8000
      },
      pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
      }
    };

    console.log(`[SQL Server] 🔌 Intentando conectar a ${usuario}@${servidor}:${puerto}/${baseDeDatos}...`);
    pool = await new sql.ConnectionPool(config).connect();

    estado = {
      conectado: true,
      error: null,
      servidor,
      baseDeDatos
    };

    console.log(`[SQL Server] ✅ Conexión establecida con éxito a la base [${baseDeDatos}].`);
    return pool;

  } catch (err) {
    estado = {
      conectado: false,
      error: err.message,
      servidor,
      baseDeDatos
    };

    console.warn(`[SQL Server] ⚠️ No se pudo conectar a Microsoft SQL Server (${err.message}).`);
    console.warn(`[SQL Server] 👉 Activando almacenamiento local de respaldo automáticamente.`);
    pool = null;
    return null;
  }
}

/**
 * Devuelve el pool activo de SQL Server o null si está desconectado.
 */
export function obtenerPool() {
  return pool && pool.connected ? pool : null;
}

/**
 * Devuelve el estado actual de la conexión para diagnósticos.
 */
export function estadoConexion() {
  return { ...estado };
}

/**
 * Cierra la conexión de forma limpia al apagar el servidor.
 */
export async function desconectarSQLServer() {
  if (pool) {
    try {
      await pool.close();
      pool = null;
      estado.conectado = false;
    } catch {}
  }
}

