# Cambios V20.8.3

- El bloque **Acceso sin conexión** queda siempre visible en la pantalla de ingreso.
- Reintenta la lectura de IndexedDB al abrir, volver a la app y cambiar la conexión.
- Agrega el botón **Actualizar usuarios offline**.
- Si no existen perfiles con PIN, muestra el motivo y los pasos para prepararlos en vez de ocultar la opción.
- Conserva la base IndexedDB y las colas pendientes de V20.8.2.
- No requiere cambios en Cloud Functions ni en reglas de Firestore.
