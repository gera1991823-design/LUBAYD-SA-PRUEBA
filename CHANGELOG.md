# Cambios V20.4

## Diseño

- Recuperado el estilo oscuro y verde de la V19.
- Navegación y tarjetas optimizadas para celular y escritorio.
- Panel de asistencia administrativo simple por fecha y operador.

## Asistencia y roles

- El operador registra llegada y salida.
- El supervisor solo visualiza.
- El administrador solo visualiza, edita horarios o elimina.
- Los controles de marcación no se renderizan para administrador ni supervisor.
- Las reglas de Firestore también impiden que un administrador o supervisor cree marcas manualmente.

## Modo offline

- Nueva base local IndexedDB.
- Cola persistente de marcas y fotografías.
- PIN offline protegido con PBKDF2 y SHA-256.
- Sincronización automática y manual.
- Estados pendiente, sincronizando, sincronizado y error.
- Bloqueo de cierre de sesión si quedan marcas pendientes.

## Horarios

- Zona horaria fija `America/Montevideo` para visualizar fechas y horas.
- Conversión correcta de las horas editadas por administración.
- Registro de hora local de captura y recepción del servidor.
- Validación de salida posterior a entrada.

## PWA y push

- Caché nueva `lubayd-sa-v20.4.0-v19-offline`.
- Archivos HTML, CSS y JavaScript con estrategia network-first.
- Se conservan Firebase Cloud Messaging, VAPID y la función `notifyNewChatMessage`.
