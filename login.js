// ============================================
// SISTEMA DE AUTENTICACIÓN KIRA
// ============================================

// Usuarios de ejemplo (en producción esto debería estar en un servidor)
const USUARIOS = {
  'admin': { password: 'admin123', nombre: 'Administrador', rol: 'admin' },
  'supervisor': { password: 'super123', nombre: 'Supervisor', rol: 'supervisor' },
  'Marcelo': { password: 'Marce123', nombre: 'Marcelo Molina', rol: 'operario' }
};

// Toggle para mostrar/ocultar contraseña
document.getElementById('togglePassword')?.addEventListener('click', function() {
  const passwordInput = document.getElementById('password');
  const eyeIcon = this.querySelector('.eye-icon');
  
  if (passwordInput.type === 'password') {
    passwordInput.type = 'text';
    eyeIcon.innerHTML = `
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/>
      <circle cx="12" cy="12" r="3"/>
      <line x1="3" y1="3" x2="21" y2="21" stroke-width="2"/>
    `;
  } else {
    passwordInput.type = 'password';
    eyeIcon.innerHTML = `
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/>
      <circle cx="12" cy="12" r="3"/>
    `;
  }
});

// Función para mostrar mensaje de error
function mostrarError(mensaje) {
  const errorDiv = document.getElementById('errorMessage');
  errorDiv.textContent = mensaje;
  errorDiv.style.display = 'flex';
  
  // Ocultar después de 5 segundos
  setTimeout(() => {
    errorDiv.style.display = 'none';
  }, 5000);
}

// Función para validar credenciales
function validarCredenciales(username, password) {
  const usuario = USUARIOS[username];
  
  if (!usuario) {
    return { exito: false, mensaje: 'Usuario no encontrado' };
  }
  
  if (usuario.password !== password) {
    return { exito: false, mensaje: 'Contraseña incorrecta' };
  }
  
  return { exito: true, usuario: { username, ...usuario } };
}

// Función para guardar sesión
function guardarSesion(usuario, recordar) {
  const sesion = {
    usuario: usuario.username,
    nombre: usuario.nombre,
    rol: usuario.rol,
    timestamp: Date.now()
  };
  
  // Guardar en sessionStorage (se borra al cerrar el navegador)
  sessionStorage.setItem('kiraSession', JSON.stringify(sesion));
  
  // Si marcó "Recordarme", también guardar en localStorage
  if (recordar) {
    localStorage.setItem('kiraSession', JSON.stringify(sesion));
  }
}

// Manejar envío del formulario
document.getElementById('loginForm')?.addEventListener('submit', function(e) {
  e.preventDefault();
  
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const rememberMe = document.getElementById('rememberMe').checked;
  
  // Validar campos vacíos
  if (!username || !password) {
    mostrarError('Por favor, completá todos los campos');
    return;
  }
  
  // Validar credenciales
  const resultado = validarCredenciales(username, password);
  
  if (!resultado.exito) {
    mostrarError(resultado.mensaje);
    return;
  }
  
  // Guardar sesión
  guardarSesion(resultado.usuario, rememberMe);
  
  // Redirigir a la aplicación principal
  window.location.href = 'index.html';
});

// Verificar si ya hay una sesión activa al cargar la página
window.addEventListener('DOMContentLoaded', function() {
  const sesion = sessionStorage.getItem('kiraSession') || localStorage.getItem('kiraSession');
  
  if (sesion) {
    try {
      const datos = JSON.parse(sesion);
      // Verificar que la sesión no tenga más de 24 horas
      const horasPasadas = (Date.now() - datos.timestamp) / (1000 * 60 * 60);
      
      if (horasPasadas < 24) {
        // Sesión válida, redirigir a la app
        window.location.href = 'index.html';
      } else {
        // Sesión expirada, limpiar
        sessionStorage.removeItem('kiraSession');
        localStorage.removeItem('kiraSession');
      }
    } catch (e) {
      console.error('Error al verificar sesión:', e);
    }
  }
});

// Manejar link de "Olvidé mi contraseña"
document.querySelector('.forgot-password')?.addEventListener('click', function(e) {
  e.preventDefault();
  alert('Contactá al administrador del sistema para restablecer tu contraseña.\n\nEmail: soporte@kira.com\nTeléfono: +54 11 1234-5678');
});

// Manejar botón de cuenta corporativa
document.querySelector('.btn-corporate')?.addEventListener('click', function() {
  alert('La autenticación corporativa estará disponible próximamente.\n\nSi necesitás acceso con cuenta corporativa, contactá al administrador del sistema.');
});
