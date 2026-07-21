# Cambios V20.6.1

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

- Caché `lubayd-forestal-v20.6.1.1-v20-1-offline`.
- `offline-store.js` incluido en el app shell.
- El Service Worker sigue funcionando aunque Firebase Messaging no cargue temporalmente.

## V20.6.1 — Visor de fotografías corregido

- Se agregó un límite de espera al consultar fotografías para evitar carga infinita.
- El visor espera a que la imagen termine de decodificarse antes de ocultar el indicador.
- Se detectan fotografías vacías, dañadas o con formato inválido.
- Firebase intenta primero el servidor y luego la caché local.
- Se limpia la imagen anterior cada vez que se abre el modal.
- Se actualizó la caché PWA para forzar la descarga de los archivos corregidos.
