/* ========================================================== */
/* GENERAR-ASAKAI.JS — Reporte PDF de reunión ASAKAI           */
/* ========================================================== */
/*
  Genera el reporte ASAKAI (A4, una hoja por línea) que se imprime
  vía window.print(). También controla la impresión simple de la
  vista actual (imprimirVista).

  ✅ BUG CORREGIDO: antes, paginaAsakaiUnaHoja() no recalculaba los
  KPIs industriales (disponibilidad, calidad, EGE, rendimiento) —
  leía el texto ya renderizado en el DOM de #vpKpis, que solo se
  llenaba si el usuario había visitado antes la pestaña "Vista de
  Planta" en esa sesión. Ahora usa calcularKpisPlanta() (una función
  pura, sin DOM, que vive en vistaDePlanta.js) para recalcular los
  mismos números directamente desde los datos de la sesión — así el
  ASAKAI funciona sin importar qué pestaña visitó el usuario antes.
*/

import { valor, esc, fmtFecha } from '../nucleo/utilidades.js';
import {
  sesion, lineaPorId, nombreLinea, normalizarEquipoHistorico,
  asegurarObjetivosSesion, asegurarProduccionSesion
} from '../nucleo/estado.js';
import { asegurarNotaTurno } from './notasTurno.js';
import { asegurarDefectosSesion } from './gestionDefectos.js';
import { metricas, calcularKpisPlanta } from './vistaDePlanta.js';
import { mostrarAlertaKira } from '../nucleo/alertasKira.js';
import { guardarMeta } from '../app.js';

function paginaAsakaiUnaHoja(linea) {
  const s = sesion();

  asegurarNotaTurno(s);
  asegurarDefectosSesion(s);
  asegurarObjetivosSesion(s);
  asegurarProduccionSesion(s);

  // --------------------------------------------------------
  // DATOS DE CONTEXTO
  // --------------------------------------------------------

  const prod = s.productoPorLinea?.[linea.id] || {
    producto: '',
    formato: ''
  };

  const paradasLinea = s.paradas.filter(x => x.linea === linea.id);
  const defectosLinea = s.defectos.filter(x => x.linea === linea.id);
  const accionesLinea = s.acciones.filter(x => x.linea === linea.id);

  // --------------------------------------------------------
  // RECALCULAR LOS KPIs INDUSTRIALES PARA ESTA LÍNEA
  //
  // Usa la misma función pura que usa Vista de Planta en pantalla
  // (calcularKpisPlanta), así los dos lugares SIEMPRE muestran el
  // mismo número — sin depender de que el usuario haya visitado
  // antes esa pestaña.
  // --------------------------------------------------------

  const kpis = calcularKpisPlanta(linea.id);

  const kpiParada = { valor: `${kpis.m.parada} min` };
  const kpiVacio = { valor: `${kpis.m.vacio} min` };
  const kpiCritica = {
    valor: kpis.maquinaCritica
      ? `${kpis.maquinaCritica.mins} min · ${kpis.nivelCritica.label}`
      : 'Sin datos'
  };
  const kpiDefecto = {
    valor: kpis.defectoPreponderante
      ? `${kpis.defectoPreponderante.porcentaje}% · ${kpis.nivelDefecto.label}`
      : 'Sin defectos'
  };
  const kpiDisponibilidad = { valor: `${kpis.disponibilidadEquipos.toFixed(1)}%` };
  const kpiRendimiento = {
    valor: kpis.rendimientoPct === null ? 'N/D' : kpis.rendimientoPct.toFixed(1) + '%'
  };
  const kpiCalidad = { valor: `${kpis.calidadReal.toFixed(1)}%` };
  const kpiEge = { valor: `${kpis.egeTurno.toFixed(1)}%` };

  // --------------------------------------------------------
  // MÁQUINAS
  //
  // Esto NO calcula indicadores.
  // Solo prepara los registros existentes para mostrarlos.
  // --------------------------------------------------------

  // --------------------------------------------------------
  // MÁQUINAS
  //
  // Solo se listan las que tuvieron al menos un registro de
  // parada (con o sin minutos de vacío). No calcula indicadores.
  // --------------------------------------------------------

  const equiposActivos = linea.equipos.filter(
    e => e.activo !== false
  );

  const equiposConParadas = equiposActivos
    .map(eqConfig => {
      const regs = paradasLinea.filter(x =>
        x.equipoId
          ? x.equipoId === eqConfig.id
          : normalizarEquipoHistorico(x.equipo) === eqConfig.nombre
      );
      return { eqConfig, regs };
    })
    .filter(x => x.regs.length > 0);

  const filasEquipos = equiposConParadas.map(({ eqConfig, regs }, idx) => {

    const minutosTexto = regs.map(x => Number(x.minutos) || 0).join(' + ');
    const vaciosTexto = regs.map(x => Number(x.vacio) || 0).join(' + ');

    const principal = [...regs].sort(
      (a, b) => (Number(b.minutos) || 0) - (Number(a.minutos) || 0)
    )[0];

    return `
      <tr>
        <td>${idx + 1}</td>

        <td class="machine-name">
          ${esc(eqConfig.nombre)}
        </td>

        <td class="center strong">
          ${esc(minutosTexto)}
        </td>

        <td class="center">
          ${esc(vaciosTexto)}
        </td>

        <td>
          ${esc(principal.motivo)}
        </td>

        <td>
          ${esc(principal.obs || '')}
        </td>
      </tr>
    `;
  }).join('');

  // --------------------------------------------------------
  // DEFECTOS
  // --------------------------------------------------------

  const filasDefectos = defectosLinea.length
    ? defectosLinea.map((x, i) => `
        <tr>
          <td class="center">${i + 1}</td>

          <td class="strong">
            ${esc(x.nombre)}
          </td>

          <td class="center strong">
            ${esc(x.porcentaje)}%
          </td>

          <td>
            ${esc(x.accion || 'Sin acción correctiva registrada')}
          </td>
        </tr>
      `).join('')
    : `
      <tr>
        <td colspan="4" class="empty">
          No hay defectos registrados.
        </td>
      </tr>
    `;

  // --------------------------------------------------------
  // ACCIONES CORRECTIVAS
  // --------------------------------------------------------

  const filasAcciones = accionesLinea.length
    ? accionesLinea.slice(-8).map((x, i) => `
        <tr>
          <td class="center">${i + 1}</td>

          <td class="center">
            ${esc(x.hora || '')}
          </td>

          <td class="strong">
            ${esc(x.equipo || '')}
          </td>

          <td>
            ${esc(x.detalle || '')}
          </td>

          <td>
            ${esc(x.responsable || '')}
          </td>
        </tr>
      `).join('')
    : `
      <tr>
        <td colspan="5" class="empty">
          No hay acciones correctivas registradas.
        </td>
      </tr>
    `;

  // --------------------------------------------------------
  // NOTA DEL SUPERVISOR
  // --------------------------------------------------------

  const notaSupervisor =
    s.notaTurno ||
    'Sin observaciones manuales.';

  // --------------------------------------------------------
  // NOTA DEL TURNO — análisis automático de la línea
  // (mismo criterio que el panel "Nota del turno" de Vista de Planta)
  // --------------------------------------------------------

  const mLinea = metricas(paradasLinea);
  const objVacioMax = s.objetivos.porLinea[linea.id]?.vacioMax || 30;
  const maquinaTop = [...paradasLinea].sort((a, b) => b.minutos - a.minutos)[0];
  const defectoTop = [...defectosLinea].sort((a, b) => b.porcentaje - a.porcentaje)[0];

  const frasesAuto = [
    maquinaTop
      ? `Afectación destacada en <b>${esc(maquinaTop.equipo)}</b> por "${esc(maquinaTop.motivo)}" (${maquinaTop.minutos} min).`
      : 'Sin paradas relevantes registradas en este turno.',
    ...(mLinea.vacio > objVacioMax ? [`Vacío de horno por encima del objetivo (${mLinea.vacio} min vs ${objVacioMax} min).`] : []),
    ...(defectoTop ? [`Defecto de calidad más relevante: <b>${esc(defectoTop.nombre)}</b> (${defectoTop.porcentaje}%).`] : []),
    mLinea.disponibilidad < 85 ? 'Se recomienda seguimiento y generar plan de acción.' : 'Disponibilidad dentro de objetivo, sin acciones urgentes pendientes.'
  ];

  // --------------------------------------------------------
  // HTML DEL REPORTE
  // --------------------------------------------------------

  return `
  <article class="asakai-sheet">

    <!-- ====================================================
         ENCABEZADO
         ==================================================== -->

   <header class="asakai-header">

      <div class="asakai-brand">
      

        <div>
          <div class="asakai-brand-name">KIRA</div>
          <div class="asakai-brand-subtitle">Industrial Software Platform</div>
        </div>
      </div>

      <div class="asakai-title">
        <div>REPORTE ASAKAI</div>
        <small>PLANTA CERÁMICA SAN JUAN</small>
      </div>

      <!-- Metadatos unificados: fecha, turno, línea, supervisor, producto y formato -->
      <div class="asakai-meta">
        <div><b>FECHA</b>${esc(fmtFecha(valor('fecha')))}</div>
        <div><b>TURNO</b>${esc(valor('turno'))}</div>
        <div><b>LÍNEA</b>${esc(linea.nombre)}</div>
        <div><b>SUPERVISOR</b>${esc(s.supervisor || 'No asignado')}</div>
        <div><b>PRODUCTO</b>${esc(prod.producto || 'No especificado')}</div>
        <div><b>FORMATO</b>${esc(prod.formato || 'No especificado')}</div>
      </div>

    </header>



    <!-- ====================================================
         KPIs — MISMA INFORMACIÓN DE VISTA DE PLANTA
         ==================================================== -->

    <section class="asakai-kpis">

      <div class="asakai-kpi">
        <span>MINUTOS DE PARADA</span>
        <strong>${esc(kpiParada.valor)}</strong>
      </div>

      <div class="asakai-kpi">
        <span>VACÍO DE HORNO</span>
        <strong>${esc(kpiVacio.valor)}</strong>
      </div>

      <div class="asakai-kpi">
        <span>MÁQUINA CRÍTICA</span>
        <strong>${esc(kpiCritica.valor)}</strong>
      </div>

      <div class="asakai-kpi">
        <span>DEFECTO CRÍTICO</span>
        <strong>${esc(kpiDefecto.valor)}</strong>
      </div>

      <div class="asakai-kpi">
        <span>DISPONIBILIDAD</span>
        <strong>${esc(kpiDisponibilidad.valor)}</strong>
      </div>

      <div class="asakai-kpi">
        <span>RENDIMIENTO</span>
        <strong>${esc(kpiRendimiento.valor)}</strong>
      </div>

      <div class="asakai-kpi">
        <span>CALIDAD</span>
        <strong>${esc(kpiCalidad.valor)}</strong>
      </div>

      <div class="asakai-kpi">
        <span>EFICIENCIA / EGE</span>
        <strong>${esc(kpiEge.valor)}</strong>
      </div>

    </section>


    <!-- ====================================================
         CUERPO PRINCIPAL
         ==================================================== -->

    <section class="asakai-main-grid">


      <!-- ================================================
           MÁQUINAS
           ================================================ -->

      <section class="asakai-block asakai-machines">

        <div class="asakai-block-title">
          ESTADO DE MÁQUINAS · PARADAS · VACÍOS
        </div>

        <table class="asakai-table">

          <thead>
            <tr>
              <th>#</th>
              <th>Máquina</th>
              <th>Parada</th>
              <th>Vacío</th>
              <th>Motivo principal</th>
              <th>Observaciones</th>
            </tr>
          </thead>

          <tbody>
            ${
  filasEquipos ||
  `
  <tr>
    <td colspan="6" class="empty">
      No hay máquinas con paradas registradas en este turno.
    </td>
  </tr>
  `
}
          </tbody>

        </table>

      </section>


      <!-- ================================================
           DEFECTOS
           ================================================ -->

      <section class="asakai-block asakai-quality">

        <div class="asakai-block-title quality-title">
          CALIDAD · DEFECTOS · ACCIONES
        </div>

        <table class="asakai-table">

          <thead>
            <tr>
              <th>#</th>
              <th>Defecto</th>
              <th>%</th>
              <th>Acción correctiva</th>
            </tr>
          </thead>

          <tbody>
            ${filasDefectos}
          </tbody>

        </table>

      </section>


    </section>


    <!-- ====================================================
         ACCIONES CORRECTIVAS
         ==================================================== -->

    <section class="asakai-block asakai-actions">

      <div class="asakai-block-title action-title">
        ACCIONES CORRECTIVAS Y MEJORAS
      </div>

      <table class="asakai-table">

        <thead>
          <tr>
            <th>#</th>
            <th>Hora</th>
            <th>Equipo</th>
            <th>Acción realizada</th>
            <th>Responsable</th>
          </tr>
        </thead>

        <tbody>
          ${filasAcciones}
        </tbody>

      </table>

    </section>


    <!-- ====================================================
         AYUDA / ANÁLISIS
         ==================================================== -->

    <section class="asakai-bottom-grid">

      <div class="asakai-analysis">

        <div class="asakai-block-title help-title">
          NOTA DEL TURNO
        </div>

        <div class="asakai-help-content">
          ${frasesAuto.join(' ')}
        </div>

      </div>


      <div class="asakai-supervisor">

        <div class="asakai-block-title supervisor-title">
          OBSERVACIONES DEL SUPERVISOR
        </div>

        <div class="asakai-supervisor-note">
          ${esc(notaSupervisor)}
        </div>

      </div>

    </section>


    <!-- ====================================================
         PIE
         ==================================================== -->

    <footer class="asakai-footer">
      <strong>DMBE Systems · 2026</strong>
    </footer>

  </article>
  `;
}


function generarAsakai() {
  guardarMeta();
  const lineaSeleccionadaId = valor('lineaVista');

  // AQUÍ ESTÁ LA LÍNEA SOLICITADA:
  if (lineaSeleccionadaId === 'TODAS') {
    mostrarAlertaKira('Para generar el reporte ASAKAI seleccione una línea específica en Área monitoreada.', 'Atención', 'error');
    return;
  }
  const lineaSeleccionada = lineaPorId(lineaSeleccionadaId);

  if (!lineaSeleccionada) {
    alert('No se encontró la línea seleccionada.');
    return;
  }

  const contenedorPrint = document.getElementById('printReport');

  if (!contenedorPrint) {
    alert('Error: No se encontró el contenedor printReport en el HTML.');
    return;
  }

  // ========================================================
  // GENERAR HTML DEL REPORTE
  // ========================================================

  const htmlReporte = paginaAsakaiUnaHoja(lineaSeleccionada);

  if (!htmlReporte || !htmlReporte.trim()) {
    alert('Error: paginaAsakaiUnaHoja() no generó contenido.');
    return;
  }

  // ========================================================
  // INSERTAR REPORTE
  // ========================================================

  contenedorPrint.innerHTML = htmlReporte;

  // Forzar visualización del contenedor
  contenedorPrint.style.display = 'block';
  contenedorPrint.style.visibility = 'visible';

  // ========================================================
  // ACTIVAR MODO IMPRESIÓN
  // ========================================================

  const tituloAnterior = document.title;

  document.title = 'Reporte ASAKAI';

  document.body.classList.add('print-report');

  // ========================================================
  // VERIFICACIÓN
  // ========================================================

  const hoja = contenedorPrint.querySelector('.asakai-sheet');

  if (!hoja) {

    console.error(
      'ASAKAI: No se encontró .asakai-sheet dentro de #printReport'
    );

    console.log(
      'HTML generado por paginaAsakaiUnaHoja():',
      htmlReporte
    );

    alert(
      'El reporte fue generado, pero no contiene el elemento .asakai-sheet. Revisaremos paginaAsakaiUnaHoja().'
    );

    document.body.classList.remove('print-report');
    contenedorPrint.innerHTML = '';

    return;
  }

  console.log('ASAKAI: reporte generado correctamente.');
  console.log('ASAKAI: hoja encontrada:', hoja);

  // ========================================================
  // FORZAR ORIENTACIÓN HORIZONTAL SOLO PARA ESTA IMPRESIÓN
  // ========================================================
  // En vez de depender de "páginas @page nombradas" (soporte
  // inconsistente entre versiones de Chrome), inyectamos una
  // regla @page temporal con máxima especificidad posible: al
  // insertarse DESPUÉS de todo el resto del CSS, gana la cascada
  // sin ambigüedad. Se remueve apenas termina de imprimir, así
  // la próxima vez que se use "Imprimir vista actual" (formato
  // vertical) no queda pisada por esta regla.
  const estiloOrientacion = document.createElement('style');
  estiloOrientacion.id = 'kiraOrientacionImpresion';
  estiloOrientacion.textContent = '@page { size: A4 landscape; margin: 0; }';
  document.head.appendChild(estiloOrientacion);

  // ========================================================
  // FINALIZAR IMPRESIÓN
  // ========================================================

  const finalizarImpresion = () => {

    document.body.classList.remove('print-report');

    contenedorPrint.style.display = '';
    contenedorPrint.style.visibility = '';

    contenedorPrint.innerHTML = '';

    document.title = tituloAnterior;

    // Sacamos la regla @page temporal para no afectar futuras
    // impresiones normales (imprimirVista), que deben quedar en vertical.
    document.getElementById('kiraOrientacionImpresion')?.remove();
  };

  window.addEventListener(
    'afterprint',
    finalizarImpresion,
    { once: true }
  );

  // ========================================================
  // IMPRIMIR
  // ========================================================

  requestAnimationFrame(() => {

    requestAnimationFrame(() => {

      window.print();

    });

  });
}

function imprimirVista() {
  // Asegurarnos de limpiar cualquier contenedor de reporte oculto
  const printReportContainer = document.getElementById('printReport');
  if (printReportContainer) {
    printReportContainer.style.display = 'none';
    printReportContainer.innerHTML = '';
  }
  
  // Remover clases de impresión masiva por si hubieran quedado colgadas
  document.body.classList.remove('print-report');

  // Disparar la impresión nativa de la pantalla activa
  window.print();
}

// ==========================================================
// EXPOSICIÓN A window
// ----------------------------------------------------------
// generarAsakai, imprimirVista: se llaman desde onclick="..."
// en index.html (botones "Generar ASAKAI" e "Imprimir").
// ==========================================================
window.generarAsakai = generarAsakai;
window.imprimirVista = imprimirVista;