# Lubayd SA V20.4 — Diseño V19 + modo offline

Versión completa de la PWA para publicar en GitHub Pages y utilizar con el proyecto Firebase `lubayd-sa`.

## Qué incluye

- Regreso al diseño oscuro y verde de la V19.
- Asistencia diferenciada por rol:
  - **Operador:** registra llegada y salida con foto y GPS.
  - **Supervisor:** visualiza las marcas del equipo.
  - **Administrador:** visualiza, corrige horarios y elimina marcas. **No registra llegada ni salida.**
- Seguridad reforzada en `firestore.rules`: solo el rol `operador` puede crear sus propias marcas y fotografías.
- Modo offline completo para asistencia mediante IndexedDB.
- Cola local para guardar fotografía, GPS, fecha y hora aunque Firebase no responda.
- Sincronización automática al recuperar internet y botón **Sincronizar ahora**.
- Acceso offline mediante PIN de 4 a 6 dígitos para usuarios preparados previamente en ese teléfono.
- Bloqueo del cierre de sesión cuando quedan marcas pendientes.
- Horarios visualizados y editados expresamente en la zona `America/Montevideo`.
- Auditoría obligatoria para cada corrección o eliminación administrativa.
- PWA con caché nueva V20.4 para reemplazar versiones anteriores.
- Chat y notificaciones push conservados.

## Funcionamiento sin internet

### Preparar cada teléfono

1. Instala la PWA desde el navegador.
2. Inicia sesión normalmente mientras haya internet.
3. Abre **Más → Configuración**.
4. Crea un PIN offline de 4 a 6 números.
5. Verifica que el panel muestre perfil descargado, PIN configurado y almacenamiento local disponible.
6. No borres los datos del navegador ni desinstales la PWA antes del trabajo sin señal.

### Durante el período sin señal

- El usuario abre **Acceso sin conexión** y utiliza el PIN.
- La aplicación permite registrar llegada y salida únicamente al rol `operador`.
- Cada marca queda guardada en el teléfono con fotografía, GPS y hora de captura.
- El estado indica cuántas marcas están pendientes.

### Cuando regresa internet

1. Cierra la sesión offline.
2. Inicia sesión normalmente con correo y contraseña.
3. Abre **Asistencia**.
4. Pulsa **Sincronizar ahora** si la sincronización no comenzó automáticamente.
5. Espera hasta ver **Todo sincronizado**.

El administrador verá las marcas cuando el teléfono del operador haya recuperado internet y terminado la sincronización. Una marca que permanece únicamente en otro celular no puede verse remotamente antes de sincronizar.

## Horarios

- La fecha diaria y todas las horas de asistencia se muestran en horario de Uruguay: `America/Montevideo`.
- Las marcas offline conservan la hora exacta capturada por el teléfono.
- Firebase registra además la recepción en el servidor al sincronizar.
- Al editar, el administrador ingresa la hora en formato `HH:MM` de Uruguay.
- La salida debe ser posterior a la entrada.

Conviene mantener activada la fecha y hora automáticas del celular. Sin internet, la PWA depende del reloj del dispositivo para determinar la hora de captura.

## Publicación en GitHub Pages

1. Descomprime el ZIP.
2. Sube **todo el contenido** de esta carpeta a la raíz del repositorio.
3. Reemplaza los archivos existentes.
4. Confirma el cambio en la rama utilizada por GitHub Pages.
5. Espera a que GitHub Pages finalice el despliegue.
6. Publica `firestore.rules` en Firebase Console.

Archivos principales:

- `index.html`
- `styles.css`
- `app.js`
- `attendance.js`
- `offline-store.js`
- `firebase-init.js`
- `chat.js`
- `push-notifications.js`
- `service-worker.js`
- `manifest.webmanifest`
- `firestore.rules`
- `assets/`
- `functions/` como respaldo de la función push

## Publicar las reglas de Firestore

Desde Firebase Console:

1. Abre **Firestore Database → Reglas**.
2. Reemplaza el contenido por el archivo `firestore.rules` de esta versión.
3. Pulsa **Publicar**.

O desde Firebase CLI:

```bash
firebase deploy --only firestore:rules
```

## Actualizar los celulares

Debido al cambio de diseño y caché:

### iPhone

1. Elimina el icono anterior de Lubayd SA.
2. Abre la dirección de GitHub Pages en Safari.
3. Usa **Compartir → Agregar a pantalla de inicio**.
4. Abre la aplicación desde el nuevo icono.
5. Inicia sesión online y vuelve a configurar el PIN offline.
6. Activa las notificaciones desde **Más**.

### Android

1. Elimina o actualiza la PWA anterior.
2. Abre la página en Chrome.
3. Instálala nuevamente.
4. Inicia sesión online y configura el PIN offline.
5. Revisa los permisos de cámara, ubicación y notificaciones.

## Prueba recomendada

1. Inicia sesión como operador con internet.
2. Configura el PIN offline.
3. Activa modo avión.
4. Abre la aplicación mediante el PIN.
5. Registra llegada con foto y GPS.
6. Registra salida.
7. Desactiva modo avión.
8. Cierra el modo offline e inicia sesión normalmente.
9. Pulsa **Sincronizar ahora**.
10. Desde el administrador, abre **Asistencia**, selecciona la fecha y pulsa **Actualizar marcas**.
11. Comprueba que el administrador no tenga botones de llegada o salida y que sí pueda ver, editar o eliminar.

## Colecciones utilizadas

- `usuarios`
- `partes`
- `asistencias`
- `asistencia_fotos`
- `asistencia_auditoria`
- `chats`
- `push_tokens`

No es necesario crear las colecciones manualmente.
