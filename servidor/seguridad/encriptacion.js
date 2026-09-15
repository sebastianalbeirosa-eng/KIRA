/* ========================================================== */
/* ENCRIPTACION.JS — Seguridad, Criptografía y Contraseñas    */
/* ========================================================== */
/*
  Este módulo se encarga de proteger las contraseñas de los usuarios
  siguiendo las recomendaciones internacionales de OWASP:
  - NUNCA se guardan contraseñas en texto plano.
  - Se utiliza una sal (salt) aleatoria de 16 bytes por usuario.
  - Se utiliza PBKDF2 con SHA-512 y 100.000 iteraciones (estándar bancario).
  - La verificación usa comparación de tiempo constante (timingSafeEqual)
    para evitar ataques de temporización (timing attacks).
*/

import crypto from 'crypto';

const ITERACIONES = 100000;
const LONGITUD_CLAVE = 64;
const ALGORITMO = 'sha512';

/**
 * Genera un hash criptográfico seguro a partir de una contraseña en texto plano.
 * @param {string} password - Contraseña ingresada por el usuario
 * @returns {{ hash: string, salt: string }}
 */
export function crearHashPassword(password) {
  if (!password || typeof password !== 'string') {
    throw new Error('La contraseña debe ser una cadena de texto válida.');
  }

  // Sal criptográfica única por cada usuario
  const salt = crypto.randomBytes(16).toString('hex');
  
  const hash = crypto.pbkdf2Sync(
    password,
    salt,
    ITERACIONES,
    LONGITUD_CLAVE,
    ALGORITMO
  ).toString('hex');

  return { hash, salt };
}

/**
 * Verifica si una contraseña ingresada coincide con el hash y sal almacenados.
 * @param {string} password - Contraseña ingresada en el login
 * @param {string} hashGuardado - Hash almacenado en la base de datos
 * @param {string} saltGuardada - Sal almacenada en la base de datos
 * @returns {boolean} true si la contraseña es correcta, false en caso contrario
 */
export function verificarPassword(password, hashGuardado, saltGuardada) {
  if (!password || !hashGuardado || !saltGuardada) return false;

  try {
    const hashCalculado = crypto.pbkdf2Sync(
      password,
      saltGuardada,
      ITERACIONES,
      LONGITUD_CLAVE,
      ALGORITMO
    ).toString('hex');

    // Comparación segura en tiempo constante contra ataques de canal lateral
    const bufferCalculado = Buffer.from(hashCalculado, 'hex');
    const bufferGuardado = Buffer.from(hashGuardado, 'hex');

    if (bufferCalculado.length !== bufferGuardado.length) {
      return false;
    }

    return crypto.timingSafeEqual(bufferCalculado, bufferGuardado);
  } catch (error) {
    console.error('Error al verificar contraseña:', error);
    return false;
  }
}

/**
 * Genera un token de sesión seguro con firma criptográfica HMAC.
 * @param {object} datosUsuario - Datos públicos del usuario (usuario, rol, nombre)
 * @param {string} claveSecreta - Clave secreta del servidor
 * @param {number} [duracionHoras=24] - Horas de validez
 * @returns {string} Token firmado
 */
export function generarTokenSesion(datosUsuario, claveSecreta, duracionHoras = 24) {
  const encabezado = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  
  const expiracion = Math.floor(Date.now() / 1000) + (duracionHoras * 3600);
  const cargaUtil = Buffer.from(JSON.stringify({
    ...datosUsuario,
    exp: expiracion,
    iat: Math.floor(Date.now() / 1000)
  })).toString('base64url');

  const firma = crypto
    .createHmac('sha256', claveSecreta || 'KIRA_SECRETO_DEFAULT')
    .update(`${encabezado}.${cargaUtil}`)
    .digest('base64url');

  return `${encabezado}.${cargaUtil}.${firma}`;
}

/**
 * Valida un token de sesión y devuelve sus datos si es legítimo y no ha expirado.
 * @param {string} token - Token recibido en la cabecera
 * @param {string} claveSecreta - Clave secreta del servidor
 * @returns {object|null} Datos del usuario o null si es inválido
 */
export function verificarTokenSesion(token, claveSecreta) {
  if (!token || typeof token !== 'string') return null;

  const partes = token.split('.');
  if (partes.length !== 3) return null;

  const [encabezado, cargaUtil, firma] = partes;

  const firmaEsperada = crypto
    .createHmac('sha256', claveSecreta || 'KIRA_SECRETO_DEFAULT')
    .update(`${encabezado}.${cargaUtil}`)
    .digest('base64url');

  const bufFirma = Buffer.from(firma, 'base64url');
  const bufEsperada = Buffer.from(firmaEsperada, 'base64url');

  if (bufFirma.length !== bufEsperada.length || !crypto.timingSafeEqual(bufFirma, bufEsperada)) {
    return null; // Firma adulterada
  }

  try {
    const payload = JSON.parse(Buffer.from(cargaUtil, 'base64url').toString('utf-8'));
    const ahora = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < ahora) {
      return null; // Token expirado
    }
    return payload;
  } catch {
    return null;
  }
}

