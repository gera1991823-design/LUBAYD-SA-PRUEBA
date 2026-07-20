LUBAYD SA - VERSION 19 NOTIFICACIONES MOVILES

OBJETIVO
- Mostrar un boton visible para activar avisos en celular y computadora.
- Mostrar notificacion del sistema al minimizar la aplicacion o cambiar de pestaña.
- Reproducir sonido/vibracion segun la configuracion del telefono.
- Mantener FCM preparado para avisos incluso con la aplicacion cerrada.

CAMBIOS
1. Aviso de activacion debajo de la barra superior.
2. Panel de activacion dentro de Mensajes.
3. Panel de notificaciones en Configuracion.
4. Boton de prueba para confirmar permiso y visualizacion.
5. Las notificaciones locales ya no se desactivan por tener un token FCM.
6. Se elimino silent:true para permitir sonido del sistema.
7. Nueva cache V19 para forzar la actualizacion en el celular.

COMPORTAMIENTO
- Aplicacion en uso: aviso interno, contador y sonido.
- Aplicacion minimizada o en otra pestaña: notificacion del sistema, siempre que el navegador mantenga la pagina activa.
- Aplicacion cerrada: requiere que notifyNewChatMessage este desplegada en Firebase Functions.

INSTALACION
1. Subir todo el contenido de esta carpeta a la raiz del repositorio.
2. Esperar que GitHub Pages finalice en verde.
3. Cerrar la PWA y volver a abrirla.
4. Entrar a Mensajes y pulsar Activar notificaciones.
5. Aceptar el permiso del telefono.
6. Pulsar Probar.

ANDROID
- Ajustes > Aplicaciones > Lubayd o Chrome > Notificaciones > Permitir.
- Bateria > Lubayd o Chrome > Sin restricciones, para mejorar el funcionamiento minimizado.

IPHONE
- iOS 16.4 o posterior.
- Agregar la web a pantalla de inicio.
- Abrir desde el icono instalado.
- Pulsar Activar notificaciones dentro de la app.

IMPORTANTE
El navegador y el sistema operativo controlan el sonido final. En modo silencio o ahorro de bateria puede no sonar.
