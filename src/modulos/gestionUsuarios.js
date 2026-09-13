/* ========================================================== */
/* GESTION-USUARIOS.JS — CRUD y contraseñas (solo admin)       */
/* ========================================================== */
/*
  Administración de usuarios para el rol admin. Permite:
  - Visualizar contraseñas (individualmente o todas a la vez).
  - Editar contraseñas, nombres y roles de usuarios creados y de usuarios base.
  - Crear nuevos usuarios.
  - Eliminar usuarios creados o restablecer usuarios base a sus valores por defecto.
  
  Los usuarios y sobreescrituras se persisten en localStorage bajo 'kira_usuarios'
  (la misma clave que lee login.js y bloqueo.js).
*/

import { esc, valor, abrir, cerrar } from '../nucleo/utilidades.js';
import { PERMISOS } from '../nucleo/roles.js';
import { mostrarAlertaKira, mostrarConfirmacionKira } from '../nucleo/alertasKira.js';

export const USUARIOS_STORAGE = 'kira_usuarios';

/** Usuarios precargados del sistema con sus valores por defecto */
export const USUARIOS_BASE = {
  'admin':      { password: 'admin123',   nombre: 'Administrador',       rol: 'admin' },
  'calidad':    { password: 'calidad123', nombre: 'Operario Calidad',    rol: 'calidad' },
  'produccion': { password: 'prod123',    nombre: 'Operario Producción',  rol: 'produccion' },
  'supervisor': { password: 'super123',   nombre: 'Supervisor',          rol: 'supervisor' },
  'Marcelo':    { password: 'Marce123',   nombre: 'Marcelo Molina',      rol: 'produccion' }
};

let mostrandoTodasPasswords = false;

/** Lee los usuarios personalizados/sobreescritos guardados en localStorage. */
export function usuariosGuardados() {
  try { return JSON.parse(localStorage.getItem(USUARIOS_STORAGE)) || {}; } catch { return {}; }
}

/** Persiste el mapa de usuarios personalizados/sobreescritos en localStorage. */
export function guardarUsuariosPersistidos(obj) {
  localStorage.setItem(USUARIOS_STORAGE, JSON.stringify(obj));
}

/**
 * Devuelve un diccionario con TODOS los usuarios activos:
 * primero los base (si no fueron eliminados por el admin),
 * luego los creados adicionales.
 */
export function obtenerTodosLosUsuarios() {
  const guardados = usuariosGuardados();
  const todos = {};

  // 1. Usuarios base (si no están marcados como eliminados por el admin)
  for (const [user, data] of Object.entries(USUARIOS_BASE)) {
    const custom = guardados[user];
    if (custom && custom.eliminado) {
      continue; // Usuario base eliminado por el admin
    }
    todos[user] = {
      ...data,
      ...(custom || {}),
      esBase: true,
      estaModificado: !!custom
    };
  }

  // 2. Usuarios creados que no son base
  for (const [user, data] of Object.entries(guardados)) {
    if (data && data.eliminado) continue;
    if (!todos[user]) {
      todos[user] = {
        ...data,
        esBase: !!USUARIOS_BASE[user],
        estaModificado: false
      };
    }
  }

  return todos;
}

/** Nombre legible del rol. */
function etiquetaRol(rol) {
  return PERMISOS[rol]?.etiqueta || rol;
}

/** Dibuja la tabla de usuarios (base + creados) con contraseñas visibles/ocultas. */
export function renderUsuarios() {
  const tbody = document.getElementById('tablaUsuarios');
  if (!tbody) return;

  const todos = obtenerTodosLosUsuarios();
  
  // Identificar usuario logueado actualmente para no permitir auto-eliminación
  const sesionRaw = sessionStorage.getItem('kiraSession') || localStorage.getItem('kiraSession');
  let usuarioActivo = '';
  try { usuarioActivo = JSON.parse(sesionRaw).usuario; } catch {}

  const filas = Object.entries(todos).map(([username, u]) => {
    const passwordEsc = esc(u.password || '');
    
    // Origen y estado
    let origenBadge = '';
    if (u.esBase) {
      if (u.estaModificado) {
        origenBadge = '<span class="badge bg-amber-100 text-amber-800" title="Usuario base con datos/contraseña modificados">Base modif.</span>';
      } else {
        origenBadge = '<span class="badge bg-slate-200 text-slate-600">Base</span>';
      }
    } else {
      origenBadge = '<span class="badge bg-sky-100 text-sky-700">Creado</span>';
    }

    // Botones de acciones para cualquier usuario
    const esUsuarioActivo = usuarioActivo === username;
    let accionesHtml = `
      <button type="button" class="text-sky-600 font-bold hover:underline mr-2.5" onclick="abrirEditorUsuario('${esc(username)}')">Editar</button>
    `;
    if (esUsuarioActivo) {
      accionesHtml += `<span class="text-slate-400 italic text-[11px]" title="Cuenta actualmente en uso en esta sesión">(En uso)</span>`;
    } else {
      accionesHtml += `
        <button type="button" class="text-rose-600 font-bold hover:underline" onclick="eliminarUsuario('${esc(username)}')">Eliminar</button>
      `;
    }

    return `
      <tr class="${u.esBase ? 'bg-slate-50/60' : ''}">
        <td><b>${esc(username)}</b></td>
        <td>${esc(u.nombre || '')}</td>
        <td class="text-center">${esc(etiquetaRol(u.rol))}</td>
        <td class="text-center">
          <div class="inline-flex items-center justify-center gap-1.5 font-mono px-2 py-0.5 rounded bg-slate-100 border border-slate-200">
            <span class="user-pwd-text text-sky-800 font-bold select-all ${mostrandoTodasPasswords ? '' : 'hidden'}">${passwordEsc}</span>
            <span class="user-pwd-mask text-slate-400 select-none tracking-widest ${mostrandoTodasPasswords ? 'hidden' : ''}">••••••••</span>
            <button type="button" class="btn-toggle-pwd text-slate-400 hover:text-sky-600 focus:outline-none p-0.5" onclick="alternarVerPassword(this)" title="Mostrar/ocultar contraseña">
              <svg class="icon-eye ${mostrandoTodasPasswords ? 'hidden' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13">
                <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>
              </svg>
              <svg class="icon-eye-off ${mostrandoTodasPasswords ? '' : 'hidden'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            </button>
          </div>
        </td>
        <td class="text-center">${origenBadge}</td>
        <td class="text-center no-print whitespace-nowrap">${accionesHtml}</td>
      </tr>
    `;
  }).join('');

  tbody.innerHTML = filas;
}

/** Alterna visibilidad de una contraseña individual en la tabla */
export function alternarVerPassword(btn) {
  const container = btn.closest('div');
  if (!container) return;
  const txt = container.querySelector('.user-pwd-text');
  const mask = container.querySelector('.user-pwd-mask');
  const eye = container.querySelector('.icon-eye');
  const eyeOff = container.querySelector('.icon-eye-off');

  const mostrando = txt.classList.contains('hidden');
  txt.classList.toggle('hidden', !mostrando);
  mask.classList.toggle('hidden', mostrando);
  eye.classList.toggle('hidden', mostrando);
  eyeOff.classList.toggle('hidden', !mostrando);
}

/** Alterna la visibilidad de todas las contraseñas de la tabla a la vez */
export function alternarVerTodasPasswords() {
  mostrandoTodasPasswords = !mostrandoTodasPasswords;
  const btnTxt = document.getElementById('txtToggleAllPasswords');
  if (btnTxt) {
    btnTxt.textContent = mostrandoTodasPasswords ? 'Ocultar contraseñas' : 'Mostrar contraseñas';
  }
  document.querySelectorAll('#tablaUsuarios .user-pwd-text').forEach(el => {
    el.classList.toggle('hidden', !mostrandoTodasPasswords);
  });
  document.querySelectorAll('#tablaUsuarios .user-pwd-mask').forEach(el => {
    el.classList.toggle('hidden', mostrandoTodasPasswords);
  });
  document.querySelectorAll('#tablaUsuarios .icon-eye').forEach(el => {
    el.classList.toggle('hidden', mostrandoTodasPasswords);
  });
  document.querySelectorAll('#tablaUsuarios .icon-eye-off').forEach(el => {
    el.classList.toggle('hidden', !mostrandoTodasPasswords);
  });
}

/** Abre el modal para crear un usuario nuevo o editar uno existente (base o creado). */
export function abrirEditorUsuario(username = '') {
  const todos = obtenerTodosLosUsuarios();
  const editando = username && todos[username];

  document.getElementById('modalUsuarioTitulo').textContent = editando
    ? `Editar usuario: ${username}${todos[username]?.esBase ? ' (Usuario Base)' : ''}`
    : 'Nuevo usuario';
  document.getElementById('editUsuarioOriginal').value = editando ? username : '';

  const inputUser = document.getElementById('uUsername');
  inputUser.value = editando ? username : '';
  inputUser.disabled = !!editando;

  document.getElementById('uNombre').value = editando ? (todos[username].nombre || '') : '';
  
  const selRol = document.getElementById('uRol');
  selRol.value = editando ? (todos[username].rol || 'calidad') : 'calidad';

  // Si editamos al admin, evitamos que cambie su propio rol para no bloquear el panel
  selRol.disabled = editando && username === 'admin';

  // Cargar la contraseña actual para que el admin pueda verla y modificarla
  const inputPass = document.getElementById('uPassword');
  inputPass.type = 'password';
  inputPass.value = editando ? (todos[username].password || '') : '';

  actualizarIconoPasswordModal(false);

  const ayudaPass = document.getElementById('ayudaPasswordModal');
  if (ayudaPass) {
    ayudaPass.textContent = editando
      ? 'Contraseña actual cargada. Podés hacer clic en el ojo para verla o escribir una nueva para cambiarla.'
      : 'Ingresá la contraseña para el nuevo usuario.';
  }

  abrir('modalUsuario');
}

/** Alterna visibilidad de contraseña dentro del modal */
export function alternarPasswordModal() {
  const inputPass = document.getElementById('uPassword');
  if (!inputPass) return;
  const esPassword = inputPass.type === 'password';
  inputPass.type = esPassword ? 'text' : 'password';
  actualizarIconoPasswordModal(esPassword);
}

function actualizarIconoPasswordModal(visible) {
  const icono = document.getElementById('iconoPasswordModal');
  if (!icono) return;
  if (visible) {
    icono.innerHTML = `
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    `;
  } else {
    icono.innerHTML = `
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/>
      <circle cx="12" cy="12" r="3"/>
    `;
  }
}

/** Guarda (alta o edición) un usuario (base o creado) */
export function guardarUsuario(event) {
  event.preventDefault();

  const original = document.getElementById('editUsuarioOriginal').value;
  const username = (original || valor('uUsername')).trim();
  const nombre = valor('uNombre').trim();
  const rol = valor('uRol');
  const password = document.getElementById('uPassword').value.trim();

  if (!username) {
    mostrarAlertaKira('El nombre de usuario es obligatorio.', 'Usuarios', 'advertencia');
    return false;
  }
  if (!nombre) {
    mostrarAlertaKira('El nombre completo es obligatorio.', 'Usuarios', 'advertencia');
    return false;
  }
  if (!PERMISOS[rol]) {
    mostrarAlertaKira('Rol inválido.', 'Usuarios', 'advertencia');
    return false;
  }

  const guardados = usuariosGuardados();
  const todos = obtenerTodosLosUsuarios();

  // Alta nueva: no permitir pisar un usuario ya existente
  if (!original) {
    if (todos[username]) {
      mostrarAlertaKira(`Ya existe el usuario "${username}".`, 'Usuarios', 'advertencia');
      return false;
    }
    if (!password) {
      mostrarAlertaKira('La contraseña es obligatoria para un usuario nuevo.', 'Usuarios', 'advertencia');
      return false;
    }
  }

  // En edición: no permitir contraseña vacía
  const passwordFinal = password || (original && todos[original] ? todos[original].password : '');
  if (!passwordFinal) {
    mostrarAlertaKira('La contraseña no puede quedar vacía.', 'Usuarios', 'advertencia');
    return false;
  }

  // Guardar en el mapa de sobreescrituras/creados
  guardados[username] = {
    password: passwordFinal,
    nombre,
    rol,
    eliminado: false
  };
  guardarUsuariosPersistidos(guardados);

  // Si el usuario editado es la sesión actualmente activa, sincronizar nombre y rol
  const sesionRaw = sessionStorage.getItem('kiraSession') || localStorage.getItem('kiraSession');
  if (sesionRaw) {
    try {
      const sesionObj = JSON.parse(sesionRaw);
      if (sesionObj.usuario === username) {
        sesionObj.nombre = nombre;
        sesionObj.rol = rol;
        if (sessionStorage.getItem('kiraSession')) sessionStorage.setItem('kiraSession', JSON.stringify(sesionObj));
        if (localStorage.getItem('kiraSession')) localStorage.setItem('kiraSession', JSON.stringify(sesionObj));
        if (typeof window.cargarInfoUsuario === 'function') window.cargarInfoUsuario();
      }
    } catch {}
  }

  cerrar('modalUsuario');
  renderUsuarios();
  mostrarAlertaKira(`Usuario "${username}" guardado correctamente.`, 'Usuarios', 'exito');
  return false;
}

/** Restablece todos los usuarios base a su configuración original de fábrica */
export function restablecerTodosLosUsuariosBase() {
  mostrarConfirmacionKira(
    '¿Deseás restablecer los usuarios base del sistema (admin, calidad, produccion, supervisor, Marcelo) a sus contraseñas y valores originales de fábrica? Los usuarios creados manualmente no se perderán.',
    'Restablecer usuarios base',
    () => {
      const guardados = usuariosGuardados();
      for (const user of Object.keys(USUARIOS_BASE)) {
        delete guardados[user];
      }
      guardarUsuariosPersistidos(guardados);
      renderUsuarios();
      mostrarAlertaKira('Usuarios base restablecidos a sus valores por defecto.', 'Usuarios', 'exito');
    },
    'Restablecer'
  );
}

/** Restablece un usuario base específico a su configuración original */
export function restablecerUsuarioBase(username) {
  if (!USUARIOS_BASE[username]) return;

  mostrarConfirmacionKira(
    `¿Restablecer el usuario "${username}" a su contraseña y valores originales de fábrica?`,
    'Restablecer usuario base',
    () => {
      const guardados = usuariosGuardados();
      delete guardados[username];
      guardarUsuariosPersistidos(guardados);
      renderUsuarios();
      mostrarAlertaKira(`Usuario "${username}" restablecido a sus valores por defecto.`, 'Usuarios', 'exito');
    },
    'Restablecer'
  );
}

/** Elimina cualquier usuario (base o creado), excepto el usuario actualmente en sesión */
export function eliminarUsuario(username) {
  const sesionRaw = sessionStorage.getItem('kiraSession') || localStorage.getItem('kiraSession');
  let usuarioActivo = '';
  try { usuarioActivo = JSON.parse(sesionRaw).usuario; } catch {}

  if (username === usuarioActivo) {
    mostrarAlertaKira('No podés eliminar el usuario con el que tenés la sesión activa actualmente.', 'Usuarios', 'advertencia');
    return;
  }

  mostrarConfirmacionKira(
    `¿Eliminar al usuario "${username}"? No podrá volver a iniciar sesión.`,
    'Eliminar usuario',
    () => {
      const guardados = usuariosGuardados();
      if (USUARIOS_BASE[username]) {
        // Para usuario base, se marca como eliminado para que no retorne desde los defaults
        guardados[username] = { eliminado: true };
      } else {
        delete guardados[username];
      }
      guardarUsuariosPersistidos(guardados);
      renderUsuarios();
      mostrarAlertaKira(`Usuario "${username}" eliminado correctamente.`, 'Usuarios', 'exito');
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
window.restablecerUsuarioBase = restablecerUsuarioBase;
window.restablecerTodosLosUsuariosBase = restablecerTodosLosUsuariosBase;
window.alternarVerPassword = alternarVerPassword;
window.alternarVerTodasPasswords = alternarVerTodasPasswords;
window.alternarPasswordModal = alternarPasswordModal;
