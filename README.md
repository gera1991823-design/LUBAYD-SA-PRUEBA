# Lubayd SA - V20.2 Asistencia Móvil

Versión completa para publicar en GitHub Pages y conectar con el proyecto Firebase `lubayd-sa`.

## Mejoras principales

- Vista de asistencia mediante tarjetas adaptadas al celular.
- Administrador y supervisor pueden consultar todas las marcas por fecha.
- Buscador por nombre o correo.
- Resumen de presentes, trabajando, finalizados y sin registrar.
- Botón visible **Actualizar marcas**.
- Mensaje de error visible cuando Firestore rechaza o no completa una consulta.
- Registro de llegada y salida con cámara, GPS y hora de Firebase.
- El administrador puede corregir o eliminar una marca con motivo obligatorio y auditoría.
- Caché PWA V20.2 con estrategia *network first* para HTML, CSS y JavaScript.
- Instrucción específica para iPhone cuando la web se abre en Safari y todavía no está instalada.
- Notificaciones FCM con escritura directa en `push_tokens`, sin leer el documento antes de crearlo.
- Partes diarios, chat interno y administración de usuarios incluidos.

## Archivos que deben subirse a GitHub

Sube todo el contenido de esta carpeta a la raíz del repositorio:

- `index.html`
- `styles.css`
- `firebase-init.js`
- `attendance.js`
- `chat.js`
- `push-notifications.js`
- `app.js`
- `service-worker.js`
- `manifest.webmanifest`
- `firestore.rules`
- `assets/`
- `functions/` como respaldo de la Cloud Function

No subas `functions/node_modules` si luego instalas las dependencias localmente.

## Publicación en GitHub Pages

1. Descomprime el ZIP.
2. Entra al repositorio que publica la aplicación.
3. Elimina o reemplaza los archivos anteriores.
4. Sube todos los archivos y carpetas de V20.2.
5. Confirma los cambios en la rama configurada para GitHub Pages.
6. Espera a que el despliegue termine correctamente.

## Publicar las reglas de Firestore

1. Abre Firebase Console.
2. Entra en **Firestore Database → Reglas**.
3. Copia todo el contenido de `firestore.rules`.
4. Presiona **Publicar**.

Sin estas reglas no funcionarán correctamente la asistencia, las fotografías, el chat, los roles ni `push_tokens`.

## Actualizar el celular

### iPhone

1. Elimina el icono anterior de Lubayd SA de la pantalla de inicio.
2. Abre la dirección de GitHub Pages en Safari.
3. Pulsa **Compartir → Agregar a pantalla de inicio**.
4. Abre Lubayd SA desde el nuevo icono.
5. Inicia sesión.
6. Entra en **Más → Configuración**.
7. Pulsa **Activar notificaciones** y acepta el permiso.

Safari abierto como una pestaña normal puede mostrar que las notificaciones no están disponibles. En iPhone deben activarse dentro de la PWA instalada.

### Android

1. Cierra completamente la versión anterior.
2. Borra la aplicación instalada si continúa mostrando la versión vieja.
3. Abre la web en Chrome y vuelve a instalarla.
4. Revisa que Chrome o Lubayd SA tengan permiso de notificaciones.

## Verificar la asistencia

1. Inicia sesión con un operador.
2. Entra en **Marcas**.
3. Registra llegada con foto y GPS.
4. Inicia sesión con el administrador en el celular.
5. Entra en **Marcas** y pulsa **Actualizar marcas**.
6. Selecciona la fecha y busca al operador.

Firestore debe contener:

- `asistencias`
- `asistencia_fotos`
- `asistencia_auditoria` cuando un administrador corrige o elimina

## Verificar las notificaciones

Después de activar las notificaciones, Firestore debe crear:

- `push_tokens/{tokenId}`

El documento debe incluir, entre otros campos:

- `active: true`
- `userId`
- `token`
- `platform`
- `standalone`

Luego minimiza la aplicación y envía un mensaje desde otra cuenta.

## Cloud Function

La función `notifyNewChatMessage` ya estaba desplegada. La carpeta `functions` se incluye como respaldo.

Para volver a desplegarla:

```bash
npm install -g firebase-tools
firebase login
cd functions
npm install
cd ..
firebase deploy --only functions
```

Para publicar solamente las reglas:

```bash
firebase deploy --only firestore:rules
```

## Roles

En `usuarios/{uid}`:

- Administrador: `role: "admin"`, `active: true`
- Supervisor: `role: "supervisor"`, `active: true`
- Operador: `role: "operador"`, `active: true`

Solo el administrador puede modificar roles, activar/desactivar usuarios y corregir o eliminar marcas.
