# Lubayd SA - Rediseño de Combustible V21.2.1

Este paquete agrega el nuevo diseño responsive para PC y celular y corrige el problema visual por el que el botón **Guardar movimiento** podía quedar debajo de otra capa y no recibir el toque.

## Archivo nuevo

- `fuel-redesign.css`

## Publicación

1. Subir `fuel-redesign.css` a la raíz del repositorio.
2. Abrir `index.html` en GitHub.
3. Localizar la línea que carga `fuel.css`.
4. Inmediatamente después agregar:

```html
<link rel="stylesheet" href="./fuel-redesign.css?v=21.2.1">
```

5. Cambiar la versión de `fuel.js` para forzar actualización del navegador:

```html
<script src="./fuel.js?v=21.2.1"></script>
```

6. Hacer commit y esperar a que GitHub Pages termine.
7. En el celular: Más → Configuración → Actualizar aplicación; cerrar y abrir la PWA.

## Importante

- No reemplaza `fuel.js`.
- No modifica Firebase, Functions ni Firestore.
- No elimina datos pendientes.
- El modal queda por encima de la barra inferior y el botón Guardar vuelve a recibir clic/toque.

## Comprobación

1. Entrar como operador.
2. Combustible → Abastecer máquina.
3. Seleccionar máquina, litros, fecha, hora y foto.
4. Pulsar Guardar movimiento.
5. Debe cerrar el modal y mostrar el movimiento como pendiente o sincronizado.
