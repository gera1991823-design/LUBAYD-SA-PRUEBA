# Lubayd SA · Plataforma Operativa V22.0.0

Aplicación web progresiva (PWA) responsive para celular y computadora, diseñada con la identidad visual y el logo oficial entregado por Lubayd SA.

## Funcionalidades incluidas

- Inicio de sesión online y offline con correo y contraseña.
- Sin pantalla “Recuperando tu sesión”.
- Asistencia: ingreso y salida con hora, fotografía y ubicación GPS.
- Descansos: inicio y finalización con hora, fotografía y ubicación GPS.
- Combustible: proveedor → tanque principal → tráiler → máquina.
- Parte diario: máquina, monte/lote, horómetros, producción, combustible, tarea, foto, GPS y firma digital.
- IndexedDB para guardar todo en el dispositivo sin conexión.
- Sincronización automática al recuperar internet y botón de sincronización manual.
- Roles:
  - Administrador: puede editar, eliminar, habilitar usuarios y gestionar catálogos.
  - Operador: puede agregar información, pero no editar ni eliminar registros.
- Diseño responsive equivalente para escritorio y celular.
- PWA instalable con service worker y caché offline.

## Estructura

- `index.html`: interfaz responsive.
- `styles.css`: diseño Lubayd SA.
- `auth.js`: autenticación online y offline.
- `offline-db.js`: IndexedDB, credenciales locales y cola de sincronización.
- `attendance.js`: ingreso y salida.
- `breaks.js`: descansos.
- `fuel.js`: flujo de combustible.
- `parts.js`: partes con foto, GPS y firma.
- `admin.js`: usuarios, catálogos y edición/eliminación de registros.
- `functions/index.js`: Cloud Functions.
- `firestore.rules`: permisos de Firestore.
- `service-worker.js`: funcionamiento PWA offline.

## Seguridad de roles

Los botones de edición y eliminación no se muestran a operadores. Además, las reglas de Firestore bloquean las modificaciones directas de operadores, por lo que la restricción no depende únicamente de la interfaz.

## Requisito para el acceso offline

Cada operador debe iniciar sesión con internet al menos una vez en cada teléfono. En ese ingreso se guarda un verificador cifrado de la contraseña y se autoriza el dispositivo. La contraseña no se guarda como texto.
