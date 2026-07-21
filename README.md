# Lubayd SA V20.9.1 — Corrección de sincronización de combustible

Esta versión corrige el error **“El parte de combustible activo no existe”** que ocurría cuando la carga inicial había sido creada por un operador y las lecturas posteriores por otro usuario en el mismo celular.

## Comportamiento

1. Los registros se guardan primero en el celular.
2. La cola se ordena para enviar primero la carga inicial.
3. Luego se envían las cargas posteriores y las lecturas de nivel.
4. Cualquier operador activo conectado puede enviar la cola compartida del teléfono.
5. Cada documento conserva el usuario que realizó el registro y también el usuario que lo sincronizó.
6. Después de la confirmación del servidor, el administrador puede verlo desde la PC o cualquier otro dispositivo.

## Publicación

### GitHub

Subir todos los archivos interiores del ZIP completo a la raíz del repositorio y reemplazar los anteriores.

### Cloud Shell

Si GitHub contiene también la carpeta `functions` actualizada:

```bash
cd ~/LUBAYD-SA-PRUEBA
git pull origin main
grep -n "authenticated-shared-fuel" functions/index.js
npm --prefix functions install
firebase deploy --only "functions:syncFuelRecord" --project lubayd-sa
```

Si `grep` no muestra una línea, subir el ZIP `SOLO-FUNCTIONS` a Cloud Shell y ejecutar:

```bash
unzip -o ~/LUBAYD-SA-V20.9.1-SOLO-FUNCTIONS.zip -d ~/LUBAYD-SA-PRUEBA
cd ~/LUBAYD-SA-PRUEBA
grep -n "authenticated-shared-fuel" functions/index.js
npm --prefix functions install
firebase deploy --only "functions:syncFuelRecord" --project lubayd-sa
```

## Recuperación de registros pendientes

No desinstalar la PWA ni borrar sus datos.

1. Actualizar la aplicación a V20.9.1.
2. Iniciar sesión con cualquier operador activo en el celular que conserva los registros.
3. Abrir **Combustible**.
4. Pulsar **Sincronizar**.
5. Esperar a que los estados cambien a **Sincronizado**.
6. Abrir la aplicación en la PC como administrador y actualizar.
