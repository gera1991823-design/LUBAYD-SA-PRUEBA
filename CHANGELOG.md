# Lubayd SA V20.9.2

- El administrador y supervisor muestran únicamente combustible confirmado por el servidor.
- Se agregó `getFuelState` para consultar Firestore con autenticación y confirmar los documentos.
- Un registro no sale de la cola hasta que el servidor devuelve el mismo ID.
- Los registros locales marcados como sincronizados pero ausentes en Firestore se reconstruyen y reintentan automáticamente en el teléfono del operador que los creó.
- Se evita que datos antiguos de IndexedDB de una PC aparezcan como si fueran datos compartidos.
