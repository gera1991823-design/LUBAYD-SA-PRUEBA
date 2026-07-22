# Lubayd SA V21.0 — Tanque general, tráiler y máquinas

Esta versión reemplaza el antiguo “parte único” por un control de flujo completo:

**Proveedor → Tanque general → Tráiler → Máquinas**

## Funcionamiento

1. Cuando llega combustible, el operador registra **Ingreso al tanque**. La cantidad se suma al saldo del tanque general.
2. Cuando se llena el tráiler, registra **Cargar tráiler**. La cantidad se descuenta del tanque y se suma al tráiler.
3. Cuando el tráiler abastece una máquina, registra **Abastecer máquina**. La cantidad se descuenta del tráiler y se acumula en el equipo seleccionado.
4. Cada movimiento exige fecha, hora, litros, operador y fotografía.

Ejemplo:

- Ingreso al tanque: 9.000 L.
- Carga al tráiler: 1.500 L.
- Cosechadora: 500 L.
- Forwarder: 300 L.
- Tractor: 200 L.

Resultado:

- Tanque: 7.500 L.
- Tráiler: 500 L.
- Total entregado a máquinas: 1.000 L.
- Cosechadora: 500 L.
- Forwarder: 300 L.
- Tractor: 200 L.

## Diseño

La pantalla incluye:

- saldo del tanque general;
- saldo del tráiler;
- combustible acumulado por máquina;
- resumen de movimientos del día;
- filtro por fecha y tipo;
- gráfico de distribución por máquina;
- estado actual del flujo;
- comprobantes recientes;
- formularios simplificados en una ventana móvil.

## Máquinas

El módulo utiliza el catálogo existente de **Administración → Máquinas**. Conviene crear las tres máquinas reales allí antes de comenzar.

Si un teléfono queda sin internet, utilizará la última lista de máquinas descargada. Si nunca descargó el catálogo, se muestran temporalmente “Máquina 1”, “Máquina 2” y “Máquina 3”.

## Trabajo sin conexión

Los movimientos se guardan primero en IndexedDB:

- `fuel_flow_state`
- `fuel_flow_movements`
- `fuel_flow_queue`

Cuando vuelve internet, la aplicación envía los registros en orden cronológico. La Function valida los saldos dentro de una transacción para impedir que se retire más combustible del disponible.

El administrador y el supervisor solo visualizan. Los operadores registran movimientos.

## Datos anteriores

V21.0 utiliza colecciones nuevas y no mezcla los registros de prueba de V20.9 con el nuevo flujo. Los datos anteriores permanecen en Firebase, pero el nuevo control comienza en **0 L**.

Para comenzar, registra como primer movimiento la cantidad real existente en el tanque general. Por ejemplo: **9.000 L**.

## Colecciones nuevas

- `combustible_flujo_estado`
- `combustible_flujo_movimientos`
- `combustible_flujo_fotos`

## Functions nuevas

- `syncFuelFlowRecord`
- `getFuelFlowState`

Las Functions anteriores se conservan para compatibilidad.

## Publicación en GitHub

1. Descomprime el ZIP completo.
2. Sube todos los archivos interiores a la raíz del repositorio.
3. Reemplaza los archivos anteriores.
4. Espera a que GitHub Pages finalice el despliegue.

## Publicación en Firebase desde Cloud Shell

Después de actualizar GitHub:

```bash
cd ~/LUBAYD-SA-PRUEBA
git pull origin main
npm --prefix functions install
firebase deploy --only "functions:syncFuelFlowRecord,functions:getFuelFlowState" --project lubayd-sa
firebase deploy --only firestore:rules --project lubayd-sa
```

Verifica:

```bash
firebase functions:list --project lubayd-sa
```

Deben aparecer:

```text
syncFuelFlowRecord
getFuelFlowState
```

Si `git pull` no actualiza `functions/index.js`, sube el ZIP **SOLO-FUNCTIONS** a Cloud Shell y descomprímelo sobre `~/LUBAYD-SA-PRUEBA`.

## Actualización de celulares

1. Abre la PWA con internet.
2. Entra en **Más → Configuración → Actualizar aplicación**.
3. Cierra completamente la PWA.
4. Vuelve a abrirla.
5. Comprueba que indique **V21.0.0**.

No borres la PWA si tiene partes, asistencia o movimientos pendientes.

## Prueba recomendada

1. Registra 9.000 L como ingreso al tanque, con foto.
2. Registra 1.500 L como carga al tráiler, con foto.
3. Entrega 500 L a la primera máquina.
4. Entrega 300 L a la segunda.
5. Entrega 200 L a la tercera.
6. Confirma tanque 7.500 L y tráiler 500 L.
7. Abre la cuenta administradora en otro dispositivo y comprueba los mismos saldos.
8. Repite una entrega sin conexión y verifica la sincronización al recuperar internet.
