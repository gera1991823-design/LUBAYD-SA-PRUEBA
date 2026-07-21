# Lubayd SA V20.9.1

## Sincronización de combustible corregida

- La cola de combustible ahora se procesa como un control compartido del dispositivo, no solamente para el usuario que está conectado en ese momento.
- Las operaciones se envían en orden: carga inicial, cargas adicionales y lecturas/consumos.
- Cualquier operador activo conectado puede sincronizar los registros pendientes creados por otro operador en el mismo celular.
- La Function conserva el operador que realizó cada registro y guarda también quién efectuó la sincronización.
- Si una lectura llega al servidor antes que su carga inicial, la Function puede reconstruir la carga inicial desde la copia local validada y luego aplicar el movimiento.
- Se mantienen los identificadores de cada operación para evitar duplicados al reintentar.
- El administrador y el supervisor continúan siendo solo de consulta para el módulo de combustible.
