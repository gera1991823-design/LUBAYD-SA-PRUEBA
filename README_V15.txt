LUBAYD SA - GESTION FORESTAL V15 ASISTENCIA
=============================================

NOVEDADES
---------
- Nueva seccion Asistencia para todos los usuarios.
- Registro de llegada y salida con fotografia tomada en el momento.
- La interfaz no permite elegir imagenes de la galeria.
- Captura automatica de GPS con precision en metros.
- Hora de llegada y salida generada por Firebase, no por un campo editable.
- Una llegada y una salida por usuario y dia.
- El usuario no puede editar ni borrar las marcaciones.
- Historial personal de los ultimos registros.
- Panel para administrador y supervisor con filtro por fecha.
- Visualizacion privada de fotos y ubicaciones.
- Calculo automatico de duracion de la jornada.
- Funciona con el plan Spark porque las fotos se comprimen y se guardan en documentos privados de Firestore.

ARCHIVOS NUEVOS
---------------
- attendance.js
- attendance.css
- FIREBASE_V15_PASOS.txt

COLECCIONES NUEVAS
------------------
Firebase las crea automaticamente al realizar la primera marcacion:
- asistencias
- asistencia_fotos

INSTALACION WEB
---------------
1. Sube todos los archivos y la carpeta assets a la raiz del repositorio GitHub.
2. Reemplaza los archivos anteriores.
3. Confirma los cambios en la rama main.
4. Publica las reglas incluidas en firestore.rules desde Firebase Console.
5. Espera a que GitHub Pages complete el despliegue.
6. En PC usa Ctrl + F5. En celular cierra la PWA y vuelve a abrirla.

REQUISITOS
----------
- La pagina debe abrirse mediante HTTPS. GitHub Pages ya utiliza HTTPS.
- El usuario debe permitir camara y ubicacion.
- Para marcar asistencia debe existir conexion a internet.
- Authentication por correo y contrasena debe continuar habilitado.
- El dominio de GitHub Pages debe estar autorizado en Firebase Authentication.

SEGURIDAD IMPLEMENTADA
----------------------
- Cada operador solo puede leer sus propias marcaciones y fotos.
- Administradores y supervisores pueden consultar las del equipo.
- Las fotos se guardan separadas de la lista principal para no descargarlas innecesariamente.
- Cada foto se comprime antes de subirla y tiene un limite estricto de tamano.
- Las reglas impiden actualizar o borrar fotografias.
- Las reglas impiden cambiar la foto, GPS, usuario o hora de una llegada ya creada.
- Una salida solo puede agregarse sobre una llegada existente y no puede modificarse despues.

LIMITACION IMPORTANTE
---------------------
La pagina obliga a usar una captura nueva desde la camara y no ofrece galeria. Sin embargo, una aplicacion web no puede garantizar por si sola que el sistema operativo no use una camara virtual o una ubicacion simulada. Para control biometrico o prueba de vida real se necesita una solucion nativa especializada y una politica formal de tratamiento de datos.

PRIVACIDAD
----------
Antes de usarlo con personal, define por escrito:
- finalidad de las fotografias;
- quienes pueden verlas;
- plazo de conservacion;
- procedimiento de correccion de marcaciones;
- responsable del tratamiento de la informacion.
