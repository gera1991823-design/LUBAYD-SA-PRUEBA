# Cambios V20.5

## Identidad visual

- Restaurado el diseño claro, verde y amarillo de la V20.1.
- Restaurados el logotipo Lubayd SA y los íconos corporativos originales.
- Restauradas las tarjetas blancas, barra lateral y navegación móvil.
- Los componentes offline se integraron sin cambiar la identidad visual.

## Asistencia y roles

- Operador: registra llegada y salida.
- Supervisor: solo visualiza.
- Administrador: visualiza, edita horarios y elimina; no realiza marcas.
- Auditoría obligatoria al editar o eliminar.

## Offline

- PIN local protegido con PBKDF2.
- Cola IndexedDB para fotografía, GPS y horarios.
- Sincronización automática y manual.
- Bloqueo de cierre de sesión online con marcas pendientes.

## Horarios

- Zona horaria fija `America/Montevideo`.
- Conversión correcta de horas editadas.
- Validación de salida posterior a entrada.

## PWA

- Caché nueva `lubayd-sa-v20.5.1-v20-1-offline`.
- Se mantienen Firebase Cloud Messaging, VAPID y `notifyNewChatMessage`.
