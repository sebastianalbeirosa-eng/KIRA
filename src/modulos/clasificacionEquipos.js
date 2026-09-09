/* ========================================================== */
/* CLASIFICACION-EQUIPOS.JS — Catálogo de equipos y motivos   */
/* ========================================================== */
/*
  Maneja los selects dependientes del formulario de paradas
  (línea → equipo → variante → motivo) y el catálogo de motivos
  de parada, que se auto-completa cuando el operador escribe uno nuevo.
*/

import { db, persistir } from '../nucleo/almacenamiento.js';
import { esc } from '../nucleo/utilidades.js';
import { lineaPorId, equipoPorNombre, tipoEquipo, EQUIPOS_INICIALES } from '../nucleo/estado.js';
import { areaDelRol } from '../nucleo/roles.js';

// Catálogo precargado de motivos según tipología de máquina.
// Se combina en tiempo real con los motivos nuevos que van cargando
// los operadores (ver guardarMotivoSiEsNuevo).
export const motivos = {
  Prensa: ['Limpieza de SMU', 'Pérdida de aceite', 'Cambio o ajuste de punzones', 'Ajuste de carga, peso o espesor', 'Cambio de cepillos', 'Falla de volteador', 'Falla eléctrica o sensores', 'Cambio de formato', 'Mantenimiento'],
  Secadero: ['Falla o ajuste de quemadores', 'Traba de piezas', 'Falla de transporte', 'Ajuste de temperatura', 'Espera de material'],
  Esmalte: ['Lavado o limpieza', 'Ajuste de parámetros', 'Esmalte fuera de parámetro', 'Corte de correa', 'Cambio de discos rebabadores', 'Cambio de guías', 'Mantenimiento'],
  Digital: ['Limpieza o purga', 'Ajuste de registro', 'Falla de sensor', 'Falla de comunicación o diseño', 'Mantenimiento'],
  Transporte: ['Atasco o trabamiento', 'Rotura de correa o cadena', 'Falla de motorreductor', 'Falla de sensor', 'Mantenimiento'],
  General: ['Lluvia o humedad', 'Corte de energía', 'Mantenimiento programado', 'Cambio de producto', 'Problemas en horno', 'Problemas en selección', 'Falta de material', 'Otro']
};

/** Carga el select de equipos según la línea elegida, y encadena la actualización de sub-equipo y motivos. */
export function cargarEquipos(linea, equipoSel = '') {
  const lineaConfig = lineaPorId(linea);
  // Solo equipos del área del rol: producción no ve el Qualitron (calidad) y
  // viceversa. Admin/supervisor (area null) ven todos. GENERAL es común.
  const area = areaDelRol();
  const lista = linea === 'GENERAL'
    ? EQUIPOS_INICIALES.GENERAL.map((nombre, i) => ({ id: `GENERAL-E${i + 1}`, nombre, tipo: 'General' }))
    : (lineaConfig?.equipos.filter(e => e.activo !== false && (!area || (e.area || 'produccion') === area)) || []);
  document.getElementById('pEquipo').innerHTML = lista.map(x =>
    `<option value="${esc(x.nombre)}" data-equipo-id="${esc(x.id)}" ${x.nombre === equipoSel ? 'selected' : ''}>${esc(x.nombre)}</option>`
  ).join('');
  actualizarSubEquipoSelect();
  cargarMotivos();
}

/** Muestra el selector de variante (1/2) cuando el equipo elegido es Maxi SIMA o Maxi SITI. */
export function actualizarSubEquipoSelect() {
  const eq = document.getElementById('pEquipo').value;
  const container = document.getElementById('subEquipoContainer');
  const label = document.getElementById('subEquipoLabel');

  if (eq === 'Maxi SIMA') {
    container.classList.remove('hidden');
    label.textContent = 'Variante Maxi SIMA:';
    document.getElementById('pSubEquipo').innerHTML = '<option value="1">Maxi SIMA 1</option><option value="2">Maxi SIMA 2</option>';
  } else if (eq === 'Maxi SITI') {
    container.classList.remove('hidden');
    label.textContent = 'Variante Maxi SITI:';
    document.getElementById('pSubEquipo').innerHTML = '<option value="1">Maxi SITI 1</option><option value="2">Maxi SITI 2</option>';
  } else {
    container.classList.add('hidden');
  }
}

/*
  MOTIVOS DE PARADA
  ----------------------------------------------------------
  El campo permite:
  - Buscar motivos existentes.
  - Escribir un motivo nuevo.
  - Guardar automáticamente el nuevo motivo al registrar la parada.
*/

/** Devuelve la lista combinada de motivos (catálogo base + personalizados) para el equipo actualmente seleccionado. */
export function obtenerMotivosEquipo() {
  const eqBase = document.getElementById('pEquipo').value;
  const lineaId = document.getElementById('pLinea').value;
  const tipo = equipoPorNombre(lineaId, eqBase)?.tipo || tipoEquipo(eqBase);

  // Motivos precargados según tipo de equipo.
  const base = motivos[tipo] || motivos.General;

  // Motivos nuevos almacenados por el usuario.
  const personalizados = db.catalogos?.motivos?.[tipo] || [];

  // Unificar sin duplicados.
  return [...new Set([...base, ...personalizados])];
}

/** Repuebla el datalist de motivos sugeridos para el equipo actual. */
export function cargarMotivos() {
  const input = document.getElementById('pMotivo');
  const lista = document.getElementById('listaMotivosParada');

  if (!input || !lista) return;

  lista.innerHTML = obtenerMotivosEquipo()
    .map(motivo => `<option value="${esc(motivo)}"></option>`)
    .join('');
}

/** Limpia el campo de motivo y recarga las sugerencias al cambiar de máquina. */
export function limpiarYcargarMotivos() {
  const motivoInput = document.getElementById('pMotivo');
  if (motivoInput) motivoInput.value = ''; // Limpia el texto para evitar arrastrar el motivo de otra máquina
  cargarMotivos();                         // Actualiza el datalist con las opciones correspondientes a la nueva máquina
}

/*
  REGISTRO AUTOMÁTICO DE MOTIVOS NUEVOS
  ----------------------------------------------------------
  Si el operador escribe un motivo que no existe, KIRA lo
  incorpora al catálogo correspondiente al tipo de equipo.
*/
export function guardarMotivoSiEsNuevo(motivo) {
  const nombre = String(motivo || '').trim();

  if (!nombre) return;

  const eqBase = document.getElementById('pEquipo').value;
  const lineaId = document.getElementById('pLinea').value;
  const tipo = equipoPorNombre(lineaId, eqBase)?.tipo || tipoEquipo(eqBase);

  // Inicializar estructura persistente de catálogos.
  if (!db.catalogos) db.catalogos = {};
  if (!db.catalogos.motivos) db.catalogos.motivos = {};
  if (!Array.isArray(db.catalogos.motivos[tipo])) {
    db.catalogos.motivos[tipo] = [];
  }

  const motivosExistentes = obtenerMotivosEquipo();

  // Comparación sin distinguir mayúsculas/minúsculas.
  const existe = motivosExistentes.some(
    x => x.trim().toLowerCase() === nombre.toLowerCase()
  );

  if (existe) return;

  db.catalogos.motivos[tipo].push(nombre);
  persistir();
}

// ==========================================================
// EXPOSICIÓN A window
// ----------------------------------------------------------
// Se llaman desde onchange="..." en index.html (selects de línea/equipo).
// ==========================================================
window.actualizarSubEquipoSelect = actualizarSubEquipoSelect;
window.limpiarYcargarMotivos = limpiarYcargarMotivos;