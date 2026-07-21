# Lubayd SA V20.8.6 — Offline universal y navegación persistente

## Cambios principales

- Cualquier operador activo puede usar cualquier celular.
- En cada celular, el operador debe iniciar sesión con internet al menos una vez. La aplicación guarda solamente un verificador cifrado de su clave; nunca guarda la contraseña en texto.
- Después de esa primera sesión, el usuario puede ingresar sin conexión desde ese celular.
- Los partes y marcas creados sin conexión quedan guardados en IndexedDB y se sincronizan automáticamente cuando vuelve internet.
- La sincronización reintenta colas que hayan quedado en estado `syncing` después de una recarga o cierre inesperado.
- Al recargar, la aplicación conserva la sección y la posición de desplazamiento.
- La pantalla principal muestra `Bienvenido, <usuario>`.
- El historial muestra fecha y hora de creación de cada parte.
- Se estabilizó la escala móvil y se evitó el zoom involuntario de iPhone/Android.

## Límite técnico del acceso offline

Un celular completamente nuevo y sin internet no puede validar a un usuario que nunca inició sesión allí. Por seguridad, cada operador debe iniciar sesión online una vez en cada teléfono que vaya a utilizar; después funciona con o sin conexión.

## Publicación

1. Sube todos los archivos a la raíz de GitHub.
2. En Cloud Shell:

```bash
cd ~/LUBAYD-SA-PRUEBA
git pull origin main
npm --prefix functions install
firebase deploy --only "functions:authorizeOfflineDevice,functions:syncOfflineAttendance,functions:syncOfflinePart" --project lubayd-sa
firebase deploy --only firestore:rules --project lubayd-sa
```

3. Verifica:

```bash
firebase functions:list --project lubayd-sa
```

Deben aparecer `notifyNewChatMessage`, `authorizeOfflineDevice`, `syncOfflineAttendance` y `syncOfflinePart`.

## Prueba recomendada

1. En el celular A, inicia sesión online con un operador.
2. Cierra sesión, desconecta internet e ingresa con la misma contraseña o con el PIN personalizado.
3. Crea un parte y recarga: debe permanecer en la misma sección.
4. Recupera internet: el parte debe pasar a sincronizado automáticamente.
5. En el administrador, confirma que el parte aparece con fecha y hora.
6. Repite en el celular B con el mismo u otro operador.
