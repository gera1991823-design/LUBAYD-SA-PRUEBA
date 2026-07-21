# Cambios V20.8.2

- Corrige la sincronización automática de partes al iniciar sesión online.
- Ejecuta la cola de partes junto con la cola de asistencia.
- Reintenta la sincronización después de 1 y 5 segundos.
- Agrega sincronización directa por Firestore cuando inicia sesión el mismo operador.
- Conserva `syncOfflinePart` como respaldo para sesiones por PIN y otros operadores del dispositivo.
- Mantiene modo offline completo, cámara/GPS corregidos, sesión de una hora y botón móvil de cierre de sesión.
