# Publicación de Lubayd SA V22.1.0

## 1. Respaldo

Antes de reemplazar archivos, descargá una copia del repositorio actual. No borres los datos del sitio ni desinstales la PWA si existen registros pendientes.

## 2. Subir el proyecto a GitHub

1. Descomprimí el ZIP.
2. Abrí la carpeta del proyecto.
3. Subí a GitHub **todo el contenido interior**.
4. `index.html`, `service-worker.js`, `firebase.json`, `firestore.rules` y la carpeta `functions` deben quedar en la raíz.
5. Reemplazá los archivos anteriores y confirmá el commit en `main`.
6. Esperá a que GitHub Pages termine de publicar.

No subas el ZIP ni la carpeta contenedora como una subcarpeta adicional.

## 3. Actualizar Cloud Shell

```bash
cd ~/LUBAYD-SA-PRUEBA
git pull origin main
npm --prefix functions install
node --check functions/index.js
```

Usá el nombre real de la carpeta si es diferente.

## 4. Desplegar Functions y reglas

```bash
firebase deploy --only functions,firestore:rules --project lubayd-sa
firebase functions:list --project lubayd-sa
```

Deben aparecer:

- `authorizeOfflineDevice`
- `syncOfflineRecord`
- `getFuelFlowState`
- `adminManageRecord`
- `notifyNewChatMessage`

La región debe ser `southamerica-east1`.

## 5. Actualizar cada celular

Cuando GitHub Pages termine de publicar, abrir con internet:

```text
https://TU-USUARIO.github.io/TU-REPOSITORIO/reset.html
```

Pulsar **Limpiar caché y abrir la aplicación**.

Esta herramienta elimina cachés y service workers anteriores, pero conserva IndexedDB y los registros pendientes.

## 6. Permisos del teléfono

Antes de probar:

- Activar la ubicación/GPS del teléfono.
- Permitir ubicación para el navegador o la PWA de Lubayd SA.
- Permitir cámara o fotografías.
- Desactivar el ahorro de batería extremo durante la prueba del GPS.

Dentro de Lubayd SA entrar en **Modo sin conexión → Probar ubicación GPS**. Debe mostrar coordenadas y precisión.

## 7. Preparar el acceso offline

1. Abrir Lubayd SA con internet.
2. Iniciar sesión con el usuario del operador.
3. Entrar en **Modo sin conexión**.
4. Confirmar:
   - Perfil descargado: Sí.
   - Contraseña protegida: Sí.
   - Teléfono autorizado: Sí.
   - IndexedDB disponible: Sí.
5. Cerrar sesión.
6. Activar modo avión.
7. Abrir la aplicación e ingresar con el mismo correo y contraseña.

## 8. Prueba funcional recomendada

### Asistencia

1. Tocar **Ingreso**.
2. Esperar a que aparezcan coordenadas y precisión.
3. Tomar la fotografía.
4. Confirmar el registro.
5. Verificar que aparezca en el historial con foto y GPS.

### Combustible

1. Completar movimiento y litros.
2. Tomar fotografía.
3. Pulsar **Obtener GPS**.
4. Guardar.
5. Verificar el movimiento pendiente o sincronizado.

### Parte diario

1. Completar el formulario.
2. Tomar fotografía.
3. Pulsar **Obtener GPS**.
4. Firmar en el recuadro.
5. Guardar.

### Sin conexión

1. Activar modo avión.
2. Crear un registro de cada módulo.
3. Cerrar y volver a abrir Lubayd SA.
4. Confirmar que los registros permanecen.
5. Recuperar internet y pulsar **Sincronizar ahora**.
6. Verificar los registros desde la cuenta administradora.

## Importante

La prueba final de cámara, permisos y GPS debe realizarse en los teléfonos reales que utilizarán los operadores. Los navegadores y sistemas operativos pueden bloquear estos recursos si el usuario negó el permiso previamente.
