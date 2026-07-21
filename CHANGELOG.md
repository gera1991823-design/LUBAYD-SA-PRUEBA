# Lubayd SA V20.9.0

- El operador informa los litros que quedan según la fotografía.
- El consumo se calcula automáticamente contra la lectura anterior.
- Cada lectura de nivel exige foto, fecha y hora.
- Las nuevas cargas continúan sumándose al saldo y requieren comprobante.
- Se agrega un cuadro diario con saldo inicial, cargas, consumo, saldo final y fotos.
- Se agrega el movimiento `fuel_check` en la aplicación y en `syncFuelRecord`.
- Se mantiene compatibilidad con movimientos anteriores `fuel_usage`.
- La sincronización contempla movimientos recibidos fuera de orden desde distintos celulares mediante la fecha y hora de la lectura.
