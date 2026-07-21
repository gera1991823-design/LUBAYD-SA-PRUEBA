# Lubayd SA V20.8.4 — sincronización multidispositivo

Esta versión corrige el caso en el que un mismo usuario sincronizaba desde un celular, pero desde otro quedaba en “Esperando sincronización”.

## Funcionamiento

Cada celular tiene un `deviceId` y una credencial independientes. Al iniciar sesión normalmente con un operador, la aplicación registra ese teléfono sin eliminar las autorizaciones de los otros celulares.

## Publicación

1. Subir todos los archivos del ZIP a la raíz de GitHub.
2. En Cloud Shell ejecutar:

```bash
cd ~/LUBAYD-SA-PRUEBA
git pull origin main
npm --prefix functions install
firebase deploy --only "functions:authorizeOfflineDevice,functions:syncOfflineAttendance,functions:syncOfflinePart" --project lubayd-sa
firebase functions:list --project lubayd-sa
```

Deben aparecer `authorizeOfflineDevice`, `syncOfflineAttendance` y `syncOfflinePart`, además de `notifyNewChatMessage`.

## Recuperar un parte pendiente de otro celular

No borrar ni reinstalar la PWA. En ese mismo celular: activar internet, actualizar la aplicación, cerrar la sesión offline, iniciar sesión normalmente con correo y contraseña del mismo operador, esperar unos segundos y pulsar **Más → Sincronización → Sincronizar ahora**.
