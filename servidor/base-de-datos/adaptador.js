/* ========================================================== */
/* ADAPTADOR.JS — Adaptador Universal de Base de Datos        */
/* ========================================================== */
/*
  Capa de abstracción unificada de datos para KIRA.
  Si hay conexión activa con Microsoft SQL Server, ejecuta
  consultas parametrizadas (protegidas contra SQL Injection).
  Si SQL Server no está disponible, delega en el adaptador local.
*/

import { obtenerPool, estadoConexion } from './conexion.js';
import { adaptadorLocal } from './adaptadorLocal.js';

export const baseDeDatos = {
  /**
   * Estado de la base de datos (SQL Server conectado o modo local)
   */
  obtenerEstado() {
    const estado = estadoConexion();
    return {
      tipo: estado.conectado ? 'Microsoft SQL Server' : 'Almacenamiento Local Resiliente',
      ...estado
    };
  },

  // ==========================================================
  // USUARIOS
  // ==========================================================
  async obtenerUsuario(nombreUsuario) {
    const pool = obtenerPool();
    if (!pool) return adaptadorLocal.obtenerUsuario(nombreUsuario);

    try {
      const mssql = await import('mssql');
      const sql = mssql.default || mssql;
      const res = await pool.request()
        .input('usuario', sql.NVarChar(50), nombreUsuario)
        .query('SELECT usuario, password_hash as hash, password_salt as salt, nombre, rol, activo FROM Usuarios WHERE usuario = @usuario AND activo = 1');
      
      return res.recordset[0] || null;
    } catch (err) {
      console.warn('[SQL Server] Error al consultar usuario, recurriendo a local:', err.message);
      return adaptadorLocal.obtenerUsuario(nombreUsuario);
    }
  },

  async guardarUsuario(nombreUsuario, { hash, salt, nombre, rol }) {
    const pool = obtenerPool();
    if (!pool) return adaptadorLocal.guardarUsuario(nombreUsuario, { hash, salt, nombre, rol });

    try {
      const mssql = await import('mssql');
      const sql = mssql.default || mssql;
      await pool.request()
        .input('usuario', sql.NVarChar(50), nombreUsuario)
        .input('hash', sql.NVarChar(255), hash)
        .input('salt', sql.NVarChar(255), salt)
        .input('nombre', sql.NVarChar(100), nombre)
        .input('rol', sql.NVarChar(30), rol)
        .query(`
          MERGE Usuarios AS target
          USING (SELECT @usuario AS usuario) AS source
          ON (target.usuario = source.usuario)
          WHEN MATCHED THEN
            UPDATE SET password_hash = @hash, password_salt = @salt, nombre = @nombre, rol = @rol, fecha_actualizacion = GETDATE()
          WHEN NOT MATCHED THEN
            INSERT (usuario, password_hash, password_salt, nombre, rol)
            VALUES (@usuario, @hash, @salt, @nombre, @rol);
        `);
      return { usuario: nombreUsuario, nombre, rol };
    } catch (err) {
      console.warn('[SQL Server] Error al guardar usuario en SQL, recurriendo a local:', err.message);
      return adaptadorLocal.guardarUsuario(nombreUsuario, { hash, salt, nombre, rol });
    }
  },

  // ==========================================================
  // TURNOS
  // ==========================================================
  async obtenerTurno(turnoId) {
    const pool = obtenerPool();
    if (!pool) return adaptadorLocal.obtenerTurno(turnoId);

    try {
      const mssql = await import('mssql');
      const sql = mssql.default || mssql;
      const res = await pool.request()
        .input('id', sql.NVarChar(50), turnoId)
        .query('SELECT * FROM Turnos WHERE id = @id');
      
      return res.recordset[0] || null;
    } catch (err) {
      console.warn('[SQL Server] Error al consultar turno, usando local:', err.message);
      return adaptadorLocal.obtenerTurno(turnoId);
    }
  },

  async guardarTurno(turnoId, { fecha, turno, productoVigente, formatoVigente, cicloVigente, abierto = 1 }) {
    const pool = obtenerPool();
    if (!pool) return adaptadorLocal.guardarTurno(turnoId, { fecha, turno, productoVigente, formatoVigente, cicloVigente, abierto });

    try {
      const mssql = await import('mssql');
      const sql = mssql.default || mssql;
      await pool.request()
        .input('id', sql.NVarChar(50), turnoId)
        .input('fecha', sql.Date, fecha || new Date())
        .input('turno', sql.NVarChar(20), turno || '')
        .input('producto', sql.NVarChar(100), productoVigente || null)
        .input('formato', sql.NVarChar(50), formatoVigente || null)
        .input('ciclo', sql.Decimal(6, 2), cicloVigente ? Number(cicloVigente) : null)
        .input('abierto', sql.Bit, abierto ? 1 : 0)
        .query(`
          MERGE Turnos AS target
          USING (SELECT @id AS id) AS source
          ON (target.id = source.id)
          WHEN MATCHED THEN
            UPDATE SET producto_vigente = @producto, formato_vigente = @formato, ciclo_vigente = @ciclo, abierto = @abierto, actualizado_en = GETDATE()
          WHEN NOT MATCHED THEN
            INSERT (id, fecha, turno, producto_vigente, formato_vigente, ciclo_vigente, abierto)
            VALUES (@id, @fecha, @turno, @producto, @formato, @ciclo, @abierto);
        `);
      return { id: turnoId, fecha, turno, productoVigente, formatoVigente, cicloVigente };
    } catch (err) {
      console.warn('[SQL Server] Error al guardar turno, usando local:', err.message);
      return adaptadorLocal.guardarTurno(turnoId, { fecha, turno, productoVigente, formatoVigente, cicloVigente, abierto });
    }
  },

  // ==========================================================
  // TOMAS DE CALIDAD
  // ==========================================================
  async obtenerTomasTurno(turnoId) {
    const pool = obtenerPool();
    if (!pool) return adaptadorLocal.obtenerTomasTurno(turnoId);

    try {
      const mssql = await import('mssql');
      const sql = mssql.default || mssql;
      const resTomas = await pool.request()
        .input('turno_id', sql.NVarChar(50), turnoId)
        .query('SELECT * FROM TomasCalidad WHERE turno_id = @turno_id ORDER BY hora ASC');

      const tomas = resTomas.recordset || [];
      
      // Obtener defectos asociados a cada toma
      for (const t of tomas) {
        const resDef = await pool.request()
          .input('toma_id', sql.NVarChar(100), t.id)
          .query('SELECT nombre_defecto as nombre, porcentaje, cantidad FROM DefectosToma WHERE toma_id = @toma_id');
        t.defectos = resDef.recordset || [];
      }

      return tomas;
    } catch (err) {
      console.warn('[SQL Server] Error al obtener tomas, usando local:', err.message);
      return adaptadorLocal.obtenerTomasTurno(turnoId);
    }
  },

  async guardarToma(toma) {
    const pool = obtenerPool();
    if (!pool) return adaptadorLocal.guardarToma(toma);

    try {
      const mssql = await import('mssql');
      const sql = mssql.default || mssql;

      // 1. Guardar o actualizar registro principal de la toma
      await pool.request()
        .input('id', sql.NVarChar(100), toma.id)
        .input('turno_id', sql.NVarChar(50), toma.turno_id)
        .input('linea_id', sql.NVarChar(50), toma.linea_id || 'linea-1')
        .input('hora', sql.NVarChar(5), toma.hora)
        .input('producto', sql.NVarChar(100), toma.producto || null)
        .input('formato', sql.NVarChar(50), toma.formato || null)
        .input('ciclo', sql.Decimal(6, 2), toma.ciclo ? Number(toma.ciclo) : null)
        .input('calidad_global', sql.Decimal(5, 2), toma.calidad_global != null ? Number(toma.calidad_global) : null)
        .input('calidad_parcial', sql.Decimal(5, 2), toma.calidad_parcial != null ? Number(toma.calidad_parcial) : null)
        .input('rendimiento', sql.Decimal(5, 2), toma.rendimiento != null ? Number(toma.rendimiento) : null)
        .input('creado_por', sql.NVarChar(50), toma.creado_por || 'operario')
        .query(`
          MERGE TomasCalidad AS target
          USING (SELECT @id AS id) AS source
          ON (target.id = source.id)
          WHEN MATCHED THEN
            UPDATE SET hora = @hora, producto = @producto, formato = @formato, ciclo = @ciclo,
                       calidad_global = @calidad_global, calidad_parcial = @calidad_parcial, rendimiento = @rendimiento
          WHEN NOT MATCHED THEN
            INSERT (id, turno_id, linea_id, hora, producto, formato, ciclo, calidad_global, calidad_parcial, rendimiento, creado_por)
            VALUES (@id, @turno_id, @linea_id, @hora, @producto, @formato, @ciclo, @calidad_global, @calidad_parcial, @rendimiento, @creado_por);
        `);

      // 2. Guardar defectos asociados si existen
      if (Array.isArray(toma.defectos) && toma.defectos.length > 0) {
        await pool.request().input('toma_id', sql.NVarChar(100), toma.id).query('DELETE FROM DefectosToma WHERE toma_id = @toma_id');
        for (const d of toma.defectos) {
          await pool.request()
            .input('toma_id', sql.NVarChar(100), toma.id)
            .input('nombre_defecto', sql.NVarChar(100), d.nombre || d.defecto)
            .input('porcentaje', sql.Decimal(5, 2), Number(d.porcentaje || 0))
            .input('cantidad', sql.Int, Number(d.cantidad || 0))
            .query('INSERT INTO DefectosToma (toma_id, nombre_defecto, porcentaje, cantidad) VALUES (@toma_id, @nombre_defecto, @porcentaje, @cantidad)');
        }
      }

      return toma;
    } catch (err) {
      console.warn('[SQL Server] Error al guardar toma en SQL, usando local:', err.message);
      return adaptadorLocal.guardarToma(toma);
    }
  },

  // ==========================================================
  // PARADAS
  // ==========================================================
  async obtenerParadasTurno(turnoId) {
    const pool = obtenerPool();
    if (!pool) return adaptadorLocal.obtenerParadasTurno(turnoId);

    try {
      const mssql = await import('mssql');
      const sql = mssql.default || mssql;
      const res = await pool.request()
        .input('turno_id', sql.NVarChar(50), turnoId)
        .query('SELECT * FROM Paradas WHERE turno_id = @turno_id ORDER BY hora_inicio ASC');
      return res.recordset || [];
    } catch (err) {
      console.warn('[SQL Server] Error al obtener paradas, usando local:', err.message);
      return adaptadorLocal.obtenerParadasTurno(turnoId);
    }
  },

  async guardarParada(parada) {
    const pool = obtenerPool();
    if (!pool) return adaptadorLocal.guardarParada(parada);

    try {
      const mssql = await import('mssql');
      const sql = mssql.default || mssql;
      await pool.request()
        .input('id', sql.NVarChar(100), parada.id)
        .input('turno_id', sql.NVarChar(50), parada.turno_id)
        .input('linea_id', sql.NVarChar(50), parada.linea_id || 'linea-1')
        .input('equipo', sql.NVarChar(100), parada.equipo || 'Equipo General')
        .input('motivo', sql.NVarChar(255), parada.motivo || '')
        .input('hora_inicio', sql.NVarChar(5), parada.hora_inicio)
        .input('hora_fin', sql.NVarChar(5), parada.hora_fin || null)
        .input('duracion_minutos', sql.Int, Number(parada.duracion_minutos) || 0)
        .input('estado', sql.NVarChar(20), parada.estado || 'Cerrada')
        .input('accion_inmediata', sql.NVarChar(500), parada.accion_inmediata || null)
        .input('creado_por', sql.NVarChar(50), parada.creado_por || 'operario')
        .query(`
          MERGE Paradas AS target
          USING (SELECT @id AS id) AS source
          ON (target.id = source.id)
          WHEN MATCHED THEN
            UPDATE SET equipo = @equipo, motivo = @motivo, hora_inicio = @hora_inicio, hora_fin = @hora_fin,
                       duracion_minutos = @duracion_minutos, estado = @estado, accion_inmediata = @accion_inmediata
          WHEN NOT MATCHED THEN
            INSERT (id, turno_id, linea_id, equipo, motivo, hora_inicio, hora_fin, duracion_minutos, estado, accion_inmediata, creado_por)
            VALUES (@id, @turno_id, @linea_id, @equipo, @motivo, @hora_inicio, @hora_fin, @duracion_minutos, @estado, @accion_inmediata, @creado_por);
        `);
      return parada;
    } catch (err) {
      console.warn('[SQL Server] Error al guardar parada, usando local:', err.message);
      return adaptadorLocal.guardarParada(parada);
    }
  },

  // ==========================================================
  // NOTAS DE TURNO
  // ==========================================================
  async obtenerNotaTurno(turnoId) {
    const pool = obtenerPool();
    if (!pool) return adaptadorLocal.obtenerNotaTurno(turnoId);

    try {
      const mssql = await import('mssql');
      const sql = mssql.default || mssql;
      const res = await pool.request()
        .input('turno_id', sql.NVarChar(50), turnoId)
        .query('SELECT comentario_operativo, maquina_critica, defecto_principal FROM NotasTurno WHERE turno_id = @turno_id');
      return res.recordset[0] || null;
    } catch (err) {
      console.warn('[SQL Server] Error al obtener nota de turno, usando local:', err.message);
      return adaptadorLocal.obtenerNotaTurno(turnoId);
    }
  },

  async guardarNotaTurno(turnoId, { comentario, maquinaCritica, defectoPrincipal }) {
    const pool = obtenerPool();
    if (!pool) return adaptadorLocal.guardarNotaTurno(turnoId, { comentario, maquinaCritica, defectoPrincipal });

    try {
      const mssql = await import('mssql');
      const sql = mssql.default || mssql;
      await pool.request()
        .input('turno_id', sql.NVarChar(50), turnoId)
        .input('comentario', sql.NVarChar(sql.MAX), comentario || '')
        .input('maquina', sql.NVarChar(100), maquinaCritica || null)
        .input('defecto', sql.NVarChar(100), defectoPrincipal || null)
        .query(`
          MERGE NotasTurno AS target
          USING (SELECT @turno_id AS turno_id) AS source
          ON (target.turno_id = source.turno_id)
          WHEN MATCHED THEN
            UPDATE SET comentario_operativo = @comentario, maquina_critica = @maquina, defecto_principal = @defecto, actualizado_en = GETDATE()
          WHEN NOT MATCHED THEN
            INSERT (turno_id, comentario_operativo, maquina_critica, defecto_principal)
            VALUES (@turno_id, @comentario, @maquina, @defecto);
        `);
      return { turno_id: turnoId, comentario, maquinaCritica, defectoPrincipal };
    } catch (err) {
      console.warn('[SQL Server] Error al guardar nota de turno, usando local:', err.message);
      return adaptadorLocal.guardarNotaTurno(turnoId, { comentario, maquinaCritica, defectoPrincipal });
    }
  }
};

