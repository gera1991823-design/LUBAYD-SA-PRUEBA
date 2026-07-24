# Lubayd SA V21.0.1 — Corrección IndexedDB

Esta compilación corrige el acceso al almacenamiento offline cuando el dispositivo ya tenía creada la base local en la versión 5. La aplicación migra a la versión 6 sin borrar los datos existentes.

## Después de publicar

1. Reemplazar todos los archivos del sitio con los incluidos en este paquete.
2. Abrir la aplicación con internet y recargar una vez.
3. Si está instalada como PWA, cerrarla por completo y volver a abrirla para activar la caché V21.0.1.

# Lubayd SA V20.8.8 — Parte único de combustible

Esta versión agrega un control acumulativo de combustible independiente del parte diario forestal.

## Funcionamiento

1. Cuando no existe una carga activa, un operador registra los litros totales cargados y adjunta el comprobante inicial.
2. Mientras exista saldo, cualquier operador activo puede agregar consumos diarios.
3. Cada consumo exige una foto, fecha, hora y litros utilizados.
4. El servidor calcula el saldo restante de forma transaccional, incluso si varios teléfonos sincronizan al mismo tiempo.
5. Al llegar a cero litros, el parte se cierra y pasa al historial.
6. Administradores y supervisores pueden consultar la carga, todos los movimientos y las fotografías.

## Modo offline

- La carga o el consumo se guarda primero en IndexedDB.
- La fotografía se comprime antes de almacenarse.
- Al recuperar internet, la aplicación intenta sincronizar automáticamente.
- También se puede pulsar **Combustible → Sincronizar**.
- No desinstalar la PWA ni borrar sus datos mientras existan registros pendientes.

## Despliegue

Después de subir todos los archivos a GitHub, desplegar:

```bash
cd ~/LUBAYD-SA-PRUEBA
git pull origin main
npm --prefix functions install
firebase deploy --only "functions:syncFuelRecord" --project lubayd-sa
firebase deploy --only firestore:rules --project lubayd-sa
```

Verificar:

```bash
firebase functions:list --project lubayd-sa
```

Debe aparecer `syncFuelRecord` junto con las Functions existentes.

## Prueba recomendada

1. Abrir la V20.8.8 con internet en un operador.
2. Entrar a **Combustible** y crear una carga de 1500 L con foto.
3. Desactivar internet y registrar un consumo de 500 L con foto.
4. Confirmar que el saldo local muestre 1000 L y el movimiento figure pendiente.
5. Recuperar internet y esperar la sincronización.
6. Registrar otro consumo de 300 L desde otro teléfono preparado.
7. Confirmar en administración que el saldo final sea 700 L y que se vean ambas fotos.
