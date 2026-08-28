/* ========================================================== */
/* EXPORTAR-EXCEL.JS — Informe operativo en libro Excel        */
/* ========================================================== */
/*
  Genera un libro Excel (vía SheetJS/ExcelJS, cargado por CDN
  como variable global `ExcelJS`) con una hoja por turno (Mañana,
  Tarde, Noche), resumen ejecutivo de KPIs por línea, tabla de
  paradas y tabla de acciones correctivas. Los helpers de estilo
  (styleHeaderL, styleDataRowL, etc.) viven ANIDADOS dentro de
  guardarExcel() — así estaban en el código original, se
  mantuvieron igual para no alterar el comportamiento.
*/

import { db, persistir } from '../nucleo/almacenamiento.js';
import { valor, esc, fmtFecha } from '../nucleo/utilidades.js';
import { sesion, lineasActivas, TURNO_MIN } from '../nucleo/estado.js';
import { mostrarAlertaKira } from '../nucleo/alertasKira.js';
import { guardarMeta } from '../app.js';

// Recuerda el handle de archivo entre exportaciones sucesivas del mismo turno
// (File System Access API), para reescribir el mismo archivo en vez de pedir
// "Guardar como" cada vez que se exporta el mismo día.
let archivoHandle = null;
let archivoFecha = null;


async function guardarExcel() {
  guardarMeta(); 
  const fecha = valor('fecha');
  const s = sesion();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'KIRA Plataforma de Análisis de Producción';
  workbook.created = new Date();

  const turnosList = ['Mañana', 'Tarde', 'Noche'];

  turnosList.forEach(tName => {
    const sesTurno = tName === valor('turno') ? s : (db.sesiones[`${fecha}|${tName}`] || { supervisor:'', paradas:[], acciones:[], indicadores:s.indicadores });
    
    const paradasL1 = sesTurno.paradas.filter(x => String(x.linea).includes('1'));
    const paradasL2 = sesTurno.paradas.filter(x => String(x.linea).includes('2'));
    
    const accionesL1 = sesTurno.acciones.filter(x => String(x.linea).includes('1'));
    const accionesL2 = sesTurno.acciones.filter(x => String(x.linea).includes('2'));

    const mL1 = (() => {
      const parada = paradasL1.reduce((a,x) => a + x.minutos, 0);
      const vacio = paradasL1.reduce((a,x) => a + x.vacio, 0);
      return { parada, vacio, disponibilidad: Math.max(0, 100 - parada / (TURNO_MIN/2) * 100) };
    })();

    const mL2 = (() => {
      const parada = paradasL2.reduce((a,x) => a + x.minutos, 0);
      const vacio = paradasL2.reduce((a,x) => a + x.vacio, 0);
      return { parada, vacio, disponibilidad: Math.max(0, 100 - parada / (TURNO_MIN/2) * 100) };
    })();

    const sheet = workbook.addWorksheet(`Turno ${tName}`, {
      views: [{ showGridLines: true }]
    });

    sheet.getColumn('A').width = 4;    
    sheet.getColumn('B').width = 30;  
    sheet.getColumn('C').width = 16;  
    sheet.getColumn('D').width = 18;  
    sheet.getColumn('E').width = 42;  
    sheet.getColumn('F').width = 46;  
    sheet.getColumn('G').width = 12;  
    sheet.getColumn('H').width = 12;

    sheet.addRow([]);
    sheet.addRow([]);

    const titleRow = sheet.addRow(['', 'KIRA', '', 'PLANTA CERÁMICA SAN JUAN', '', '', '', '']);
    sheet.mergeCells(`B3:C3`);
    sheet.mergeCells(`D3:H3`);
    titleRow.getCell(2).font = { name: 'Segoe UI', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    titleRow.getCell(4).font = { name: 'Segoe UI', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
    titleRow.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    titleRow.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    titleRow.getCell(2).alignment = { horizontal: 'left', vertical: 'center', indent: 1 };
    titleRow.getCell(4).alignment = { horizontal: 'center', vertical: 'center' };

    const subTitleRow = sheet.addRow(['', 'Plataforma de Análisis de Producción', '', `INFORME OPERATIVO — TURNO ${tName.toUpperCase()}`, '', '', '', '']);
    sheet.mergeCells(`B4:C4`);
    sheet.mergeCells(`D4:H4`);
    subTitleRow.getCell(2).font = { name: 'Segoe UI', size: 10, italic: true, color: { argb: 'FFDCE8F4' } };
    subTitleRow.getCell(4).font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFDCE8F4' } };
    subTitleRow.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    subTitleRow.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    subTitleRow.getCell(2).alignment = { horizontal: 'left', vertical: 'center', indent: 1 };
    subTitleRow.getCell(4).alignment = { horizontal: 'center', vertical: 'center' };

    const infoRow = sheet.addRow(['', `FECHA OPERATIVA: ${fmtFecha(fecha)}`, '', '', `SUPERVISOR: ${esc(sesTurno.supervisor || 'No asignado')}`, '', '', '']);
    sheet.mergeCells(`B5:D5`);
    sheet.mergeCells(`E5:H5`);
    infoRow.getCell(2).font = { name: 'Segoe UI', size: 10.5, bold: true, color: { argb: 'FF111827' } };
    infoRow.getCell(5).font = { name: 'Segoe UI', size: 10.5, bold: true, color: { argb: 'FF111827' } };
    infoRow.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    infoRow.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    infoRow.getCell(2).alignment = { horizontal: 'left', vertical: 'center', indent: 1 };
    infoRow.getCell(5).alignment = { horizontal: 'left', vertical: 'center', indent: 1 };

    sheet.addRow([]);

    const kpiHead = sheet.addRow(['', 'RESUMEN EJECUTIVO DE KPIs — COMPARATIVA GENERAL']);
    sheet.mergeCells(`B${kpiHead.number}:H${kpiHead.number}`);
    kpiHead.getCell(2).font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FF1E40AF' } };
    kpiHead.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
    kpiHead.getCell(2).alignment = { horizontal: 'center' };

    const lineasKpi = lineasActivas();
    const coloresKpi = ['FF1E3A8A','FF047857','FFB45309','FF6D28D9','FFBE123C','FF0E7490'];

    const metricasPorLineaKpi = lineasKpi.map(l => {
      const paradasL = sesTurno.paradas.filter(x => x.linea === l.id);
      const parada = paradasL.reduce((a,x) => a + x.minutos, 0);
      const vacio = paradasL.reduce((a,x) => a + x.vacio, 0);
      const disponibilidad = Math.max(0, 100 - (parada / TURNO_MIN * 100));
      return { linea: l, parada, vacio, disponibilidad };
    });

    const kpiHeaderRow = sheet.addRow(['', 'Métrica Operativa', ...metricasPorLineaKpi.map(m => m.linea.nombre.toUpperCase())]);
    kpiHeaderRow.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
    kpiHeaderRow.getCell(2).font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    kpiHeaderRow.getCell(2).alignment = { horizontal: 'center', vertical: 'center' };
    metricasPorLineaKpi.forEach((m, idx) => {
      const cell = kpiHeaderRow.getCell(3 + idx);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: coloresKpi[idx % coloresKpi.length] } };
      cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { horizontal: 'center', vertical: 'center' };
    });

    const filasKpi = [
      ['Disponibilidad de Línea (%)', m => `${m.disponibilidad.toFixed(1)}%`],
      ['Tiempo Muerto Total (min)', m => `${m.parada} min`],
      ['Vacíos de Horno Acumulados (min)', m => `${m.vacio} min`]
    ];

    filasKpi.forEach(([etiqueta, fmt]) => {
      const r = sheet.addRow(['', etiqueta, ...metricasPorLineaKpi.map(fmt)]);
      r.getCell(2).font = { bold: true, size: 10 };
      r.getCell(2).alignment = { horizontal: 'left', indent: 1 };
      metricasPorLineaKpi.forEach((m, idx) => {
        const cell = r.getCell(3 + idx);
        cell.font = { bold: true, size: 11, color: { argb: coloresKpi[idx % coloresKpi.length] } };
        cell.alignment = { horizontal: 'center', vertical: 'center' };
      });
      for(let c = 2; c <= 2 + metricasPorLineaKpi.length; c++) {
        r.getCell(c).border = { top: {style:'thin', color:{argb:'D1D5DB'}}, left: {style:'thin', color:{argb:'D1D5DB'}}, bottom: {style:'thin', color:{argb:'D1D5DB'}}, right: {style:'thin', color:{argb:'D1D5DB'}} };
      }
    });

    sheet.addRow([]);
    sheet.addRow([]);

    const prodL1 = sesTurno.productoPorLinea?.L1 || { producto:'', formato:'' };
    const l1Head = sheet.addRow(['', ' DATOS LÍNEA 1 ', '', '', '', `Producto: ${prodL1.producto || 'N/D'}   |   Formato: ${prodL1.formato || 'N/D'}`]);
    sheet.mergeCells(`B${l1Head.number}:D${l1Head.number}`);
    sheet.mergeCells(`E${l1Head.number}:H${l1Head.number}`);
    l1Head.getCell(2).font = { name: 'Segoe UI', size: 12.5, bold: true, color: { argb: 'FFFFFFFF' } };
    l1Head.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    l1Head.getCell(2).alignment = { horizontal: 'left', indent: 1, vertical: 'center' };
    l1Head.getCell(5).font = { name: 'Segoe UI', size: 8.5, italic: true, color: { argb: 'FFDCE8F4' } };
    l1Head.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    l1Head.getCell(5).alignment = { horizontal: 'right', indent: 1, vertical: 'center' };

    const parHead1 = sheet.addRow(['', '1.1 Cuadro de Paradas y Vacíos de Horno — Línea 1']);
    sheet.mergeCells(`B${parHead1.number}:H${parHead1.number}`);
    parHead1.getCell(2).font = { name: 'Segoe UI', size: 10.5, bold: true, color: { argb: 'FF1E40AF' } };

    const tableColsL = ['', 'Máquina / Equipo', 'T. Parada (min)', 'Vacío Horno (min)', 'Motivo / Causa Raíz', 'Observaciones del Operador'];
    const headerRow1 = sheet.addRow(tableColsL);
    sheet.mergeCells(`F${headerRow1.number}:H${headerRow1.number}`);
    styleHeaderL(headerRow1);

    if (paradasL1.length > 0) {
      paradasL1.forEach(x => {
        const row = sheet.addRow(['', x.equipo, x.minutos, x.vacio, x.motivo, x.obs || '']);
        sheet.mergeCells(`F${row.number}:H${row.number}`);
        styleDataRowL(row);
      });
      const tot1 = sheet.addRow(['', 'TOTALES LÍNEA 1', mL1.parada, mL1.vacio, '', '']);
      sheet.mergeCells(`E${tot1.number}:H${tot1.number}`);
      styleTotalRowL(tot1);
    } else {
      const empty1 = sheet.addRow(['', 'Sin paradas registradas para Línea 1.']);
      sheet.mergeCells(`B${empty1.number}:H${empty1.number}`);
    }

    sheet.addRow([]);

    const accHead1 = sheet.addRow(['', '1.2 Cuadro de Acciones Correctivas y Mejoras — Línea 1']);
    sheet.mergeCells(`B${accHead1.number}:H${accHead1.number}`);
    accHead1.getCell(2).font = { name: 'Segoe UI', size: 10.5, bold: true, color: { argb: 'FF92400E' } };

    const accColsL = ['', 'Hora', 'Equipo / Sector', 'Acción Realizada, Responsable y Observaciones'];
    const accHeaderRow1 = sheet.addRow(accColsL);
    sheet.mergeCells(`D${accHeaderRow1.number}:H${accHeaderRow1.number}`);
    styleAccHeaderL(accHeaderRow1);

    if (accionesL1.length > 0) {
      accionesL1.forEach(x => {
        const txt = `${x.detalle}${x.responsable ? ' — Resp: ' + x.responsable : ''}`;
        const row = sheet.addRow(['', x.hora, x.equipo, txt]);
        sheet.mergeCells(`D${row.number}:H${row.number}`);
        styleAccRowL(row);
      });
    } 

    sheet.addRow([]);
    sheet.addRow([]);
    sheet.addRow([]);

    const l2Head = sheet.addRow(['', ' DATOS LÍNEA 2 ']);
    sheet.mergeCells(`B${l2Head.number}:H${l2Head.number}`);
    l2Head.getCell(2).font = { name: 'Segoe UI', size: 12.5, bold: true, color: { argb: 'FFFFFFFF' } };
    l2Head.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF047857' } };
    l2Head.getCell(2).alignment = { horizontal: 'center' };

    const parHead2 = sheet.addRow(['', '2.1 Cuadro de Paradas y Vacíos de Horno — Línea 2']);
    sheet.mergeCells(`B${parHead2.number}:H${parHead2.number}`);
    parHead2.getCell(2).font = { name: 'Segoe UI', size: 10.5, bold: true, color: { argb: 'FF047857' } };

    const headerRow2 = sheet.addRow(tableColsL);
    sheet.mergeCells(`F${headerRow2.number}:H${headerRow2.number}`);
    styleHeaderL(headerRow2, 'FF047857');

    if (paradasL2.length > 0) {
      paradasL2.forEach(x => {
        const row = sheet.addRow(['', x.equipo, x.minutos, x.vacio, x.motivo, x.obs || '']);
        sheet.mergeCells(`F${row.number}:H${row.number}`);
        styleDataRowL(row);
      });
      const tot2 = sheet.addRow(['', 'TOTALES LÍNEA 2', mL2.parada, mL2.vacio, '', '']);
      sheet.mergeCells(`E${tot2.number}:H${tot2.number}`);
      styleTotalRowL(tot2);
    } else {
      const empty2 = sheet.addRow(['', 'Sin paradas registradas para Línea 2.']);
      sheet.mergeCells(`B${empty2.number}:H${empty2.number}`);
    }

    sheet.addRow([]);

    const accHead2 = sheet.addRow(['', '2.2 Cuadro de Acciones Correctivas y Mejoras — Línea 2']);
    sheet.mergeCells(`B${accHead2.number}:H${accHead2.number}`);
    accHead2.getCell(2).font = { name: 'Segoe UI', size: 10.5, bold: true, color: { argb: 'FF92400E' } };

    const accHeaderRow2 = sheet.addRow(accColsL);
    sheet.mergeCells(`D${accHeaderRow2.number}:H${accHeaderRow2.number}`);
    styleAccHeaderL(accHeaderRow2);

    if (accionesL2.length > 0) {
      accionesL2.forEach(x => {
        const txt = `${x.detalle}${x.responsable ? ' — Resp: ' + x.responsable : ''}`;
        const row = sheet.addRow(['', x.hora, x.equipo, txt]);
        sheet.mergeCells(`D${row.number}:H${row.number}`);
        styleAccRowL(row);
      });
    }

    const lineasAdicionales = db.planta.lineas.filter(l => !['L1','L2'].includes(l.id));
    lineasAdicionales.forEach((lineaExtra, extraIdx) => {
      const paradasExtra = sesTurno.paradas.filter(x => x.linea === lineaExtra.id);
      const accionesExtra = sesTurno.acciones.filter(x => x.linea === lineaExtra.id);
     
      sheet.addRow([]);
      sheet.addRow([]);
      const cabeceraExtra = sheet.addRow(['', ` DATOS ${lineaExtra.nombre.toUpperCase()} `]);
      sheet.mergeCells(`B${cabeceraExtra.number}:H${cabeceraExtra.number}`);
      cabeceraExtra.getCell(2).font = { name:'Segoe UI', size:12.5, bold:true, color:{argb:'FFFFFFFF'} };
      cabeceraExtra.getCell(2).fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF334155'} };
      cabeceraExtra.getCell(2).alignment = { horizontal:'center' };

      const parHeadExtra = sheet.addRow(['', `${extraIdx + 3}.1 Cuadro de Paradas y Vacíos de Horno — ${lineaExtra.nombre}`]);
      sheet.mergeCells(`B${parHeadExtra.number}:H${parHeadExtra.number}`);
      parHeadExtra.getCell(2).font = { name:'Segoe UI', size:10.5, bold:true, color:{argb:'FF334155'} };
      const headerExtra = sheet.addRow(tableColsL);
      sheet.mergeCells(`F${headerExtra.number}:H${headerExtra.number}`);
      styleHeaderL(headerExtra, 'FF334155');

      if (paradasExtra.length > 0) {
        paradasExtra.forEach(x => {
          const row = sheet.addRow(['', x.equipo, x.minutos, x.vacio, x.motivo, x.obs || '']);
          sheet.mergeCells(`F${row.number}:H${row.number}`);
          styleDataRowL(row);
        });
        const totalParadaExtra = paradasExtra.reduce((a,x) => a + x.minutos, 0);
        const totalVacioExtra = paradasExtra.reduce((a,x) => a + x.vacio, 0);
        const totalExtra = sheet.addRow(['', `TOTALES ${lineaExtra.nombre.toUpperCase()}`, totalParadaExtra, totalVacioExtra, '', '']);
        sheet.mergeCells(`E${totalExtra.number}:H${totalExtra.number}`);
        styleTotalRowL(totalExtra);
      } else {
        const emptyExtra = sheet.addRow(['', `Sin paradas registradas para ${lineaExtra.nombre}.`]);
        sheet.mergeCells(`B${emptyExtra.number}:H${emptyExtra.number}`);
      }

      sheet.addRow([]);
      const accHeadExtra = sheet.addRow(['', `${extraIdx + 3}.2 Acciones Correctivas y Mejoras — ${lineaExtra.nombre}`]);
      sheet.mergeCells(`B${accHeadExtra.number}:H${accHeadExtra.number}`);
      accHeadExtra.getCell(2).font = { name:'Segoe UI', size:10.5, bold:true, color:{argb:'FF92400E'} };
      const accHeaderExtra = sheet.addRow(accColsL);
      sheet.mergeCells(`D${accHeaderExtra.number}:H${accHeaderExtra.number}`);
      styleAccHeaderL(accHeaderExtra);
      accionesExtra.forEach(x => {
        const txt = `${x.detalle}${x.responsable ? ' — Resp: ' + x.responsable : ''}`;
        const row = sheet.addRow(['', x.hora, x.equipo, txt]);
        sheet.mergeCells(`D${row.number}:H${row.number}`);
        styleAccRowL(row);
      });
    });
  });

  function styleHeaderL(row, colorHex = 'FF1E3A8A') {
    row.eachCell((cell, colNumber) => {
      if(colNumber > 1 && colNumber < 6) {
        cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorHex } };
        cell.alignment = { horizontal: 'center', vertical: 'center' };
        cell.border = { top: {style:'thin', color:{argb:'111827'}}, left: {style:'thin', color:{argb:'111827'}}, bottom: {style:'thin', color:{argb:'111827'}}, right: {style:'thin', color:{argb:'111827'}} };
      }
    });
    [6,7,8].forEach(idx => {
      row.getCell(idx).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorHex } };
      row.getCell(idx).font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      row.getCell(idx).border = { top: {style:'thin', color:{argb:'111827'}}, left: {style:'thin', color:{argb:'111827'}}, bottom: {style:'thin', color:{argb:'111827'}}, right: {style:'thin', color:{argb:'111827'}} };
    });
  }

  function styleDataRowL(row) {
    row.eachCell((cell, colNumber) => {
      if(colNumber > 1 && colNumber < 6) {
        cell.font = { size: 10 };
        cell.border = { top: {style:'thin', color:{argb:'D1D5DB'}}, left: {style:'thin', color:{argb:'D1D5DB'}}, bottom: {style:'thin', color:{argb:'D1D5DB'}}, right: {style:'thin', color:{argb:'D1D5DB'}} };
        if(colNumber === 2) cell.alignment = { horizontal: 'left', indent: 1 };
        if(colNumber === 3 || colNumber === 4) cell.alignment = { horizontal: 'center' };
        if(colNumber === 5) cell.alignment = { horizontal: 'left', indent: 1 };
        if(colNumber === 4) {
          cell.font = { bold: true, size: 10, color: { argb: 'FFB45309' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEB' } };
        }
      }
    });
    [6,7,8].forEach(idx => {
      row.getCell(idx).border = { top: {style:'thin', color:{argb:'D1D5DB'}}, left: {style:'thin', color:{argb:'D1D5DB'}}, bottom: {style:'thin', color:{argb:'D1D5DB'}}, right: {style:'thin', color:{argb:'D1D5DB'}} };
      row.getCell(idx).font = { size: 10 };
      row.getCell(idx).alignment = { horizontal: 'left', indent: 1 };
    });
  }

  function styleTotalRowL(row) {
    row.eachCell((cell, colNumber) => {
      if(colNumber > 1) {
        cell.font = { bold: true, size: 10.5 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
        cell.border = { top: {style:'thin', color:{argb:'9CA3AF'}}, left: {style:'thin', color:{argb:'9CA3AF'}}, bottom: {style:'thin', color:{argb:'9CA3AF'}}, right: {style:'thin', color:{argb:'9CA3AF'}} };
        if(colNumber === 2) cell.alignment = { horizontal: 'left', indent: 1 };
        if(colNumber === 3 || colNumber === 4) cell.alignment = { horizontal: 'center' };
      }
    });
    [5,6,7,8].forEach(idx => {
      row.getCell(idx).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
      row.getCell(idx).border = { top: {style:'thin', color:{argb:'9CA3AF'}}, left: {style:'thin', color:{argb:'9CA3AF'}}, bottom: {style:'thin', color:{argb:'9CA3AF'}}, right: {style:'thin', color:{argb:'9CA3AF'}} };
    });
  }

  function styleAccHeaderL(row) {
    row.eachCell((cell, colNumber) => {
      if(colNumber > 1 && colNumber < 4) {
        cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD97706' } };
        cell.alignment = { horizontal: 'center', vertical: 'center' };
        cell.border = { top: {style:'thin', color:{argb:'111827'}}, left: {style:'thin', color:{argb:'111827'}}, bottom: {style:'thin', color:{argb:'111827'}}, right: {style:'thin', color:{argb:'111827'}} };
      }
    });
    [4,5,6,7,8].forEach(idx => {
      row.getCell(idx).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD97706' } };
      row.getCell(idx).font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      row.getCell(idx).alignment = { horizontal: 'center', vertical: 'center' };
      row.getCell(idx).border = { top: {style:'thin', color:{argb:'111827'}}, left: {style:'thin', color:{argb:'111827'}}, bottom: {style:'thin', color:{argb:'111827'}}, right: {style:'thin', color:{argb:'111827'}} };
    });
  }

  function styleAccRowL(row) {
    row.eachCell((cell, colNumber) => {
      if(colNumber > 1 && colNumber < 4) {
        cell.font = { size: 10 };
        cell.alignment = { horizontal: 'center' };
        cell.border = { top: {style:'thin', color:{argb:'D1D5DB'}}, left: {style:'thin', color:{argb:'D1D5DB'}}, bottom: {style:'thin', color:{argb:'D1D5DB'}}, right: {style:'thin', color:{argb:'D1D5DB'}} };
      }
    });
    [4,5,6,7,8].forEach(idx => {
      row.getCell(idx).font = { size: 10 };
      row.getCell(idx).alignment = { horizontal: 'left', indent: 1 };
      row.getCell(idx).border = { top: {style:'thin', color:{argb:'D1D5DB'}}, left: {style:'thin', color:{argb:'D1D5DB'}}, bottom: {style:'thin', color:{argb:'D1D5DB'}}, right: {style:'thin', color:{argb:'D1D5DB'}} };
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const nombre = `KIRA_Produccion_${fecha}.xlsx`;

  if(window.showSaveFilePicker){
    if(archivoFecha !== fecha) archivoHandle = null;
    if(!archivoHandle) {
      archivoHandle = await showSaveFilePicker({
        suggestedName: nombre,
        types: [{ description: 'Libro de Excel (.xlsx)', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }]
      });
      archivoFecha = fecha;
    }
    const writable = await archivoHandle.createWritable(); 
    await writable.write(blob); 
    await writable.close();
  } else {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  
  mostrarAlertaKira('¡El libro de Excel del turno se ha guardado y estructurado con éxito!', 'Exportación Exitosa', 'exito');
}

// ==========================================================
// EXPOSICIÓN A window
// ----------------------------------------------------------
// guardarExcel: se llama desde onclick="..." en index.html
// (botón "Exportar a Excel").
// ==========================================================
window.guardarExcel = guardarExcel;