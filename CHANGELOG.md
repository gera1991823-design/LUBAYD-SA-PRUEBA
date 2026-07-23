# Lubayd SA V20.8.8

## Parte único de combustible

- Nueva sección **Combustible** para operadores, supervisores y administradores.
- Solo puede existir una carga activa a la vez.
- La carga inicial registra litros totales, fecha, hora, observaciones y comprobante fotográfico obligatorio.
- Cada consumo diario registra litros utilizados, fecha, hora, operador, observaciones y foto obligatoria.
- El saldo restante se calcula en el servidor dentro de una transacción para evitar diferencias entre celulares.
- Cuando el saldo llega a cero, el parte se cierra y pasa al historial.
- Todos los usuarios activos pueden consultar la carga y los movimientos; solo los operadores registran datos.
- Los registros y fotografías se guardan localmente sin conexión y se sincronizan al recuperar internet.
- Nueva Cloud Function `syncFuelRecord`.
- Nuevas colecciones Firestore: `combustible_cargas`, `combustible_movimientos` y `combustible_estado`.
- IndexedDB actualizado a versión 4 con caché y cola específicas de combustible.
