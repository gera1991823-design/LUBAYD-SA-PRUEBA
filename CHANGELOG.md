# Cambios V20.7

## Acceso local

- El administrador puede preparar operadores en un dispositivo compartido.
- Los operadores ingresan sin internet usando nombre y PIN local.
- Ya no es obligatorio que cada operador haya iniciado sesión previamente con Firebase en ese teléfono.
- PIN protegido con PBKDF2 SHA-256 y bloqueo temporal después de intentos fallidos.

## Sesión

- Duración máxima de 60 minutos.
- Temporizador visible en la barra superior.
- Aviso visual durante los últimos cinco minutos.
- Cierre automático y retorno al login al vencer.
- Firebase Authentication cambia de persistencia LOCAL a SESSION y se aplica un vencimiento propio de una hora.

## Sincronización

- Nueva Function `syncOfflineAttendance`.
- Cada dispositivo recibe una credencial aleatoria protegida por hash en Firestore.
- Sincronización de marcas pendientes sin pedir al operador su contraseña de Firebase.
- Reintentos automáticos al recuperar internet.
- Validación de dispositivo, usuario, foto, GPS, fecha, hora y duplicados.

## Roles

- Operador: registra llegada y salida.
- Supervisor: solo visualiza.
- Administrador: visualiza, edita y elimina; no registra marcas.

## PWA

- Nueva caché `lubayd-forestal-v20.7.0-access-offline-1h`.
- Se mantiene el diseño, logos y estructura visual de la V20.1.
- Se conserva la corrección del visor de fotografías de la V20.6.1.
