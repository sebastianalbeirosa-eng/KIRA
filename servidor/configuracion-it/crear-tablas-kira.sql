-- =============================================================================
-- SCRIPT DE CREACIÓN DE BASE DE DATOS Y TABLAS PARA KIRA EN MICROSOFT SQL SERVER
-- =============================================================================
-- Este script crea la base de datos KIRA_PLANTA (si no existe) y define todas
-- las tablas relacionales con tipos de datos, índices optimizados y restricciones.
-- =============================================================================

USE master;
GO

-- 1. Crear Base de Datos si no existe
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'KIRA_PLANTA')
BEGIN
    CREATE DATABASE [KIRA_PLANTA] COLLATE Modern_Spanish_CI_AS;
    PRINT 'Base de datos KIRA_PLANTA creada exitosamente.';
END
ELSE
BEGIN
    PRINT 'La base de datos KIRA_PLANTA ya existe.';
END
GO

USE [KIRA_PLANTA];
GO

-- =============================================================================
-- TABLA: Usuarios (Gestión de usuarios y contraseñas encriptadas)
-- =============================================================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Usuarios]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[Usuarios] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [usuario] NVARCHAR(50) NOT NULL UNIQUE,
        [password_hash] NVARCHAR(255) NOT NULL,
        [password_salt] NVARCHAR(255) NOT NULL,
        [nombre] NVARCHAR(100) NOT NULL,
        [rol] NVARCHAR(30) NOT NULL, -- 'admin', 'calidad', 'produccion', 'supervisor'
        [activo] BIT NOT NULL DEFAULT 1,
        [fecha_creacion] DATETIME NOT NULL DEFAULT GETDATE(),
        [fecha_actualizacion] DATETIME NOT NULL DEFAULT GETDATE()
    );
    CREATE INDEX [idx_usuarios_usuario] ON [dbo].[Usuarios]([usuario]);
    PRINT 'Tabla Usuarios creada.';
END
GO

-- =============================================================================
-- TABLA: Turnos (Sesiones operativas por fecha y turno)
-- =============================================================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Turnos]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[Turnos] (
        [id] NVARCHAR(50) PRIMARY KEY, -- Clave compuesta 'YYYY-MM-DD|Turno'
        [fecha] DATE NOT NULL,
        [turno] NVARCHAR(20) NOT NULL,  -- 'Mañana', 'Tarde', 'Noche'
        [producto_vigente] NVARCHAR(100) NULL,
        [formato_vigente] NVARCHAR(50) NULL,
        [ciclo_vigente] DECIMAL(6,2) NULL,
        [abierto] BIT NOT NULL DEFAULT 1,
        [creado_en] DATETIME NOT NULL DEFAULT GETDATE(),
        [actualizado_en] DATETIME NOT NULL DEFAULT GETDATE()
    );
    CREATE INDEX [idx_turnos_fecha] ON [dbo].[Turnos]([fecha], [turno]);
    PRINT 'Tabla Turnos creada.';
END
GO

-- =============================================================================
-- TABLA: TomasCalidad (Registros de calidad hora a hora)
-- =============================================================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[TomasCalidad]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[TomasCalidad] (
        [id] NVARCHAR(100) PRIMARY KEY,
        [turno_id] NVARCHAR(50) NOT NULL FOREIGN KEY REFERENCES [dbo].[Turnos]([id]) ON DELETE CASCADE,
        [linea_id] NVARCHAR(50) NOT NULL,
        [hora] NVARCHAR(5) NOT NULL, -- Formato 'HH:MM'
        [producto] NVARCHAR(100) NULL,
        [formato] NVARCHAR(50) NULL,
        [ciclo] DECIMAL(6,2) NULL,
        [calidad_global] DECIMAL(5,2) NULL,
        [calidad_parcial] DECIMAL(5,2) NULL,
        [rendimiento] DECIMAL(5,2) NULL,
        [creado_por] NVARCHAR(50) NULL,
        [creado_en] DATETIME NOT NULL DEFAULT GETDATE()
    );
    CREATE INDEX [idx_tomas_turno_linea] ON [dbo].[TomasCalidad]([turno_id], [linea_id]);
    PRINT 'Tabla TomasCalidad creada.';
END
GO

-- =============================================================================
-- TABLA: DefectosToma (Desglose de defectos por cada toma)
-- =============================================================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[DefectosToma]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[DefectosToma] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [toma_id] NVARCHAR(100) NOT NULL FOREIGN KEY REFERENCES [dbo].[TomasCalidad]([id]) ON DELETE CASCADE,
        [codigo_defecto] NVARCHAR(20) NULL,
        [nombre_defecto] NVARCHAR(100) NOT NULL,
        [porcentaje] DECIMAL(5,2) NOT NULL,
        [cantidad] INT NULL DEFAULT 0
    );
    CREATE INDEX [idx_defectostoma_toma] ON [dbo].[DefectosToma]([toma_id]);
    PRINT 'Tabla DefectosToma creada.';
END
GO

-- =============================================================================
-- TABLA: Paradas (Registro de tiempos muertos y paradas de máquinas)
-- =============================================================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Paradas]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[Paradas] (
        [id] NVARCHAR(100) PRIMARY KEY,
        [turno_id] NVARCHAR(50) NOT NULL FOREIGN KEY REFERENCES [dbo].[Turnos]([id]) ON DELETE CASCADE,
        [linea_id] NVARCHAR(50) NOT NULL,
        [equipo] NVARCHAR(100) NOT NULL,
        [motivo] NVARCHAR(255) NOT NULL,
        [hora_inicio] NVARCHAR(5) NOT NULL,
        [hora_fin] NVARCHAR(5) NULL,
        [duracion_minutos] INT NOT NULL,
        [estado] NVARCHAR(20) NOT NULL DEFAULT 'Cerrada',
        [accion_inmediata] NVARCHAR(500) NULL,
        [creado_por] NVARCHAR(50) NULL,
        [creado_en] DATETIME NOT NULL DEFAULT GETDATE()
    );
    CREATE INDEX [idx_paradas_turno] ON [dbo].[Paradas]([turno_id], [linea_id]);
    PRINT 'Tabla Paradas creada.';
END
GO

-- =============================================================================
-- TABLA: AccionesCorrectivas (Acciones vinculadas a paradas o de planta)
-- =============================================================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[AccionesCorrectivas]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[AccionesCorrectivas] (
        [id] NVARCHAR(100) PRIMARY KEY,
        [parada_id] NVARCHAR(100) NULL FOREIGN KEY REFERENCES [dbo].[Paradas]([id]) ON DELETE SET NULL,
        [descripcion] NVARCHAR(500) NOT NULL,
        [responsable] NVARCHAR(100) NULL,
        [fecha_limite] DATE NULL,
        [estado] NVARCHAR(30) NOT NULL DEFAULT 'Pendiente', -- 'Pendiente', 'En Curso', 'Completada'
        [creado_en] DATETIME NOT NULL DEFAULT GETDATE()
    );
    PRINT 'Tabla AccionesCorrectivas creada.';
END
GO

-- =============================================================================
-- TABLA: NotasTurno (Resumen y observaciones del turno)
-- =============================================================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[NotasTurno]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[NotasTurno] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [turno_id] NVARCHAR(50) NOT NULL UNIQUE FOREIGN KEY REFERENCES [dbo].[Turnos]([id]) ON DELETE CASCADE,
        [comentario_operativo] NVARCHAR(MAX) NULL,
        [maquina_critica] NVARCHAR(100) NULL,
        [defecto_principal] NVARCHAR(100) NULL,
        [actualizado_en] DATETIME NOT NULL DEFAULT GETDATE()
    );
    PRINT 'Tabla NotasTurno creada.';
END
GO

-- =============================================================================
-- TABLA: ConfiguracionPlanta (Estructura de líneas, equipos y fábrica en JSON)
-- =============================================================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[ConfiguracionPlanta]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[ConfiguracionPlanta] (
        [clave] NVARCHAR(50) PRIMARY KEY,
        [datos_json] NVARCHAR(MAX) NOT NULL,
        [actualizado_en] DATETIME NOT NULL DEFAULT GETDATE()
    );
    PRINT 'Tabla ConfiguracionPlanta creada.';
END
GO

PRINT '==================================================================';
PRINT 'Estructura de Base de Datos de KIRA configurada con éxito.';
PRINT '==================================================================';

