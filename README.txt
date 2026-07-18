GESTION FORESTAL LUBAYD SA - VERSION 11 SECURE
================================================

MEJORAS INCLUIDAS
- Inicio de sesion con correo y contrasena mediante Firebase Authentication.
- Alta de usuarios desde la pantalla de acceso.
- Aprobacion obligatoria del usuario antes de acceder a los datos.
- Recuperacion de contrasena por correo.
- El operador se completa automaticamente con el usuario conectado.
- GPS obligatorio, capturado con maximumAge=0 y bloqueado despues de obtenerse.
- Los partes son inmutables en Firestore: no se permite modificar la ubicacion ni otros datos.
- Filtro exacto por dia en el historial.
- Sincronizacion entre celular y PC mediante Cloud Firestore.
- Funcionamiento PWA y cache sin conexion.

PASOS OBLIGATORIOS EN FIREBASE
1. Ve a Authentication > Sign-in method.
2. Habilita el proveedor "Correo electronico/contrasena".
3. Ve a Authentication > Settings > Authorized domains.
4. Agrega: gera1991823-design.github.io
5. Ve a Firestore Database > Rules.
6. Copia todo el contenido de firestore.rules y presiona Publicar.

COMO HABILITAR UN USUARIO
1. La persona crea su cuenta desde la aplicacion.
2. En Firestore aparecera la coleccion usuarios.
3. Abre el documento del usuario correspondiente.
4. Cambia el campo active de false a true.
5. La proxima vez que inicie sesion tendra acceso.

PUBLICACION EN GITHUB
1. Sube todos los archivos y la carpeta assets al repositorio LUBAYD-SA.
2. Reemplaza los archivos anteriores.
3. Haz Commit changes.
4. Espera entre 1 y 3 minutos.
5. Cierra completamente la app del celular y vuelve a abrirla.
6. Si aparece "Nueva version disponible", presiona Actualizar.

SEGURIDAD GPS
- La aplicacion no muestra campos editables de latitud o longitud.
- Una vez capturada, la ubicacion queda bloqueada dentro del formulario.
- Las reglas de Firestore rechazan cualquier actualizacion de un parte ya creado.
- El servidor registra la hora de creacion y la hora de captura mediante serverTimestamp.
- Como en cualquier aplicacion web, un dispositivo con software de falsificacion de GPS puede alterar la senal que entrega el sistema operativo. Para controles antifraude avanzados se requiere una app nativa con validaciones adicionales.
