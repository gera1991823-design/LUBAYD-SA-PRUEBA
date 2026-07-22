# Lubayd SA V21.3.0 — proyecto completo

Esta carpeta contiene una versión integral y coherente de la PWA de Lubayd SA. Todos los archivos usan la misma versión **21.3.0**.

## Corrección principal

La aplicación ya no utiliza una pantalla bloqueante con el texto **“Recuperando tu sesión”**. Al abrirla:

- muestra inmediatamente el formulario de ingreso;
- intenta recuperar Firebase sin bloquear la interfaz;
- permite ingresar offline con el mismo correo y contraseña, después de una primera sesión online en ese teléfono;
- conserva partes, asistencia, descansos y combustible en IndexedDB;
- sincroniza la cola al recuperar internet.

## Módulos incluidos

- Inicio y estado de sincronización.
- Partes diarios con GPS.
- Asistencia con fotografía, GPS, llegada y salida.
- Descansos con fotografía, GPS, inicio y fin.
- Combustible: proveedor → tanque general → tráiler → máquinas.
- Chat interno y notificaciones push.
- Administración de usuarios, máquinas y montes.
- PWA instalable y service worker offline.
- Cloud Functions y reglas de Firestore.

## Estructura

```text
index.html
styles.css
config.js
core.js
offline-db.js
firebase-init.js
data.js
auth.js
parts.js
attendance.js
breaks.js
fuel.js
chat.js
admin.js
push-notifications.js
app.js
service-worker.js
manifest.webmanifest
reset.html
firestore.rules
firebase.json
.firebaserc
assets/
functions/
```

## Publicación del sitio en GitHub Pages

1. Descomprime el ZIP.
2. Abre el repositorio que publica Lubayd SA.
3. Sube **todo el contenido interior** de esta carpeta a la raíz del repositorio.
4. Reemplaza los archivos anteriores.
5. Conserva las carpetas `assets` y `functions` con sus archivos interiores.
6. Confirma el commit en la rama usada por GitHub Pages.
7. Espera a que GitHub Pages termine el despliegue.

No subas la carpeta contenedora como una subcarpeta. `index.html` debe quedar en la raíz.

## Despliegue obligatorio en Firebase

GitHub Pages publica la interfaz, pero el acceso offline autorizado y la sincronización requieren desplegar Functions y reglas.

Desde Cloud Shell o una terminal con Firebase CLI:

```bash
cd ~/LUBAYD-SA-PRUEBA
git pull origin main
npm --prefix functions install
firebase deploy --only "functions:authorizeOfflineDevice,functions:syncOfflineRecord,functions:getFuelFlowState,functions:notifyNewChatMessage,firestore:rules" --project lubayd-sa
firebase functions:list --project lubayd-sa
```

Deben aparecer, como mínimo:

```text
authorizeOfflineDevice
syncOfflineRecord
getFuelFlowState
notifyNewChatMessage
```

En Firebase Authentication debe estar habilitado **Correo electrónico/contraseña**.

## Preparar cada celular para trabajar sin conexión

1. Conecta el teléfono a internet.
2. Abre la dirección de GitHub Pages en Chrome o Safari.
3. Inicia sesión con el correo y la contraseña del operador.
4. Espera unos segundos para que se guarde la credencial protegida y se autorice el teléfono.
5. Entra en **Configuración** y confirma:
   - Perfil local: sí.
   - Acceso offline: sí.
   - Dispositivo autorizado: sí.
   - Almacenamiento local: sí.
6. Cierra sesión.
7. Activa modo avión.
8. Abre Lubayd SA.
9. Ingresa con el mismo correo y contraseña.

Un teléfono nuevo no puede autenticar offline a un usuario que nunca inició sesión online en ese dispositivo.

## Eliminar una versión vieja de la caché

Después de publicar, abre con internet:

```text
https://TU-DIRECCION-DE-GITHUB-PAGES/reset.html
```

Pulsa **Limpiar caché y abrir la aplicación**. Esta pantalla elimina service workers y cachés anteriores, pero no borra IndexedDB.

## Prueba completa

1. Inicia sesión online con un operador.
2. Confirma el estado offline en Configuración.
3. Cierra sesión y activa modo avión.
4. Inicia sesión offline.
5. Registra un parte, una marca o un descanso de prueba.
6. Cierra y vuelve a abrir la app: el registro debe continuar visible.
7. Recupera internet.
8. Pulsa **Sincronizar ahora** si no comienza automáticamente.
9. Verifica el registro desde la cuenta administradora.

## Precaución con registros de versiones anteriores

No desinstales la PWA ni borres los datos del sitio si la versión anterior contiene registros pendientes. Este proyecto conserva el almacenamiento del navegador, pero usa una base local nueva para evitar mezclar estructuras incompatibles. Sincroniza o respalda los registros antiguos antes de realizar una limpieza destructiva del sitio.
