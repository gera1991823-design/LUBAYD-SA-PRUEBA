# Pasos exactos de publicación

## 1. GitHub

- Extrae el ZIP.
- Sube todos los archivos y carpetas interiores a la raíz del repositorio.
- `index.html` debe quedar en la raíz.
- Espera el despliegue de GitHub Pages.

## 2. Firebase

Ejecuta:

```bash
cd ~/LUBAYD-SA-PRUEBA
git pull origin main
npm --prefix functions install
firebase deploy --only "functions:authorizeOfflineDevice,functions:syncOfflineRecord,functions:getFuelFlowState,functions:notifyNewChatMessage,firestore:rules" --project lubayd-sa
firebase functions:list --project lubayd-sa
```

Verifica estas Functions:

- `authorizeOfflineDevice`
- `syncOfflineRecord`
- `getFuelFlowState`
- `notifyNewChatMessage`

## 3. Actualizar el teléfono

Con internet, abre:

```text
TU_URL/reset.html
```

Pulsa **Limpiar caché y abrir la aplicación**.

## 4. Preparar el modo offline

- Inicia sesión online una vez con el operador.
- Revisa Configuración → Preparación offline.
- Cierra sesión.
- Activa modo avión.
- Inicia sesión con el mismo correo y contraseña.

La pantalla “Recuperando tu sesión” fue eliminada; el formulario de ingreso se muestra directamente.
