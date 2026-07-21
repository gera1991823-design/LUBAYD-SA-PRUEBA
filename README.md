# Lubayd SA V20.8.3 — acceso offline visible

Esta versión corrige la desaparición del bloque **Ingresar sin conexión** en celulares.

## Comportamiento

- La sección offline siempre se muestra en la pantalla inicial.
- Si hay operadores preparados, permite seleccionarlos e ingresar con PIN.
- Si no hay operadores locales, informa que deben prepararse nuevamente desde una sesión de administrador con internet.
- El botón **Actualizar usuarios offline** fuerza una nueva lectura del almacenamiento del teléfono.
- Mantiene asistencia, partes, historial, cámara, GPS, sesión de una hora y sincronización de V20.8.2.

## Actualización

1. Subir todos los archivos del ZIP a la raíz de GitHub.
2. No borrar datos del navegador ni desinstalar la PWA antes de comprobar que los registros pendientes se sincronizaron.
3. Abrir la PWA con internet y usar **Actualizar aplicación** o cerrarla y abrirla nuevamente.
4. Si la lista indica que no hay usuarios preparados, iniciar como administrador y preparar nuevamente cada operador en **Usuarios**.

No es necesario volver a desplegar Functions ni reglas.
