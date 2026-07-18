GESTIÓN FORESTAL LUBAYD SA - V12 CHAT
=====================================

NOVEDADES
---------
- Chat privado en tiempo real entre el usuario principal y cada operador.
- El administrador ve la lista de usuarios y abre una conversación individual.
- Cada operador ve la cuenta de administración y puede responder.
- Contador de mensajes no leídos en computadora y celular.
- Mensajes de texto de hasta 1000 caracteres.
- Los mensajes no pueden editarse ni eliminarse.
- Usuarios nuevos habilitados automáticamente.
- Se mantiene GPS obligatorio e inmutable.
- Se mantiene el filtro del historial por día.

INSTALACIÓN
-----------
1. Sube todos los archivos y la carpeta assets al repositorio de GitHub Pages.
2. Reemplaza los archivos anteriores y realiza Commit changes.
3. En Firebase abre Firestore Database > Reglas.
4. Copia todo el contenido de firestore.rules y presiona Publicar.
5. Cierra y vuelve a abrir la app. Si aparece una actualización, presiona Actualizar.

CONFIGURAR EL USUARIO PRINCIPAL
-------------------------------
El chat necesita una cuenta principal con rol de administrador.

1. Firebase > Firestore Database > Datos > usuarios.
2. Abre el documento correspondiente a la cuenta principal.
3. Cambia el campo role de:
   operador
   a:
   admin
4. Verifica que active sea true.
5. Cierra sesión y vuelve a ingresar en la app.

Los demás usuarios deben conservar:
- role: operador
- active: true

ESTRUCTURA DE FIRESTORE
-----------------------
usuarios/{uid}
partes/{parteId}
chats/{chatId}
chats/{chatId}/mensajes/{mensajeId}

ALCANCE DE ESTA VERSIÓN
-----------------------
Incluye solamente chat de texto dentro de la aplicación.
No incluye fotografías, archivos, audio, grupos ni notificaciones push con la app cerrada.
