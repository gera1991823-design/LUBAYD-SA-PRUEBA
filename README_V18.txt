LUBAYD SA - GESTIÓN FORESTAL V18 PUSH
========================================

NOVEDAD PRINCIPAL
-----------------
Esta versión registra cada celular o computadora con Firebase Cloud Messaging y
puede recibir avisos de chat aunque la aplicación esté en segundo plano o cerrada.

CLAVE WEB PUSH INCLUIDA
-----------------------
BD2QB0qlQKnf4ZGV5pyoeAPwMA4Psj9j-tgpKdtb_A1b6bclmw_kUPFSdffyGpfPTXSF630SHbHgjCmirow-Imc

Es una clave pública VAPID. No es una contraseña ni una clave privada.

ARCHIVOS NUEVOS
---------------
- push-notifications.js
- functions/index.js
- functions/package.json
- firebase.json
- .firebaserc

CAMBIOS
-------
- Botón "Activar push" dentro de Mensajes.
- Registro privado del dispositivo en la colección push_tokens.
- Notificación con nombre del remitente y vista previa del mensaje.
- Al tocar el aviso se abre el chat.
- Eliminación del token al cerrar sesión para proteger dispositivos compartidos.
- Limpieza automática de tokens inválidos desde Cloud Functions.
- La PWA usa un único service worker para caché y FCM, evitando conflictos.

IMPORTANTE
----------
El código del frontend puede subirse a GitHub Pages, pero la función que envía
los avisos debe desplegarse en Firebase Cloud Functions. Para desplegar funciones,
el proyecto debe utilizar el plan Blaze.

Lee FIREBASE_V18_PUSH_PASOS.txt antes de publicar.
