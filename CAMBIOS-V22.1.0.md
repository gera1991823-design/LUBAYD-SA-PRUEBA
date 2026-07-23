# Lubayd SA V22.1.0 — Corrección integral de GPS, fotografías y guardado

## Problemas corregidos

- El registro de llegada ya no abre la cámara y el GPS al mismo tiempo.
- Se eliminó el estado indefinido de “cargando” durante la llegada, salida y descansos.
- Las fotografías se reducen antes de almacenarse para evitar cierres de la PWA por falta de memoria.
- La ubicación se obtiene en un paso visible, con precisión, coordenadas y botón para reintentar.
- La llegada, salida y descansos utilizan una ventana de evidencia con dos pasos: GPS y fotografía.
- El logo oficial de Lubayd SA aparece en el encabezado principal, también en celular.
- Combustible y parte diario muestran la ubicación antes de guardar.
- Los formularios de combustible y parte diario conservan un borrador local.
- Las fotografías, GPS y firma del parte se conservan como borrador en IndexedDB.
- Los registros se guardan primero en IndexedDB y luego se intenta sincronizar.
- El guardado de registro y cola pendiente se realiza en una única transacción local.
- Si falla un movimiento de combustible, el saldo local vuelve al valor anterior.
- Se agregó una prueba de GPS en “Modo sin conexión”.
- El servidor valida las coordenadas y exige fotografía/GPS en los registros operativos.

## Flujo nuevo de asistencia

1. El operador toca **Ingreso**, **Salida**, **Iniciar descanso** o **Finalizar descanso**.
2. La aplicación abre la ventana de evidencia.
3. Obtiene el GPS y muestra coordenadas y precisión.
4. El operador toma la fotografía.
5. La aplicación comprime la imagen y muestra una vista previa.
6. Al confirmar, el registro queda guardado en el teléfono.
7. Si existe internet, la sincronización comienza en segundo plano.

La pantalla no queda bloqueada esperando simultáneamente la cámara y el GPS.

## Importante

La ubicación y la cámara deben estar permitidas para el sitio de Lubayd SA. La aplicación no puede omitir un permiso bloqueado por Android, iPhone o el navegador.
