/* ========================================================== */
/* ENTORNO.JS — Configuración general y lectura de variables  */
/* ========================================================== */
/*
  Carga las variables de entorno desde el archivo .env en la raíz,
  o desde servidor/configuracion-it/conexion-sqlserver.json si el
  equipo de IT prefirió configurar el archivo JSON.
  No requiere dependencias externas para leer el archivo .env.
*/

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const raizProyecto = path.resolve(__dirname, '../../');

/**
 * Carga variables desde un archivo .env si existe.
 */
function cargarArchivoEnv() {
  const rutaEnv = path.join(raizProyecto, '.env');
  if (!fs.existsSync(rutaEnv)) return;

  try {
    const contenido = fs.readFileSync(rutaEnv, 'utf-8');
    const lineas = contenido.split(/\r?\n/);

    for (const linea of lineas) {
      const lineaLimpia = linea.trim();
      if (!lineaLimpia || lineaLimpia.startsWith('#')) continue;

      const separadorIdx = lineaLimpia.indexOf('=');
      if (separadorIdx === -1) continue;

      const clave = lineaLimpia.slice(0, separadorIdx).trim();
      let valor = lineaLimpia.slice(separadorIdx + 1).trim();

      // Quitar comillas si las tuviera
      if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
        valor = valor.slice(1, -1);
      }

      if (!process.env[clave]) {
        process.env[clave] = valor;
      }
    }
  } catch (err) {
    console.warn('Aviso al leer .env:', err.message);
  }
}

/**
 * Lee la configuración JSON de IT si existe como respaldo.
 */
function cargarConfiguracionJsonIT() {
  const rutaJson = path.join(raizProyecto, 'servidor/configuracion-it/conexion-sqlserver.json');
  if (!fs.existsSync(rutaJson)) return null;

  try {
    const raw = fs.readFileSync(rutaJson, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Cargar .env al iniciar
cargarArchivoEnv();

const configIT = cargarConfiguracionJsonIT() || {};

export const CONFIGURACION = {
  puerto: Number(process.env.PUERTO) || 3000,
  claveSecretaToken: process.env.CLAVE_SECRETA_TOKEN || 'KiraPlantaIndustrialSuperSecreta2026!',
  
  // Configuración para Microsoft SQL Server
  sqlServer: {
    servidor: process.env.SQL_SERVIDOR || configIT.servidor || 'localhost',
    puerto: Number(process.env.SQL_PUERTO) || Number(configIT.puerto) || 1433,
    baseDeDatos: process.env.SQL_BASE_DATOS || configIT.baseDeDatos || 'KIRA_PLANTA',
    usuario: process.env.SQL_USUARIO || configIT.usuario || 'sa',
    password: process.env.SQL_PASSWORD || configIT.password || '',
    opciones: {
      encriptado: process.env.SQL_ENCRIPTADO ? process.env.SQL_ENCRIPTADO === 'true' : Boolean(configIT.opciones?.encriptado),
      confiarEnCertificado: process.env.SQL_CONFIAR_CERTIFICADO ? process.env.SQL_CONFIAR_CERTIFICADO !== 'false' : (configIT.opciones?.confiarEnCertificado !== false),
      tiempoEsperaConexionMs: Number(configIT.opciones?.tiempoEsperaConexionMs) || 15000
    }
  },

  geminiApiKey: process.env.GEMINI_API_KEY || ''
};

