/* ========================================================== */
/* GENERAR-ASAKAI.JS — Reporte ASAKAI por rol (imprimible)     */
/* ========================================================== */
/*
  Genera el reporte ASAKAI (A4 landscape, una hoja por línea) que
  se imprime vía window.print(). El contenido depende del ROL:

    - PRODUCCIÓN: KPIs de parada/vacío/quemados, tabla de paradas
      con vacíos, acciones correctivas y observaciones.
    - CALIDAD: KPIs de calidad/tono/rotura, tabla de defectos con
      su acción de producción, tono/m²/rotura/2da por toma y
      observaciones de calidad.

  También controla la impresión simple de la vista (imprimirVista).
*/

import { valor, esc, fmtFecha } from '../nucleo/utilidades.js';
import {
  sesion, lineaPorId, nombreLinea, normalizarEquipoHistorico,
  asegurarObjetivosSesion, asegurarProduccionSesion
} from '../nucleo/estado.js';
import { asegurarNotaTurno } from './notasTurno.js';
import { calcularKpisPlanta } from './vistaDePlanta.js';
import { mostrarAlertaKira } from '../nucleo/alertasKira.js';
import { areaDelRol } from '../nucleo/roles.js';
import { guardarMeta } from '../app.js';

/** Una tarjeta KPI del encabezado del reporte. */
function kpi(label, valor) {
  return `<div class="asakai-kpi"><span>${esc(label)}</span><strong>${esc(valor)}</strong></div>`;
}

/** Encabezado común del reporte (marca + meta). */
function htmlHeader(linea, tituloReporte, prod) {
  const s = sesion();
  return `
    <header class="asakai-header">
      <div class="asakai-brand">
        <div>
          <div class="asakai-brand-name">KIRA</div>
          <div class="asakai-brand-subtitle">Industrial Software Platform</div>
        </div>
      </div>
      <div class="asakai-title">
        <div>${esc(tituloReporte)}</div>
        <small>PLANTA CERÁMICA SAN JUAN</small>
      </div>
      <div class="asakai-meta">
        <div><b>FECHA</b>${esc(fmtFecha(valor('fecha')))}</div>
        <div><b>TURNO</b>${esc(valor('turno'))}</div>
        <div><b>LÍNEA</b>${esc(linea.nombre)}</div>
        <div><b>SUPERVISOR</b>${esc(s.supervisor || 'No asignado')}</div>
        <div><b>PRODUCTO</b>${esc(prod.producto || 'No especificado')}</div>
        <div><b>FORMATO</b>${esc(prod.formato || 'No especificado')}</div>
      </div>
    </header>`;
}

// ==========================================================
// ASAKAI DE PRODUCCIÓN
// ==========================================================
function paginaAsakaiProduccion(linea) {
  const s = sesion();
  asegurarNotaTurno(s);
  asegurarObjetivosSesion(s);
  asegurarProduccionSesion(s);

  const prod = s.productoPorLinea?.[linea.id] || { producto: '', formato: '' };
  const o = s.objetivos?.porLinea?.[linea.id] || {};
  const kpis = calcularKpisPlanta(linea.id);

  // Máquinas con paradas.
  const paradasLinea = s.paradas.filter(x => x.linea === linea.id);
  const equiposConParadas = linea.equipos.filter(e => e.activo !== false)
    .map(eqConfig => ({
      eqConfig,
      regs: paradasLinea.filter(x => x.equipoId ? x.equipoId === eqConfig.id : normalizarEquipoHistorico(x.equipo) === eqConfig.nombre)
    }))
    .filter(x => x.regs.length > 0);

  const filasEquipos = equiposConParadas.map(({ eqConfig, regs }, idx) => {
    const principal = [...regs].sort((a, b) => (Number(b.minutos) || 0) - (Number(a.minutos) || 0))[0];
    const hora = regs.map(x => x.hora).filter(Boolean).slice(-1)[0] || '';
    return `<tr><td>${idx + 1}</td><td class="machine-name">${esc(eqConfig.nombre)}</td><td class="center">${esc(hora)}</td><td class="center strong">${regs.map(x => Number(x.minutos) || 0).join(' + ')}</td><td class="center">${regs.map(x => Number(x.vacio) || 0).join(' + ')}</td><td>${esc(principal.motivo)}</td><td>${esc(principal.obs || '')}</td></tr>`;
  }).join('') || `<tr><td colspan="7" class="empty">No hay máquinas con paradas registradas.</td></tr>`;

  // Acciones correctivas.
  const accionesLinea = s.acciones.filter(x => x.linea === linea.id);
  const filasAcciones = accionesLinea.length
    ? accionesLinea.slice(-10).map((x, i) => `<tr><td class="center">${i + 1}</td><td class="center">${esc(x.hora || '')}</td><td class="strong">${esc(x.equipo || '')}</td><td>${esc(x.detalle || '')}</td><td>${esc(x.responsable || '')}</td></tr>`).join('')
    : `<tr><td colspan="5" class="empty">No hay acciones correctivas registradas.</td></tr>`;

  // Defectos que pasó calidad + la acción que tomó producción, SECCIONADOS
  // por toma (cada toma enviada con defectos = un bloque de filas con su hora).
  const tomasDef = (o.tomasCalidad || [])
    .map((t, i) => ({ t, i }))
    .filter(x => x.t.enviada === true && (x.t.defectos || []).some(d => (d.nombre || '').trim()))
    .sort((a, b) => (a.t.hora || '').localeCompare(b.t.hora || ''));
  let filasDefProd;
  if (!tomasDef.length) {
    filasDefProd = `<tr><td colspan="4" class="empty">Calidad aún no envió defectos.</td></tr>`;
  } else {
    filasDefProd = tomasDef.map((x, idx) => {
      const t = x.t;
      const sep = `<tr><td colspan="4" class="asakai-toma-sep">TOMA ${idx + 1}${t.hora ? ' · ' + esc(t.hora) + ' hs' : ''}</td></tr>`;
      const filas = (t.defectos || []).filter(d => (d.nombre || '').trim()).map(d =>
        `<tr><td class="strong">${esc(d.nombre)}</td><td class="center strong">${d.pct ?? '—'}%</td><td>${esc(d.aclaracion || '')}</td><td>${esc(d.accionProd || 'Sin acción')}</td></tr>`).join('');
      return sep + filas;
    }).join('');
  }

  const notaProd = (s.notaTurno || '').trim() || 'Sin observaciones.';

  return `
  <article class="asakai-sheet">
    ${htmlHeader(linea, 'REPORTE ASAKAI · PRODUCCIÓN', prod)}

    <section class="asakai-kpis">
      ${kpi('MINUTOS DE PARADA', `${kpis.m.parada} min`)}
      ${kpi('VACÍO DE HORNO', `${kpis.m.vacio} min`)}
      ${kpi('MÁQUINA CRÍTICA', kpis.maquinaCritica ? `${kpis.maquinaCritica.equipo} · ${kpis.maquinaCritica.mins} min` : 'Sin datos')}
      ${kpi('m² QUEMADOS', kpis.quemadoVal != null ? `${kpis.quemadoVal.toLocaleString('es-AR')} m²` : '—')}
      ${kpi('CALIDAD GLOBAL', `${kpis.calidadReal.toFixed(1)}%`)}
      ${kpi('CALIDAD PARCIAL', `${kpis.calidadParcial.toFixed(1)}%`)}
    </section>

    <section class="asakai-block asakai-machines">
      <div class="asakai-block-title">ESTADO DE MÁQUINAS · PARADAS · VACÍOS</div>
      <table class="asakai-table">
        <thead><tr><th>#</th><th>Máquina</th><th>Hora</th><th>Parada</th><th>Vacío</th><th>Motivo principal</th><th>Observaciones</th></tr></thead>
        <tbody>${filasEquipos}</tbody>
      </table>
    </section>

    <section class="asakai-main-grid">
      <section class="asakai-block asakai-actions">
        <div class="asakai-block-title action-title">ACCIONES CORRECTIVAS Y MEJORAS</div>
        <table class="asakai-table">
          <thead><tr><th>#</th><th>Hora</th><th>Equipo</th><th>Acción realizada</th><th>Responsable</th></tr></thead>
          <tbody>${filasAcciones}</tbody>
        </table>
      </section>
      <section class="asakai-block asakai-quality">
        <div class="asakai-block-title quality-title">DEFECTOS DE CALIDAD · ACCIÓN DE PRODUCCIÓN</div>
        <table class="asakai-table">
          <thead><tr><th>Defecto</th><th>%</th><th>Aclaración</th><th>Acción de producción</th></tr></thead>
          <tbody>${filasDefProd}</tbody>
        </table>
      </section>
    </section>

    <section class="asakai-bottom-grid">
      <div class="asakai-supervisor">
        <div class="asakai-block-title supervisor-title">OBSERVACIONES DE PRODUCCIÓN</div>
        <div class="asakai-supervisor-note">${esc(notaProd)}</div>
      </div>
    </section>

    <footer class="asakai-footer"><strong>DMBE Systems · 2026</strong></footer>
  </article>`;
}

// ==========================================================
// ASAKAI DE CALIDAD
// ==========================================================
function paginaAsakaiCalidad(linea) {
  const s = sesion();
  asegurarNotaTurno(s);
  asegurarObjetivosSesion(s);
  asegurarProduccionSesion(s);

  const prod = s.productoPorLinea?.[linea.id] || { producto: '', formato: '' };
  const o = s.objetivos?.porLinea?.[linea.id] || {};
  const kpis = calcularKpisPlanta(linea.id);

  // Tomas con datos (enviadas o con contenido).
  const tomas = (o.tomasCalidad || []).filter(t =>
    t.enviada === true || t.hora || t.global != null || (t.defectos || []).some(d => (d.nombre || '').trim()));

  // Tabla de mediciones por toma.
  const filasMed = tomas.length
    ? tomas.map(t => `<tr><td class="center">${esc(t.hora || '—')}</td><td class="center strong">${t.global ?? '—'}</td><td class="center">${t.parcial1 ?? '—'}</td><td class="center">${t.tono ?? '—'}</td><td class="center">${t.m2 ?? '—'}</td><td class="center">${t.vacioHorno ?? '—'}</td><td class="center">${t.segunda ?? '—'}</td><td class="center">${t.rotura ?? '—'}</td></tr>`).join('')
    : `<tr><td colspan="8" class="empty">Sin tomas de calidad registradas.</td></tr>`;

  // Defectos con acción de producción, SECCIONADOS por toma (cada toma con
  // defectos = un bloque separador con su hora, luego sus filas).
  const tomasConDef = tomas
    .map((t, i) => ({ t, i }))
    .filter(x => (x.t.defectos || []).some(d => (d.nombre || '').trim()));
  let htmlDef;
  if (!tomasConDef.length) {
    htmlDef = `<tr><td colspan="4" class="empty">No hay defectos registrados.</td></tr>`;
  } else {
    htmlDef = tomasConDef.map((x, idx) => {
      const t = x.t;
      const sep = `<tr><td colspan="4" class="asakai-toma-sep">TOMA ${idx + 1}${t.hora ? ' · ' + esc(t.hora) + ' hs' : ''}</td></tr>`;
      const filas = (t.defectos || []).filter(d => (d.nombre || '').trim()).map(d =>
        `<tr><td class="strong">${esc(d.nombre)}</td><td class="center strong">${d.pct ?? '—'}%</td><td>${esc(d.aclaracion || '')}</td><td>${esc(d.accionProd || 'Sin acción')}</td></tr>`).join('');
      return sep + filas;
    }).join('');
  }

  // Acumulado de % de 2da (suma de las tomas con dato).
  const segundaAcum = tomas.reduce((a, t) => a + (Number(t.segunda) || 0), 0);

  const notaCal = (o.observacionesCalidad || '').trim() || 'Sin observaciones.';

  return `
  <article class="asakai-sheet">
    ${htmlHeader(linea, 'REPORTE ASAKAI · CALIDAD', prod)}

    <section class="asakai-kpis">
      ${kpi('CALIDAD', `${kpis.calidadReal.toFixed(1)}%`)}
      ${kpi('PARCIAL', `${kpis.calidadParcial.toFixed(1)}%`)}
      ${kpi('2da ACUMULADA', `${segundaAcum.toFixed(2)}%`)}
      ${kpi('TONO', kpis.tonoVal != null ? String(kpis.tonoVal) : '—')}
      ${kpi('m² CLASIFICADOS', kpis.clasifVal != null ? `${kpis.clasifVal.toLocaleString('es-AR')} m²` : '—')}
      ${kpi('ROTURA', kpis.roturaVal != null ? `${kpis.roturaVal}%` : '—')}
      ${kpi('DEFECTO CRÍTICO', kpis.defectoPreponderante ? `${kpis.defectoPreponderante.nombre} · ${kpis.defectoPreponderante.porcentaje}%` : 'Sin defectos')}
      ${kpi('OPERARIO', o.operarioCalidad || '—')}
    </section>

    <section class="asakai-block">
      <div class="asakai-block-title quality-title">MEDICIONES POR TOMA</div>
      <table class="asakai-table">
        <thead><tr><th>Hora</th><th>Global %</th><th>Parcial %</th><th>Tono</th><th>M²</th><th>Vacío horno</th><th>2da %</th><th>Rotura %</th></tr></thead>
        <tbody>${filasMed}</tbody>
      </table>
    </section>

    <section class="asakai-block asakai-quality">
      <div class="asakai-block-title quality-title">DEFECTOS · ACCIÓN DE PRODUCCIÓN (por toma)</div>
      <table class="asakai-table">
        <thead><tr><th>Defecto</th><th>%</th><th>Aclaración</th><th>Acción de producción</th></tr></thead>
        <tbody>${htmlDef}</tbody>
      </table>
    </section>

    <section class="asakai-bottom-grid">
      <div class="asakai-supervisor">
        <div class="asakai-block-title supervisor-title">OBSERVACIONES DE CALIDAD</div>
        <div class="asakai-supervisor-note">${esc(notaCal)}</div>
      </div>
    </section>

    <footer class="asakai-footer"><strong>DMBE Systems · 2026</strong></footer>
  </article>`;
}

/** Devuelve el HTML del reporte según el rol. */
function paginaAsakaiUnaHoja(linea) {
  return areaDelRol() === 'calidad' ? paginaAsakaiCalidad(linea) : paginaAsakaiProduccion(linea);
}

// ==========================================================
// GENERACIÓN E IMPRESIÓN
// ==========================================================
function generarAsakai() {
  guardarMeta();
  const lineaSeleccionadaId = valor('lineaVista');
  if (lineaSeleccionadaId === 'TODAS') {
    mostrarAlertaKira('Para generar el reporte ASAKAI seleccione una línea específica en Área monitoreada.', 'Atención', 'error');
    return;
  }
  const lineaSeleccionada = lineaPorId(lineaSeleccionadaId);
  if (!lineaSeleccionada) {
    mostrarAlertaKira('No se encontró la línea seleccionada.', 'Atención', 'error');
    return;
  }

  const contenedorPrint = document.getElementById('printReport');
  if (!contenedorPrint) return;

  const htmlReporte = paginaAsakaiUnaHoja(lineaSeleccionada);
  contenedorPrint.innerHTML = htmlReporte;
  contenedorPrint.style.display = 'block';
  contenedorPrint.style.visibility = 'visible';

  const tituloAnterior = document.title;
  document.title = 'Reporte ASAKAI';
  document.body.classList.add('print-report');

  // Orientación horizontal solo para este reporte (se remueve al terminar).
  const estiloOrientacion = document.createElement('style');
  estiloOrientacion.id = 'kiraOrientacionImpresion';
  estiloOrientacion.textContent = '@page { size: A4 landscape; margin: 0; }';
  document.head.appendChild(estiloOrientacion);

  const finalizarImpresion = () => {
    document.body.classList.remove('print-report');
    contenedorPrint.style.display = '';
    contenedorPrint.style.visibility = '';
    contenedorPrint.innerHTML = '';
    document.title = tituloAnterior;
    document.getElementById('kiraOrientacionImpresion')?.remove();
  };
  window.addEventListener('afterprint', finalizarImpresion, { once: true });

  requestAnimationFrame(() => { requestAnimationFrame(() => { window.print(); }); });
}

/**
 * Llena la franja de contexto (fecha/turno/supervisor/línea) que solo se ve al
 * imprimir la vista normal (headerOperativo se oculta en impresión).
 */
function renderResumenImpresion() {
  const contenedor = document.getElementById('printResumenContexto');
  if (!contenedor) return;
  const s = sesion();
  const lineaId = valor('lineaVista') || 'TODAS';
  const nombreArea = lineaId === 'TODAS' ? 'Todas las líneas' : nombreLinea(lineaId);
  let producto = '', formato = '';
  if (lineaId !== 'TODAS' && s.productoPorLinea && s.productoPorLinea[lineaId]) {
    producto = s.productoPorLinea[lineaId].producto || 'No especificado';
    formato = s.productoPorLinea[lineaId].formato || 'No especificado';
  }
  contenedor.innerHTML = `
    <div style="display:flex; gap:8mm; flex-wrap:wrap; align-items:baseline;">
      <div><strong>Fecha:</strong> <span>${esc(fmtFecha(valor('fecha')))}</span></div>
      <div><strong>Turno:</strong> <span>${esc(valor('turno'))}</span></div>
      <div><strong>Supervisor:</strong> <span>${esc(s.supervisor || 'No asignado')}</span></div>
      <div><strong>Área:</strong> <span>${esc(nombreArea)}</span></div>
      ${lineaId !== 'TODAS' ? `
        <div><strong>Producto:</strong> <span>${esc(producto)}</span></div>
        <div><strong>Formato:</strong> <span>${esc(formato)}</span></div>
      ` : ''}
    </div>`;
}

function imprimirVista() {
  const printReportContainer = document.getElementById('printReport');
  if (printReportContainer) {
    printReportContainer.style.display = 'none';
    printReportContainer.innerHTML = '';
  }
  document.body.classList.remove('print-report');
  renderResumenImpresion();
  window.print();
}

// ==========================================================
// EXPOSICIÓN A window
// ==========================================================
window.generarAsakai = generarAsakai;
window.imprimirVista = imprimirVista;
