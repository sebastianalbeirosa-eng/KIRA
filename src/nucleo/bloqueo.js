// ============================================
// SISTEMA DE BLOQUEO DE SESIÓN
// ============================================

// Usuarios de ejemplo (mismo que en login.js)
const USUARIOS = {
  'admin': { password: 'admin123', nombre: 'Administrador', rol: 'admin' },
  'supervisor': { password: 'super123', nombre: 'Supervisor', rol: 'supervisor' },
  'Marcelo': { password: 'Marce123', nombre: 'Marcelo Molina', rol: 'operario' }
};

// Toggle para mostrar/ocultar contraseña en desbloqueo
document.getElementById('togglePasswordDesbloqueo')?.addEventListener('click', function() {
  const passwordInput = document.getElementById('passwordDesbloqueo');
  const eyeIcon = this.querySelector('.bloqueo-eye-icon');
  
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

// Función para mostrar error de desbloqueo
function mostrarErrorDesbloqueo(mensaje) {
  const errorDiv = document.getElementById('errorDesbloqueo');
  errorDiv.textContent = mensaje;
  errorDiv.style.display = 'block';
  
  // Ocultar después de 5 segundos
  setTimeout(() => {
    errorDiv.style.display = 'none';
  }, 5000);
}

// Manejar formulario de desbloqueo
document.getElementById('formDesbloqueo')?.addEventListener('submit', function(e) {
  e.preventDefault();
  
  const password = document.getElementById('passwordDesbloqueo').value;
  const bloqueo = sessionStorage.getItem('sesionBloqueada');
  
  if (!bloqueo) {
    mostrarErrorDesbloqueo('Error: sesión no encontrada');
    return;
  }
  
  try {
    const datosBloqueo = JSON.parse(bloqueo);
    const usuario = USUARIOS[datosBloqueo.usuario];
    
    if (!usuario) {
      mostrarErrorDesbloqueo('Error: usuario no válido');
      return;
    }
    
    if (usuario.password !== password) {
      mostrarErrorDesbloqueo('Contraseña incorrecta');
      document.getElementById('passwordDesbloqueo').value = '';
      document.getElementById('passwordDesbloqueo').focus();
      return;
    }
    
    // Contraseña correcta, desbloquear
    sessionStorage.removeItem('sesionBloqueada');
    
    // Limpiar intervalo de tiempo
    if (window.intervalTiempoBloqueo) {
      clearInterval(window.intervalTiempoBloqueo);
      window.intervalTiempoBloqueo = null;
    }
    
    // Ocultar pantalla de bloqueo
    document.getElementById('pantallaBloqueo').style.display = 'none';
    document.getElementById('passwordDesbloqueo').value = '';
    
  } catch (e) {
    console.error('Error al desbloquear:', e);
    mostrarErrorDesbloqueo('Error al procesar el desbloqueo');
  }
});

// Verificar si hay una sesión bloqueada al cargar
window.addEventListener('load', function() {
  const bloqueo = sessionStorage.getItem('sesionBloqueada');
  
  if (bloqueo) {
    try {
      const datos = JSON.parse(bloqueo);
      
      // Restaurar estado de bloqueo
      window.tiempoBloqueo = datos.timestamp;
      document.getElementById('pantallaBloqueo').style.display = 'flex';
      document.getElementById('bloqueoUsuarioNombre').textContent = datos.nombre;
      document.getElementById('passwordDesbloqueo').focus();
      
      // Actualizar tiempo
      window.actualizarTiempoBloqueo();
      window.intervalTiempoBloqueo = setInterval(window.actualizarTiempoBloqueo, 60000);
      
    } catch (e) {
      console.error('Error al restaurar sesión bloqueada:', e);
      sessionStorage.removeItem('sesionBloqueada');
    }
  }
});

// Permitir desbloquear con Enter
document.getElementById('passwordDesbloqueo')?.addEventListener('keypress', function(e) {
  if (e.key === 'Enter') {
    document.getElementById('formDesbloqueo')?.requestSubmit();
  }
});
