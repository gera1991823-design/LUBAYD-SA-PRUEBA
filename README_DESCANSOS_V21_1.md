# Lubayd SA V21.1.0 - Control de descansos

## Operador
- Inicio de descanso con foto, GPS y hora.
- Fin de descanso con foto, GPS y hora.
- Duración automática.
- Funcionamiento offline y sincronización posterior.

## Administrador / supervisor
- Vista separada y simplificada.
- Filtro por fecha y búsqueda por operador.
- Inicio, fin, duración, estado, ubicación y fotografías.
- Administrador: editar y eliminar con auditoría.
- Supervisor: solo lectura.

No se agregaron resumen del día, actividad reciente ni porcentaje de cumplimiento.

La estructura de datos continúa usando los campos internos entry/exit para mantener compatibilidad con Firebase y no requiere nuevas Cloud Functions.
