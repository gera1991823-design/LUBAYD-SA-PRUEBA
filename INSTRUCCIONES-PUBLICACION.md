# Publicación de Lubayd SA V22.0.0

## 1. Respaldo

Antes de reemplazar archivos, descargá una copia completa del repositorio actual. No borres los datos del sitio en los celulares si existen registros pendientes.

## 2. Subir a GitHub

1. Descomprimí el ZIP.
2. Abrí la carpeta `LUBAYD-SA-V22.0.0-PROYECTO-COMPLETO`.
3. Subí a GitHub todo el contenido interior.
4. `index.html`, `service-worker.js`, `firebase.json` y la carpeta `functions` deben quedar en la raíz del repositorio.
5. Reemplazá los archivos anteriores y confirmá el commit en `main`.
6. Esperá a que GitHub Pages termine la publicación.

## 3. Actualizar Cloud Shell

```bash
cd ~/LUBAYD-SA-PRUEBA
git pull origin main
npm --prefix functions install
node --check functions/index.js
```

Si la carpeta local tiene otro nombre, reemplazá `LUBAYD-SA-PRUEBA` por el nombre correcto.

## 4. Desplegar Functions y reglas

Para evitar filtros con nombres faltantes, desplegá todas las Functions del proyecto:

```bash
firebase deploy --only functions,firestore:rules --project lubayd-sa
```

Después verificá:

```bash
firebase functions:list --project lubayd-sa
```

Deben aparecer, entre otras:

- `authorizeOfflineDevice`
- `syncOfflineRecord`
- `getFuelFlowState`
- `adminManageRecord`
- `notifyNewChatMessage`

La región debe ser `southamerica-east1`.

## 5. Limpiar la caché anterior

Cuando GitHub Pages haya terminado, abrí con internet:

```text
https://TU-USUARIO.github.io/TU-REPOSITORIO/reset.html
```

Pulsá **Limpiar caché y abrir la aplicación**. Esta acción elimina cachés y service workers anteriores, pero conserva IndexedDB y los registros locales pendientes.

## 6. Preparar cada teléfono

1. Abrí Lubayd SA con internet.
2. Iniciá sesión con el usuario del operador.
3. Entrá en **Modo sin conexión**.
4. Confirmá:
   - Perfil descargado: Sí.
   - Contraseña protegida: Sí.
   - Teléfono autorizado: Sí.
   - IndexedDB disponible: Sí.
5. Cerrá sesión.
6. Activá modo avión.
7. Abrí la aplicación e ingresá con el mismo correo y contraseña.

## 7. Prueba funcional

En modo avión:

1. Marcá ingreso con foto y GPS.
2. Iniciá y finalizá un descanso.
3. Registrá un movimiento de combustible.
4. Creá un parte con fotografía, GPS y firma digital.
5. Cerrá y volvé a abrir la aplicación para confirmar que los registros permanecen.
6. Recuperá internet y pulsá **Sincronizar ahora**.
7. Verificá los registros desde una cuenta administradora.

## Importante

No desinstales la PWA ni borres “datos del sitio” antes de sincronizar registros pendientes. La versión V22.0.0 conserva el nombre de la base IndexedDB anterior para mantener los datos locales de V21.3.1.
