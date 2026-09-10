/* ========================================================== */
/* EXPORTAR-EXCEL.JS — Informe operativo por rol en Excel      */
/* ========================================================== */
/*
  Genera un libro Excel (ExcelJS, global window.ExcelJS) SEGÚN EL
  ROL del usuario:

    - PRODUCCIÓN: paradas + vacíos, acciones correctivas, objetivos
      (vacío/paradas), m² quemados y observaciones. Fotos del turno.
    - CALIDAD: tomas de calidad (global/parcial/tono/m²/vacío/2da/
      rotura), defectos con su acción de producción, roturas por
      defecto, acciones de calidad y observaciones. Fotos.

  En ambos casos el libro tiene 4 pestañas: una por turno
  (Mañana / Tarde / Noche) y una 4ta "Resumen del día" (acumulado
  de los 3 turnos de la fecha).

  admin/supervisor (areaDelRol()===null) reciben el de producción.
*/

import { db, persistir } from '../nucleo/almacenamiento.js';
import { valor, esc, fmtFecha } from '../nucleo/utilidades.js';
import { sesion, lineasActivas, asegurarObjetivosSesion, asegurarProduccionSesion } from '../nucleo/estado.js';
import { mostrarAlertaKira } from '../nucleo/alertasKira.js';
import { areaDelRol } from '../nucleo/roles.js';
import { guardarMeta } from '../app.js';

const TURNOS = ['Mañana', 'Tarde', 'Noche'];

// Recuerda el handle de archivo para reescribir el mismo (File System Access).
let archivoHandle = null;
let archivoFecha = null;

// ----------------------------------------------------------
// Helpers de estilo (ExcelJS)
// ----------------------------------------------------------
// Paleta PASTEL: celeste/azul claro en vez de azul oscuro; tonos suaves.
const AZUL = 'FF7FB8E6';        // celeste pastel (bandas de línea / encabezados)
const CELESTE_SUAVE = 'FFBFDCF0'; // celeste más claro (encabezados de tabla)
const GRIS_OSC = 'FF94A3B8';    // gris/azul pastel (bandas de sección)
const GRIS_CLARO = 'FFEFF6FC';  // fondo muy claro (totales)
const AMBAR_PASTEL = 'FFF6D9A6', VERDE_PASTEL = 'FFB9E4C9', ROSA_PASTEL = 'FFF3C6CE', NARANJA_PASTEL = 'FFF7D3B3';
const TXT_OSC = 'FF334155';     // texto sobre fondos pastel
// Borde marcado para separar bien cada celda.
const borde = (argb = 'FF94A3B8') => ({ top: { style: 'thin', color: { argb } }, left: { style: 'thin', color: { argb } }, bottom: { style: 'thin', color: { argb } }, right: { style: 'thin', color: { argb } } });

function tituloHoja(sheet, titulo, subtitulo) {
  sheet.addRow([]);
  const t = sheet.addRow(['', titulo]);
  sheet.mergeCells(`B${t.number}:H${t.number}`);
  t.getCell(2).font = { name: 'Segoe UI', size: 15, bold: true, color: { argb: TXT_OSC } };
  t.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
  t.getCell(2).alignment = { horizontal: 'left', vertical: 'center', indent: 1 };
  t.height = 22;
  const st = sheet.addRow(['', subtitulo]);
  sheet.mergeCells(`B${st.number}:H${st.number}`);
  st.getCell(2).font = { name: 'Segoe UI', size: 10, italic: true, color: { argb: 'FF64748B' } };
  st.getCell(2).alignment = { horizontal: 'left', indent: 1 };
  sheet.addRow([]);
}

/** Cabecera de sección (banda de color pastel). */
function bandaSeccion(sheet, texto, color = GRIS_OSC) {
  const r = sheet.addRow(['', texto]);
  sheet.mergeCells(`B${r.number}:H${r.number}`);
  r.getCell(2).font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: TXT_OSC } };
  r.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
  r.getCell(2).alignment = { horizontal: 'left', indent: 1 };
  return r;
}

/** Fila de encabezado de tabla, desde la col B, con N títulos. */
function filaEncabezado(sheet, titulos, color = CELESTE_SUAVE) {
  const r = sheet.addRow(['', ...titulos]);
  for (let c = 2; c < 2 + titulos.length; c++) {
    r.getCell(c).font = { bold: true, size: 10, color: { argb: TXT_OSC } };
    r.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
    r.getCell(c).alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
    r.getCell(c).border = borde('FF64748B');
  }
  return r;
}

/** Fila de datos, desde la col B. */
function filaDatos(sheet, valores) {
  const r = sheet.addRow(['', ...valores]);
  for (let c = 2; c < 2 + valores.length; c++) {
    r.getCell(c).font = { size: 10 };
    r.getCell(c).alignment = { horizontal: 'left', vertical: 'top', indent: 1, wrapText: true };
    r.getCell(c).border = borde();
  }
  return r;
}

function anchoColumnas(sheet, anchos) {
  anchos.forEach((w, i) => { sheet.getColumn(i + 1).width = w; });
}

/** Sesión de un turno de la fecha (la actual si coincide, o de db.sesiones). */
function sesionTurno(fecha, turno, sActual) {
  if (turno === valor('turno')) return sActual;
  return db.sesiones[`${fecha}|${turno}`] || null;
}

// ==========================================================
// EXCEL DE PRODUCCIÓN
// ==========================================================
function hojaProduccion(workbook, nombreHoja, subtitulo, sesionesUsadas, fecha) {
  const sheet = workbook.addWorksheet(nombreHoja);
  anchoColumnas(sheet, [4, 26, 12, 12, 14, 34, 30]);
  tituloHoja(sheet, 'KIRA · Informe de Producción', subtitulo);

  // Solo líneas CON datos (paradas o acciones) en las sesiones usadas. Así,
  // si la Línea 2 no tiene registros, no aparece.
  const lineas = lineasActivas().filter(l => sesionesUsadas.some(({ sesion: ses }) =>
    (ses?.paradas || []).some(x => x.linea === l.id) || (ses?.acciones || []).some(x => x.linea === l.id)));

  if (!lineas.length) {
    bandaSeccion(sheet, 'Sin registros de producción en este período.', GRIS_OSC);
    return;
  }

  lineas.forEach(l => {
    bandaSeccion(sheet, `LÍNEA · ${l.nombre.toUpperCase()}`, AZUL);

    // --- Paradas de máquina ---
    bandaSeccion(sheet, 'Paradas de máquina y vacíos de horno', GRIS_OSC);
    filaEncabezado(sheet, ['Equipo', 'Hora', 'T. parada (min)', 'Vacío (min)', 'Motivo', 'Observaciones']);
    let hayParadas = false, totMin = 0, totVac = 0;
    sesionesUsadas.forEach(({ sesion: ses }) => {
      (ses?.paradas || []).filter(x => x.linea === l.id).forEach(x => {
        hayParadas = true; totMin += Number(x.minutos) || 0; totVac += Number(x.vacio) || 0;
        filaDatos(sheet, [x.equipo || '', x.hora || '', Number(x.minutos) || 0, Number(x.vacio) || 0, x.motivo || '', x.obs || '']);
      });
    });
    if (!hayParadas) filaDatos(sheet, ['Sin paradas registradas.', '', '', '', '', '']);
    else {
      const tr = filaDatos(sheet, ['TOTALES', '', totMin, totVac, '', '']);
      tr.eachCell(c => { c.font = { bold: true, size: 10 }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS_CLARO } }; });
    }
    sheet.addRow([]);

    // --- Acciones correctivas ---
    bandaSeccion(sheet, 'Acciones correctivas (sin parada de línea)', AMBAR_PASTEL);
    filaEncabezado(sheet, ['Hora', 'Equipo / Sector', 'Acción realizada', 'Responsable', '', ''], AMBAR_PASTEL);
    let hayAcc = false;
    sesionesUsadas.forEach(({ sesion: ses }) => {
      (ses?.acciones || []).filter(x => x.linea === l.id).forEach(x => {
        hayAcc = true;
        filaDatos(sheet, [x.hora || '', x.equipo || '', x.detalle || '', x.responsable || '', '', '']);
      });
    });
    if (!hayAcc) filaDatos(sheet, ['Sin acciones correctivas.', '', '', '', '', '']);
    sheet.addRow([]);
  });

  // --- Observaciones de producción ---
  bandaSeccion(sheet, 'Observaciones de producción', GRIS_OSC);
  let hayObs = false;
  sesionesUsadas.forEach(({ turno: tn, sesion: ses }) => {
    const obs = (ses?.notaTurno || '').trim();
    if (obs) { hayObs = true; filaDatos(sheet, [`Turno ${tn}`, obs, '', '', '', '']); }
  });
  if (!hayObs) filaDatos(sheet, ['Sin observaciones.', '', '', '', '', '']);
  sheet.addRow([]);
}

// ==========================================================
// EXCEL DE CALIDAD
// ==========================================================
function hojaCalidad(workbook, nombreHoja, subtitulo, sesionesUsadas) {
  const sheet = workbook.addWorksheet(nombreHoja);
  anchoColumnas(sheet, [4, 10, 12, 12, 10, 12, 12, 10]);
  tituloHoja(sheet, 'KIRA · Informe de Calidad', subtitulo);

  // Helper: ¿la línea tiene alguna toma con datos en las sesiones usadas?
  const tomasConDato = o => (o?.tomasCalidad || []).filter(t => t.enviada === true ||
    (t.hora || t.global != null || (t.defectos || []).some(d => (d.nombre || '').trim())));

  // Solo líneas CON tomas de calidad. Si la Línea 2 no tiene datos, no aparece.
  const lineas = lineasActivas().filter(l => sesionesUsadas.some(({ sesion: ses }) => {
    if (!ses) return false;
    asegurarObjetivosSesion(ses);
    return tomasConDato(ses.objetivos?.porLinea?.[l.id]).length > 0;
  }));

  if (!lineas.length) {
    bandaSeccion(sheet, 'Sin registros de calidad en este período.', GRIS_OSC);
    return;
  }

  lineas.forEach(l => {
    bandaSeccion(sheet, `LÍNEA · ${l.nombre.toUpperCase()}`, AZUL);

    sesionesUsadas.forEach(({ turno: tn, sesion: ses }) => {
      if (!ses) return;
      asegurarObjetivosSesion(ses);
      const o = ses.objetivos?.porLinea?.[l.id];
      if (!o) return;
      const tomas = tomasConDato(o);
      if (!tomas.length) return;

      bandaSeccion(sheet, `Turno ${tn} · Operario: ${o.operarioCalidad || '-'}`, GRIS_OSC);

      // Mediciones por toma.
      filaEncabezado(sheet, ['Hora', 'Global %', 'Parcial %', 'Tono', 'M²', 'Vacío horno', '2da %', 'Rotura %']);
      tomas.forEach(t => {
        filaDatos(sheet, [t.hora || '', t.global ?? '', t.parcial1 ?? '', t.tono ?? '', t.m2 ?? '', t.vacioHorno ?? '', t.segunda ?? '', t.rotura ?? '']);
      });
      sheet.addRow([]);

      // Defectos + acción de producción.
      bandaSeccion(sheet, 'Defectos de calidad y acción de producción', ROSA_PASTEL);
      filaEncabezado(sheet, ['Hora', 'Defecto', '%', 'Aclaración', 'Acción de producción', '', ''], ROSA_PASTEL);
      let hayDef = false;
      tomas.forEach(t => (t.defectos || []).filter(d => (d.nombre || '').trim()).forEach(d => {
        hayDef = true;
        filaDatos(sheet, [t.hora || '', d.nombre, d.pct ?? '', d.aclaracion || '', d.accionProd || '', '', '']);
      }));
      if (!hayDef) filaDatos(sheet, ['Sin defectos registrados.', '', '', '', '', '', '']);
      sheet.addRow([]);

      // Rotura por defecto.
      const hayRot = tomas.some(t => (t.roturas || []).some(d => (d.nombre || '').trim()));
      if (hayRot) {
        bandaSeccion(sheet, 'Rotura por defecto', NARANJA_PASTEL);
        filaEncabezado(sheet, ['Hora', 'Defecto a rotura', '%', 'Aclaración', '', '', ''], NARANJA_PASTEL);
        tomas.forEach(t => (t.roturas || []).filter(d => (d.nombre || '').trim()).forEach(d => {
          filaDatos(sheet, [t.hora || '', d.nombre, d.pct ?? '', d.aclaracion || '', '', '', '']);
        }));
        sheet.addRow([]);
      }

      // Acciones de calidad.
      const acciones = tomas.flatMap(t => (t.acciones || []).filter(a => (a || '').trim()).map(a => ({ hora: t.hora, a })));
      if (acciones.length) {
        bandaSeccion(sheet, 'Acciones de calidad', VERDE_PASTEL);
        filaEncabezado(sheet, ['Hora', 'Acción', '', '', '', '', ''], VERDE_PASTEL);
        acciones.forEach(x => filaDatos(sheet, [x.hora || '', x.a, '', '', '', '', '']));
        sheet.addRow([]);
      }

      // Observaciones de calidad.
      if ((o.observacionesCalidad || '').trim()) {
        bandaSeccion(sheet, 'Observaciones de calidad', GRIS_OSC);
        filaDatos(sheet, [`Turno ${tn}`, o.observacionesCalidad.trim(), '', '', '', '', '']);
        sheet.addRow([]);
      }
    });
  });
}

// ==========================================================
// PUNTO DE ENTRADA
// ==========================================================
async function guardarExcel() {
  guardarMeta();
  if (typeof ExcelJS === 'undefined') {
    mostrarAlertaKira('No se pudo cargar la librería de Excel. Verificá la conexión.', 'Exportar a Excel', 'error');
    return;
  }
  const fecha = valor('fecha');
  const s = sesion();
  asegurarObjetivosSesion(s);
  asegurarProduccionSesion(s);

  const area = areaDelRol(); // 'calidad' | 'produccion' | null
  const esCalidad = area === 'calidad';

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'KIRA';
  workbook.created = new Date();

  // Sesiones por turno de la fecha (para las pestañas).
  const porTurno = TURNOS.map(tn => ({ turno: tn, sesion: sesionTurno(fecha, tn, s) }));

  if (esCalidad) {
    TURNOS.forEach(tn => {
      const ses = sesionTurno(fecha, tn, s);
      hojaCalidad(workbook, `Turno ${tn}`, `Calidad · ${fmtFecha(fecha)} · Turno ${tn}`, [{ turno: tn, sesion: ses }]);
    });
    hojaCalidad(workbook, 'Resumen del día', `Calidad · ${fmtFecha(fecha)} · Día completo`, porTurno);
  } else {
    TURNOS.forEach(tn => {
      const ses = sesionTurno(fecha, tn, s);
      hojaProduccion(workbook, `Turno ${tn}`, `Producción · ${fmtFecha(fecha)} · Turno ${tn}`, [{ turno: tn, sesion: ses }], fecha);
    });
    hojaProduccion(workbook, 'Resumen del día', `Producción · ${fmtFecha(fecha)} · Día completo`, porTurno, fecha);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const nombre = `KIRA_${esCalidad ? 'Calidad' : 'Produccion'}_${fecha}.xlsx`;

  if (window.showSaveFilePicker) {
    try {
      if (archivoFecha !== fecha) archivoHandle = null;
      if (!archivoHandle) {
        archivoHandle = await showSaveFilePicker({
          suggestedName: nombre,
          types: [{ description: 'Libro de Excel (.xlsx)', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }]
        });
        archivoFecha = fecha;
      }
      const w = await archivoHandle.createWritable();
      await w.write(blob);
      await w.close();
      mostrarAlertaKira(`Excel de ${esCalidad ? 'calidad' : 'producción'} guardado correctamente.`, 'Exportar a Excel', 'exito');
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return; // el usuario canceló
      // Si falla el picker, cae al método clásico.
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(a.href);
  mostrarAlertaKira(`Excel de ${esCalidad ? 'calidad' : 'producción'} descargado.`, 'Exportar a Excel', 'exito');
}

// ==========================================================
// EXPOSICIÓN A window
// ==========================================================
window.guardarExcel = guardarExcel;
