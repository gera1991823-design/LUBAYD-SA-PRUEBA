# Lubayd SA V20.8.9

- El parte de combustible pasa a ser un control continuo y acumulativo.
- Se agrega el formulario **Agregar combustible** dentro del parte activo.
- Las nuevas cargas suman al saldo existente en lugar de crear otro parte.
- El saldo ya no se cierra automáticamente al llegar a cero.
- Se muestran total cargado, última carga, total utilizado y saldo actual.
- El listado diferencia cargas (+) y consumos (-).
- Cada nueva carga exige comprobante, fecha y hora.
- Las cargas adicionales funcionan offline y se sincronizan con `syncFuelRecord`.
- La Cloud Function actualiza el saldo mediante transacciones de Firestore.
- Los registros cerrados por versiones anteriores se pueden reactivar con la próxima carga.
