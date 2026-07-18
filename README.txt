LUBAYD SA - GESTION FORESTAL V10 FUTURE

CONTENIDO
- Diseno moderno, amigable y adaptable a PC, iPhone y Android.
- Formulario guiado en 5 pasos.
- Borrador guardado automaticamente.
- GPS opcional que no bloquea el formulario.
- Graficos por operador, dia, semana y mes.
- Sincronizacion entre dispositivos con Firebase Firestore.
- Funcionamiento PWA y copia local para trabajar sin conexion.

PUBLICAR EN GITHUB
1. Descomprime este ZIP.
2. Abre el repositorio LUBAYD-SA.
3. Selecciona Add file > Upload files.
4. Sube TODOS los archivos y la carpeta assets.
5. Reemplaza los archivos anteriores y confirma con Commit changes.
6. Espera entre 1 y 3 minutos.
7. Cierra la app en el telefono y vuelve a abrirla.
8. Si aparece una actualizacion, pulsa Actualizar.

FIREBASE
- Proyecto: lubayd-sa
- Coleccion: partes
- Los registros se sincronizan entre PC y celular.
- La configuracion actual esta en firebase-init.js.

SEGURIDAD IMPORTANTE
La base de datos se creo en modo de prueba. Antes de usarla con informacion
real durante un periodo prolongado, agrega Firebase Authentication y reglas
de seguridad. El modo de prueba permite acceso temporal demasiado amplio.

ARCHIVOS PRINCIPALES
- index.html: estructura de la aplicacion.
- style.css: todo el diseno responsive.
- app.js: formulario, historial, GPS, borradores y sincronizacion.
- charts.js: graficos y ranking de operadores.
- firebase-init.js: conexion con Firestore.
- service-worker.js: instalacion y funcionamiento PWA.
