# Lubayd SA V21.0

## Combustible

- Nuevo modelo Proveedor → Tanque → Tráiler → Máquinas.
- Saldo independiente del tanque general y del tráiler.
- Acumulado de litros entregados por máquina.
- Resumen por día y filtro de fecha.
- Foto obligatoria en todos los movimientos.
- Movimientos offline con sincronización transaccional.
- Nuevo diseño con tarjetas, acciones rápidas, gráfico y comprobantes.
- Máquinas obtenidas del catálogo administrativo y almacenadas para uso offline.

## Firebase

- Nuevas colecciones `combustible_flujo_estado`, `combustible_flujo_movimientos` y `combustible_flujo_fotos`.
- Nuevas Functions `syncFuelFlowRecord` y `getFuelFlowState`.
- Runtime de Functions actualizado a Node.js 22.
- Reglas de lectura para usuarios activos; las escrituras se realizan únicamente mediante Functions.

## PWA

- Caché `lubayd-forestal-v21.0.0-fuel-flow`.
- Inputs móviles de 16 px para reducir zoom involuntario.
- Diseño adaptado a iPhone, Android y escritorio.
