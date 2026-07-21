# Lubayd SA V20.7 — acceso sin internet y sesión de una hora

Esta versión conserva el diseño completo de la V20.1 y agrega un sistema de acceso local para trabajar donde no existe conexión.

## Funciones principales

- El administrador prepara previamente cada teléfono o tablet mientras tenga internet.
- El administrador asigna un PIN local de 4 a 6 números a cada operador autorizado.
- El operador puede iniciar sesión por primera vez en el campo, sin correo, contraseña ni internet.
- La sesión dura como máximo 60 minutos.
- Al terminar la hora, la aplicación vuelve automáticamente a la pantalla de acceso.
- Si se cierra y vuelve a abrir la PWA dentro de la hora, la sesión local puede recuperarse hasta su vencimiento.
- Las marcas guardan fotografía, GPS y hora del teléfono en `America/Montevideo`.
- Las marcas quedan en IndexedDB hasta que el dispositivo recupera internet.
- El dispositivo puede sincronizar las marcas sin pedir la contraseña de Firebase al operador.
- El administrador no marca asistencia: visualiza, corrige horarios y elimina.
- El supervisor solamente visualiza.

## Preparación obligatoria del dispositivo

La aplicación y los operadores deben cargarse antes de llevar el dispositivo a la zona sin señal.

1. Publica la V20.7 en GitHub Pages.
2. Publica `firestore.rules`.
3. Despliega las Functions, especialmente `syncOfflineAttendance`.
4. Instala la PWA en el teléfono o tablet.
5. Inicia sesión online como administrador.
6. Abre **Usuarios**.
7. En cada operador, escribe un PIN y pulsa **Preparar**.
8. Escribe un nombre para el dispositivo, por ejemplo `Celular cuadrilla 1`.
9. Pulsa **Habilitar dispositivo**.
10. Comprueba que el estado muestre `Habilitado`.

Después de estos pasos, los operadores aparecerán en **Acceso sin conexión** y podrán ingresar en el campo.

## Funcionamiento en el campo

1. Abre la PWA instalada.
2. Selecciona el operador.
3. Ingresa el PIN local.
4. Registra llegada o salida con foto y GPS.
5. La barra superior muestra el tiempo restante de la sesión.
6. Después de 60 minutos, la sesión se cierra automáticamente.

No se guarda la contraseña de Firebase. El PIN se protege localmente con PBKDF2 y SHA-256.

## Sincronización

Cuando regresa internet, el dispositivo intenta enviar automáticamente todas las marcas pendientes mediante la Function `syncOfflineAttendance`.

La Function valida:

- credencial del dispositivo;
- operador autorizado;
- rol activo de operador;
- fotografía y tamaño;
- GPS;
- fecha y hora;
- duplicados de entrada o salida.

También puede pulsarse **Sincronizar marcas pendientes** en la administración del dispositivo.

## Publicar reglas

Desde Firebase Console:

1. Abre **Firestore Database → Reglas**.
2. Reemplaza el contenido por `firestore.rules`.
3. Pulsa **Publicar**.

O con Firebase CLI:

```bash
firebase deploy --only firestore:rules
```

## Desplegar Functions

Desde la carpeta del proyecto:

```bash
firebase login
firebase use lubayd-sa
cd functions
npm install
cd ..
firebase deploy --only functions
```

Este despliegue conserva `notifyNewChatMessage` y agrega `syncOfflineAttendance` en `southamerica-east1`.

## Subir a GitHub Pages

El ZIP de entrega está preparado con `index.html` en la raíz.

1. Descomprime el ZIP.
2. Selecciona todos los archivos interiores.
3. Súbelos a la raíz del repositorio.
4. Confirma que `index.html`, `app.js`, `offline-store.js` y la carpeta `assets` estén en el primer nivel.
5. Espera el despliegue de GitHub Pages.
6. Elimina la PWA anterior e instala la nueva.

## Límites importantes

- Un dispositivo nunca preparado no puede conocer los usuarios autorizados sin internet.
- La hora offline depende del reloj del teléfono; conviene mantener fecha y hora automáticas.
- No borres los datos del navegador ni desinstales la PWA mientras existan marcas pendientes.
- El endpoint de sincronización solo funciona después de desplegar la nueva Cloud Function.
