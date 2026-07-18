LUBAYD SA - GESTION FORESTAL V9 FIREBASE

Esta version sincroniza los partes mediante Cloud Firestore.
Los registros guardados desde el celular aparecen en la PC y viceversa.

PUBLICACION
1. Descomprimir el ZIP.
2. Reemplazar todos los archivos del repositorio GitHub Pages.
3. Confirmar los cambios (Commit changes).
4. Esperar la publicacion.
5. Cerrar y volver a abrir la PWA en el celular.
6. Si aparece "Hay una nueva version", pulsar Actualizar.

FIRESTORE
- Coleccion utilizada: partes
- La app migra una sola vez los registros locales existentes a Firestore.
- Firestore mantiene cache local y sincroniza al recuperar conexion.

IMPORTANTE
La base esta actualmente en modo de prueba. Antes de usarla en produccion,
se recomienda activar Firebase Authentication y reglas de seguridad.
