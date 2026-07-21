# Lubayd SA V20.8.9 — Saldo acumulado de combustible

Esta versión cambia el módulo de combustible para trabajar como un único control continuo de existencias.

## Funcionamiento

El saldo se calcula siempre así:

`Saldo actual = total de cargas acumuladas - total de consumos acumulados`

Ejemplo:

- Saldo inicial: 150 L
- Consumo: 130 L
- Saldo: 20 L
- Nueva carga: 180 L
- Nuevo saldo: 200 L

## Movimientos admitidos

1. **Saldo inicial:** se registra solamente cuando todavía no existe ningún control.
2. **Nueva carga:** suma litros al saldo actual.
3. **Consumo:** descuenta litros del saldo actual.

Cada movimiento exige:

- fecha;
- hora;
- operador;
- fotografía del comprobante;
- observaciones opcionales.

La pantalla muestra:

- total cargado acumulado;
- última carga;
- total utilizado;
- saldo actual;
- historial cronológico de cargas y consumos.

El control no se cierra cuando llega a 0 L. La próxima carga vuelve a aumentar el mismo saldo.

## Modo offline

Las cargas, consumos y fotografías se guardan en IndexedDB. Cuando vuelve internet se sincronizan mediante `syncFuelRecord`. El servidor recalcula el saldo dentro de una transacción para evitar diferencias entre teléfonos.

No se debe desinstalar la PWA ni borrar sus datos mientras existan movimientos pendientes.

## Publicación

Después de subir todos los archivos a GitHub:

```bash
cd ~/LUBAYD-SA-PRUEBA
git pull origin main
npm --prefix functions install
firebase deploy --only "functions:syncFuelRecord" --project lubayd-sa
```

Las reglas de Firestore no cambian respecto a la V20.8.8.

## Prueba recomendada

1. Comprobar que la aplicación indique V20.8.9.
2. Registrar un saldo inicial de 150 L con foto.
3. Registrar un consumo de 130 L con foto: el saldo debe ser 20 L.
4. Registrar una nueva carga de 180 L con foto: el saldo debe ser 200 L.
5. Confirmar que la parte superior muestre total cargado 330 L, utilizado 130 L y saldo actual 200 L.
6. Repetir una carga o consumo sin conexión y verificar que se sincronice al recuperar internet.
