# Lubayd SA · Plataforma Operativa V22.1.0

Aplicación web progresiva (PWA) responsive para celular y computadora, con la identidad visual y el logo oficial de Lubayd SA.

## Módulos

- Inicio de sesión online y offline con correo y contraseña.
- Asistencia: ingreso y salida con hora, fotografía y ubicación GPS.
- Descansos: inicio y finalización con hora, fotografía y ubicación GPS.
- Combustible: proveedor → tanque principal → tráiler → máquina.
- Parte diario: máquina, monte/lote, horómetros, producción, combustible, tarea, fotografía, GPS y firma digital.
- Administración de usuarios, roles, máquinas, montes y registros.
- Chat y notificaciones cuando existe conexión.

## Mejoras de V22.1.0

- Captura guiada de GPS y fotografía para asistencia y descansos.
- Compresión de imágenes optimizada para evitar cierres en celulares.
- Coordenadas y precisión visibles antes y después del guardado.
- Borradores locales para combustible y partes diarios.
- Guardado atómico en IndexedDB antes de sincronizar.
- Prueba de GPS desde la configuración.
- Logo oficial visible en el encabezado principal y en el menú.
- Validación de GPS y evidencias en Cloud Functions.

## Funcionamiento offline

Los registros se guardan primero en IndexedDB. Cuando vuelve internet, la aplicación intenta sincronizarlos automáticamente; también existe un botón de sincronización manual.

Cada operador debe iniciar sesión con internet al menos una vez en cada teléfono para preparar el acceso offline y autorizar el dispositivo. La contraseña no se guarda en texto: se almacena un verificador criptográfico local.

## Roles

- **Administrador:** puede agregar, editar, eliminar, gestionar usuarios y catálogos.
- **Supervisor:** puede consultar información y registrar operaciones según la interfaz habilitada.
- **Operador:** puede agregar información, pero no editar ni eliminar registros existentes.

## Archivos principales

- `index.html`: interfaz responsive.
- `styles.css`: diseño y estilos corporativos.
- `core.js`: GPS, procesamiento de fotografías y utilidades.
- `evidence.js`: captura guiada de GPS y fotografía.
- `offline-db.js`: IndexedDB, credenciales y cola offline.
- `data.js`: guardado local y sincronización.
- `attendance.js`: ingreso y salida.
- `breaks.js`: descansos.
- `fuel.js`: flujo de combustible.
- `parts.js`: partes diarios, fotografía, GPS y firma.
- `admin.js`: administración.
- `functions/index.js`: Cloud Functions.
- `firestore.rules`: reglas de seguridad.
- `service-worker.js`: caché y funcionamiento PWA.
