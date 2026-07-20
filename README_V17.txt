LUBAYD SA - GESTIÓN FORESTAL V17

NOVEDADES
- El administrador puede modificar la hora de llegada y salida.
- El administrador puede eliminar un registro de asistencia completo.
- Cada modificación o eliminación exige un motivo y crea un registro en asistencia_auditoria.
- Operadores y supervisores no pueden editar ni eliminar horarios.
- El chat muestra avisos de mensajes nuevos con el nombre del remitente.
- Contadores de mensajes sin leer en menú, barra superior y sección Mensajes.
- Sonido breve al recibir un mensaje nuevo.
- Notificación del sistema cuando el usuario activa los avisos desde Mensajes.
- Nueva caché V17 para forzar la actualización de la PWA.

INSTALACIÓN
1. Subir todos los archivos a la raíz del repositorio, incluida la carpeta assets.
2. Reemplazar los archivos existentes.
3. Publicar el contenido de firestore.rules en Firebase > Firestore Database > Reglas.
4. Esperar que GitHub Pages finalice el despliegue.
5. Cerrar y volver a abrir la aplicación.
6. En Mensajes, pulsar "Activar avisos" y aceptar el permiso del navegador.

ASISTENCIA
- Solo role: "admin" puede usar Editar y Eliminar.
- El motivo es obligatorio.
- Las fotos y GPS originales permanecen bloqueados al modificar horarios.
- Al eliminar un registro, también se eliminan sus fotos de asistencia y se conserva una auditoría sin la imagen.

NOTIFICACIONES
- Los avisos, el sonido y los contadores funcionan mientras la página o PWA está abierta, incluso en otra pestaña.
- La notificación del sistema depende del permiso del navegador.
- Para recibir notificaciones con la app completamente cerrada se requiere una integración posterior con Firebase Cloud Messaging y un servicio de envío.
