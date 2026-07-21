# Cambios V20.6

## Diseño

- Se mantiene la interfaz completa de la V20.1.
- Se incluyen logos e iconos locales para evitar imágenes rotas.
- Los indicadores offline se integran en el estilo original.

## Asistencia

- Cola IndexedDB para foto, GPS, fecha y hora.
- PIN local protegido mediante PBKDF2 y SHA-256.
- Sincronización automática y manual.
- Estados sincronizada, pendiente y error.
- Hora de Uruguay mediante `America/Montevideo`.
- Hasta 7 días permitidos para sincronizar una marca capturada sin señal.

## Roles

- Operador: registra llegada y salida.
- Supervisor: solo visualiza.
- Administrador: visualiza, edita y elimina; no registra marcas.
- Firestore aplica la misma restricción de roles.

## PWA

- Caché `lubayd-forestal-v20.6.0-v20-1-offline`.
- `offline-store.js` incluido en el app shell.
- El Service Worker sigue funcionando aunque Firebase Messaging no cargue temporalmente.
