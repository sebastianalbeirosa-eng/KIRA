/* ========================================================== */
/* GESTION-USUARIOS.JS — CRUD de usuarios (solo admin)         */
/* ========================================================== */
/*
  Administración de usuarios para el rol admin. Por ahora los usuarios
  creados se guardan en localStorage bajo 'kira_usuarios' (la misma clave
  que lee login.js). En KIRA 4.0 esto migrará a la tabla users de SQLite
  con contraseñas hasheadas; la interfaz no cambiará, solo el origen.

  Estructura de cada usuario (por username):
    { password, nombre, rol }   rol ∈ calidad | produccion | supervisor | admin

  Los usuarios BASE (admin/calidad/produccion/supervisor) viven en login.js
  y no se pueden editar/borrar desde acá (son la red de seguridad para no
  quedarse sin acceso). Solo se administran los usuarios creados por el admin.
*/

import { esc, valor, abrir, cerrar } from '../nucleo/utilidades.js';
import { PERMISOS } from '../nucleo/roles.js';
import { mostrarAlertaKira, mostrarConfirmacionKira } from '../nucleo/alertasKira.js';

const USUARIOS_STORAGE = 'kira_usuarios';

// Usuarios base (deben coincidir con login.js). No se editan/borran desde acá.
const USUARIOS_BASE = ['admin', 'calidad', 'produccion', 'supervisor'];

/** Lee los usuarios creados por el admin (los guardados en localStorage). */
function usuariosCreados() {
  try { return JSON.parse(localStorage.getItem(USUARIOS_STORAGE)) || {}; } catch { return {}; }
}

/** Persiste los usuarios creados por el admin. */
function guardarUsuariosCreados(obj) {
  localStorage.setItem(USUARIOS_STORAGE, JSON.stringify(obj));
}

/** Nombre legible del rol. */
function etiquetaRol(rol) {
  return PERMISOS[rol]?.etiqueta || rol;
}

/** Dibuja la tabla de usuarios (base + creados). */
export function renderUsuarios() {
  const tbody = document.getElementById('tablaUsuarios');
  if (!tbody) return;

  const creados = usuariosCreados();

  // Filas de los usuarios base (solo lectura: no se editan ni borran).
  const filasBase = USUARIOS_BASE.map(u => {
    // El rol base se deduce del propio username (admin->admin, etc.).
    const rol = u === 'admin' ? 'admin' : u;
    return `
      <tr class="bg-slate-50">
        <td><b>${esc(u)}</b></td>
        <td class="text-slate-500 italic">Usuario del sistema</td>
        <td class="text-center">${esc(etiquetaRol(rol))}</td>
        <td class="text-center"><span class="badge bg-slate-200 text-slate-600">Base</span></td>
        <td class="text-center text-slate-400 text-[11px]">—</td>
      </tr>`;
  }).join('');

  // Filas de los usuarios creados por el admin (editables/borrables).
  const filasCreados = Object.entries(creados).map(([username, u]) => `
      <tr>
        <td><b>${esc(username)}</b></td>
        <td>${esc(u.nombre || '')}</td>
        <td class="text-center">${esc(etiquetaRol(u.rol))}</td>
        <td class="text-center"><span class="badge bg-sky-100 text-sky-700">Creado</span></td>
        <td class="text-center no-print whitespace-nowrap">
          <button class="text-sky-600 font-bold hover:underline mr-3" onclick="abrirEditorUsuario('${esc(username)}')">Editar</button>
          <button class="text-rose-600 font-bold hover:underline" onclick="eliminarUsuario('${esc(username)}')">Eliminar</button>
        </td>
      </tr>`).join('');

  tbody.innerHTML = filasBase + filasCreados;
}

/** Abre el modal para crear un usuario nuevo, o editar uno existente (creado). */
export function abrirEditorUsuario(username = '') {
  const creados = usuariosCreados();
  const editando = username && creados[username];

  document.getElementById('modalUsuarioTitulo').textContent = editando ? 'Editar usuario' : 'Nuevo usuario';
  document.getElementById('editUsuarioOriginal').value = editando ? username : '';

  const inputUser = document.getElementById('uUsername');
  inputUser.value = editando ? username : '';
  inputUser.disabled = !!editando; // el nombre de usuario no se cambia al editar

  document.getElementById('uNombre').value = editando ? (creados[username].nombre || '') : '';
  document.getElementById('uRol').value = editando ? (creados[username].rol || 'calidad') : 'calidad';
  document.getElementById('uPassword').value = '';

  abrir('modalUsuario');
}

/** Guarda (alta o edición) un usuario creado por el admin. */
export function guardarUsuario(event) {
  event.preventDefault();

  const original = document.getElementById('editUsuarioOriginal').value;
  const username = valor('uUsername').trim();
  const nombre = valor('uNombre').trim();
  const rol = valor('uRol');
  const password = document.getElementById('uPassword').value;

  if (!username) {
    mostrarAlertaKira('El nombre de usuario es obligatorio.', 'Usuarios', 'advertencia');
    return false;
  }
  if (!PERMISOS[rol]) {
    mostrarAlertaKira('Rol inválido.', 'Usuarios', 'advertencia');
    return false;
  }

  // No permitir pisar un usuario base con uno creado.
  if (!original && USUARIOS_BASE.includes(username)) {
    mostrarAlertaKira(`"${username}" es un usuario del sistema y no puede duplicarse.`, 'Usuarios', 'advertencia');
    return false;
  }

  const creados = usuariosCreados();

  // Alta nueva: no permitir username repetido.
  if (!original && creados[username]) {
    mostrarAlertaKira(`Ya existe un usuario "${username}".`, 'Usuarios', 'advertencia');
    return false;
  }

  // En alta, la contraseña es obligatoria. En edición, vacía = mantener la actual.
  if (!original && !password) {
    mostrarAlertaKira('La contraseña es obligatoria para un usuario nuevo.', 'Usuarios', 'advertencia');
    return false;
  }

  const passwordFinal = password || (original ? creados[original].password : '');

  creados[username] = { password: passwordFinal, nombre, rol };
  guardarUsuariosCreados(creados);

  cerrar('modalUsuario');
  renderUsuarios();
  mostrarAlertaKira(`Usuario "${username}" guardado correctamente.`, 'Usuarios', 'exito');
  return false;
}

/** Elimina un usuario creado por el admin (con confirmación). */
export function eliminarUsuario(username) {
  mostrarConfirmacionKira(
    `¿Eliminar al usuario "${username}"? No podrá volver a iniciar sesión.`,
    'Eliminar usuario',
    () => {
      const creados = usuariosCreados();
      delete creados[username];
      guardarUsuariosCreados(creados);
      renderUsuarios();
      mostrarAlertaKira(`Usuario "${username}" eliminado.`, 'Usuarios', 'exito');
    },
    'Eliminar'
  );
}

// ==========================================================
// EXPOSICIÓN A window (se llaman desde onclick del HTML)
// ==========================================================
window.abrirEditorUsuario = abrirEditorUsuario;
window.guardarUsuario = guardarUsuario;
window.eliminarUsuario = eliminarUsuario;
