/* ========================================================== */
/* ADAPTADOR-LOCAL.JS — Almacenamiento Local de Respaldo      */
/* ========================================================== */
/*
  Provee persistencia en archivo JSON local cuando Microsoft
  SQL Server no está conectado o en fases de prueba/desarrollo.
  Garantiza que ningún dato de planta se pierda si el servidor
  SQL corporativo experimenta cortes de red o mantenimiento.
*/

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const carpetaDatos = path.resolve(__dirname, '../datos-locales');
const rutaArchivoDB = path.join(carpetaDatos, 'almacenamiento_kira.json');

// Estructura en memoria
let datos = {
  usuarios: {},
  turnos: {},
  tomasCalidad: [],
  paradas: [],
  accionesCorrectivas: [],
  notasTurno: {}
};

/** Asegura que exista el directorio y carga el archivo JSON si existe. */
function inicializarArchivoLocal() {
  try {
    if (!fs.existsSync(carpetaDatos)) {
      fs.mkdirSync(carpetaDatos, { recursive: true });
    }
    if (fs.existsSync(rutaArchivoDB)) {
      const raw = fs.readFileSync(rutaArchivoDB, 'utf-8');
      datos = JSON.parse(raw);
    } else {
      guardarEnDisco();
    }
  } catch (err) {
    console.warn('Aviso al inicializar almacenamiento local:', err.message);
  }
}

/** Guarda los datos actuales en el archivo JSON. */
function guardarEnDisco() {
  try {
    if (!fs.existsSync(carpetaDatos)) {
      fs.mkdirSync(carpetaDatos, { recursive: true });
    }
    fs.writeFileSync(rutaArchivoDB, JSON.stringify(datos, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error al guardar almacenamiento local en disco:', err.message);
  }
}

inicializarArchivoLocal();

export const adaptadorLocal = {
  // --- USUARIOS ---
  async obtenerUsuario(nombreUsuario) {
    return datos.usuarios[nombreUsuario] || null;
  },
  async guardarUsuario(nombreUsuario, datosUsuario) {
    datos.usuarios[nombreUsuario] = {
      ...datosUsuario,
      actualizado_en: new Date().toISOString()
    };
    guardarEnDisco();
    return datos.usuarios[nombreUsuario];
  },
  async listarUsuarios() {
    return Object.values(datos.usuarios);
  },

  // --- TURNOS ---
  async obtenerTurno(turnoId) {
    return datos.turnos[turnoId] || null;
  },
  async guardarTurno(turnoId, datosTurno) {
    datos.turnos[turnoId] = {
      id: turnoId,
      ...(datos.turnos[turnoId] || {}),
      ...datosTurno,
      actualizado_en: new Date().toISOString()
    };
    guardarEnDisco();
    return datos.turnos[turnoId];
  },
  async listarTurnos() {
    return Object.values(datos.turnos);
  },

  // --- TOMAS DE CALIDAD ---
  async obtenerTomasTurno(turnoId) {
    return datos.tomasCalidad.filter(t => t.turno_id === turnoId);
  },
  async guardarToma(toma) {
    const idx = datos.tomasCalidad.findIndex(t => t.id === toma.id);
    if (idx >= 0) {
      datos.tomasCalidad[idx] = { ...datos.tomasCalidad[idx], ...toma };
    } else {
      datos.tomasCalidad.push(toma);
    }
    guardarEnDisco();
    return toma;
  },

  // --- PARADAS ---
  async obtenerParadasTurno(turnoId) {
    return datos.paradas.filter(p => p.turno_id === turnoId);
  },
  async guardarParada(parada) {
    const idx = datos.paradas.findIndex(p => p.id === parada.id);
    if (idx >= 0) {
      datos.paradas[idx] = { ...datos.paradas[idx], ...parada };
    } else {
      datos.paradas.push(parada);
    }
    guardarEnDisco();
    return parada;
  },

  // --- NOTAS DE TURNO ---
  async obtenerNotaTurno(turnoId) {
    return datos.notasTurno[turnoId] || null;
  },
  async guardarNotaTurno(turnoId, nota) {
    datos.notasTurno[turnoId] = {
      turno_id: turnoId,
      ...nota,
      actualizado_en: new Date().toISOString()
    };
    guardarEnDisco();
    return datos.notasTurno[turnoId];
  }
};

