# Lubayd SA V20.9.0 — Control de combustible por lecturas

Esta versión registra el combustible como un saldo físico comprobado mediante fotografías.

## Funcionamiento

1. El operador inicia el control indicando la carga inicial y adjuntando una foto.
2. En cada control posterior escribe **cuántos litros quedan**, no cuántos utilizó.
3. La aplicación calcula automáticamente el consumo desde la lectura anterior.
4. Cuando llega combustible, se usa **Agregar combustible**. La carga se suma al saldo anterior y exige foto.
5. El cuadro diario muestra saldo inicial, cargas, consumo calculado, saldo final y cantidad de fotos.

### Ejemplo

- Carga inicial: 150 L → saldo 150 L.
- Lectura con foto: quedan 130 L → consumo calculado 20 L.
- Lectura posterior: quedan 30 L → consumo calculado 100 L.
- Nueva carga: +60 L → saldo actualizado 90 L.

## Modo offline

Las cargas, lecturas y fotos quedan guardadas en IndexedDB. Al recuperar internet, la cola se sincroniza mediante `syncFuelRecord`. La Function mantiene compatibilidad con movimientos antiguos `fuel_usage` y utiliza `fuel_check` para las nuevas lecturas.

## Publicación

1. Subir todos los archivos interiores del ZIP completo a la raíz de GitHub.
2. En Cloud Shell:

```bash
cd ~/LUBAYD-SA-PRUEBA
git pull origin main
npm --prefix functions install
firebase deploy --only "functions:syncFuelRecord" --project lubayd-sa
```

No es necesario modificar las reglas de Firestore respecto de V20.8.9.

## Actualización del celular

No borrar la PWA si tiene registros pendientes. Abrirla con internet, entrar en **Más → Configuración → Actualizar aplicación**, cerrarla completamente y volver a abrirla. Confirmar que muestre **Versión 20.9.0**.
