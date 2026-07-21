# Lubayd SA V20.6 — Diseño V20.1 + asistencia offline

Esta versión parte de la V20.1 suministrada y conserva su diseño, logotipos, paneles, partes, gráficos, chat, notificaciones y administración.

## Cambios incorporados

- Asistencia con funcionamiento sin internet.
- Cola local persistente en IndexedDB para fotografía, GPS, fecha y hora.
- Acceso sin conexión mediante PIN de 4 a 6 dígitos.
- Sincronización automática al recuperar internet y botón **Sincronizar ahora**.
- La hora de captura se conserva en `America/Montevideo`; Firebase registra además el momento de sincronización.
- El administrador no marca asistencia: visualiza, edita horarios y elimina con auditoría.
- El supervisor solo visualiza.
- Solo el operador puede registrar llegada y salida, tanto en la interfaz como en las reglas de Firestore.
- Logo local incluido para evitar imágenes rotas.
- Caché PWA nueva V20.6 y estrategia network-first para HTML, CSS y JavaScript.
- Push V20.1 y VAPID conservados.

## Preparar un celular para trabajar sin señal

1. Publica esta versión y abre la PWA con internet.
2. Inicia sesión como operador.
3. Abre **Asistencia**.
4. En **Trabajo sin internet**, escribe un PIN de 4 a 6 números y pulsa **Guardar PIN**.
5. Verifica que aparezca **Preparado**.
6. No cierres sesión, no desinstales la PWA y no borres los datos del navegador.

## Uso durante dos días sin internet

1. Abre la aplicación instalada.
2. Si no se restaura la sesión normal, usa **Acceso sin conexión** y el PIN.
3. Registra llegada y salida con foto y GPS.
4. Cada marca aparecerá como **Pendiente de sincronización**.
5. La información permanece en ese teléfono hasta que se sincronice.

## Sincronizar al recuperar internet

1. Cierra el modo offline.
2. Inicia sesión normalmente con correo y contraseña.
3. Abre **Asistencia**.
4. Pulsa **Sincronizar ahora** o espera la sincronización automática.
5. Comprueba que aparezca **Todo sincronizado**.
6. El administrador podrá ver las marcas desde otro celular después de este paso.

## Publicación

1. Sube todo el contenido de esta carpeta a la raíz del repositorio de GitHub Pages.
2. Reemplaza los archivos anteriores.
3. Publica `firestore.rules` en Firebase Console → Firestore Database → Reglas.
4. Espera a que GitHub Pages termine el despliegue.
5. Elimina la PWA anterior del celular e instálala nuevamente.
6. Configura otra vez el PIN offline en cada dispositivo.

## Reglas importantes

- Un usuario nuevo no puede iniciar sesión por primera vez sin internet.
- El PIN solo funciona en el dispositivo donde fue configurado y la autorización offline debe renovarse con una sesión online al menos cada 7 días.
- Las marcas de un operador no son visibles remotamente hasta que su teléfono recupera conexión y sincroniza.
- Se admite una demora de hasta 7 días entre la captura y la sincronización; el caso previsto es de 2 días.
- Mantén activadas la fecha, hora y zona horaria automáticas del teléfono.
- No cierres sesión si la pantalla muestra marcas pendientes.

## Archivos principales

- `index.html`
- `style.css`
- `operations.css`
- `attendance.css`
- `app.js`
- `attendance.js`
- `offline-store.js`
- `firebase-init.js`
- `push-notifications.js`
- `service-worker.js`
- `firestore.rules`
- `assets/`

La Cloud Function `notifyNewChatMessage` se conserva como respaldo en `functions/`. No hace falta volver a desplegarla si ya funciona.
