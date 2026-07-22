# Lubayd SA V21.0.1 — corrección del inicio de sesión offline

## Qué corrige

- Define nuevamente `window.LubaydFirebase`, que es el módulo que `app.js` utiliza para iniciar sesión.
- Usa persistencia local de Firebase Auth cuando existe conexión.
- Después del primer ingreso online, guarda en IndexedDB un verificador PBKDF2 de la contraseña; nunca guarda la contraseña en texto.
- Cuando no hay conexión, el mismo formulario de correo y contraseña valida ese verificador local y abre la sesión offline.
- Mantiene el acceso por PIN que ya tenga la aplicación.
- Agrega una base IndexedDB separada para autenticación y no modifica ni borra las colas existentes de partes, asistencia o combustible.
- Renueva la caché de la PWA con el nombre `lubayd-sa-v21.0.1-offline-login-fix`.

## Archivos del paquete

- `firebase-init.js`: reemplaza el archivo actual.
- `service-worker.js`: reemplaza el archivo actual.
- `offline-auth.js`: archivo nuevo; no reemplaza `offline-store.js`.
- `index-script-order.html`: muestra el orden correcto de scripts.

**No reemplaces ni elimines el `offline-store.js` actual**, porque allí pueden estar las funciones que manejan las colas offline.

## Paso 1 — respaldo

Antes de cambiar nada, descarga una copia del repositorio actual desde GitHub.

No desinstales la PWA ni borres los datos del navegador si existen registros pendientes.

## Paso 2 — GitHub

1. Abre el repositorio `LUBAYD-SA-PRUEBA`.
2. Pulsa **Add file → Upload files**.
3. Sube `firebase-init.js`, `service-worker.js` y el archivo nuevo `offline-auth.js`.
4. Confirma que queden en la raíz, junto a `index.html`, `offline-store.js` y `app.js`.
5. Abre `index.html` para editarlo.
6. En todos los CSS, manifest y scripts locales cambia el parámetro de versión a `v=21.0.1`.
7. Agrega `offline-auth.js` inmediatamente después de `offline-store.js`.
8. Verifica que `app.js` sea el último script local.
9. Usa `index-script-order.html` como modelo.
10. Guarda el commit en `main`.
11. Espera que GitHub Pages termine el despliegue.

## Paso 3 — confirmar el Service Worker

En `app.js` debe existir un registro equivalente a:

```js
navigator.serviceWorker.register('./service-worker.js', { scope: './' });
```

No registres un nombre distinto.

## Paso 4 — primera preparación de cada celular

Esta parte es obligatoria. Un teléfono nuevo no puede validar offline a un usuario que nunca inició sesión allí.

1. Conecta el celular a internet.
2. Abre Lubayd desde el icono instalado.
3. Inicia sesión con correo y contraseña.
4. Espera 5 segundos para que se guarde el perfil y el verificador cifrado.
5. Entra en **Más → Configuración → Actualizar aplicación**.
6. Cierra completamente la PWA.
7. Vuelve a abrirla con internet y entra nuevamente una vez.
8. Cierra la sesión.
9. Activa modo avión.
10. Abre Lubayd.
11. Usa el formulario normal de correo y contraseña. Debe abrir la sesión offline.

Si además quieres usar PIN, configúralo con internet desde **Más → Configuración**.

## Paso 5 — prueba de datos

1. Con modo avión, inicia sesión.
2. Registra una marca o un parte de prueba.
3. Cierra y vuelve a abrir la aplicación.
4. Confirma que el registro continúa en el teléfono.
5. Recupera internet.
6. Cierra la sesión offline e inicia sesión normalmente.
7. Pulsa **Sincronizar ahora**.
8. Comprueba el registro desde la cuenta administradora.

## No requiere desplegar Functions para corregir el login

Esta corrección de autenticación offline es local. Las Functions existentes siguen siendo necesarias para sincronizar partes, asistencia y combustible, pero no hace falta volver a desplegarlas si ya están funcionando.

Para verificar las Functions actuales:

```bash
firebase functions:list --project lubayd-sa
```

En el proyecto deberían continuar disponibles las Functions que use la versión publicada, por ejemplo:

- `notifyNewChatMessage`
- `authorizeOfflineDevice`
- `syncOfflineAttendance`
- `syncOfflinePart`
- `syncFuelFlowRecord`
- `getFuelFlowState`

## Diagnóstico rápido

### No inicia ni con internet

Abre la consola del navegador y comprueba si aparece:

```text
window.LubaydFirebase is undefined
```

Si aparece, `firebase-init.js` no está cargando o está después de `app.js`.

### Con internet funciona, pero offline dice “usuario no preparado”

Ese usuario todavía no inició sesión online después de publicar V21.0.1 en ese teléfono.

### Abre una versión anterior

El parámetro `?v=` no fue actualizado en `index.html`, o el Service Worker anterior sigue controlando la PWA. Usa **Actualizar aplicación**, cierra completamente y vuelve a abrir.

### No aparece nada al pulsar Ingresar

Revisa que `firebase-auth-compat.js` esté incluido, que `offline-auth.js` esté después de `offline-store.js` y que `app.js` sea el último script local.
