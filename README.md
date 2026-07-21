# Lubayd SA V20.9.2 — Combustible confirmado por servidor

Esta versión corrige la diferencia entre celular, PC normal y ventana de incógnito.

## Comportamiento

- El celular conserva los registros offline.
- Al volver internet, `syncFuelRecord` los guarda en Firestore.
- `getFuelState` comprueba que el ID exista realmente en Firestore.
- La cola local solo se elimina después de esa confirmación.
- Administración y supervisión ven únicamente registros confirmados por el servidor, no copias antiguas de IndexedDB.
- Si una versión anterior dejó un registro como “Sincronizado” solo en el teléfono, V20.9.2 lo vuelve a poner en cola y lo recupera.

## Despliegue

```bash
cd ~/LUBAYD-SA-PRUEBA
npm --prefix functions install
firebase deploy --only "functions:syncFuelRecord,functions:getFuelState" --project lubayd-sa
```

No borres la PWA del teléfono que contiene el combustible hasta comprobarlo desde una ventana de incógnito o desde la PC administrativa.
