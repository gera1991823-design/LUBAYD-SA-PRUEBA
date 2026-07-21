# Cambios V20.8.4

- Un mismo operador puede trabajar desde varios celulares.
- Cada teléfono se autoriza con su propio `deviceId`; autorizar un teléfono nuevo no reemplaza al anterior.
- El teléfono se autoriza automáticamente cuando el operador inicia sesión online.
- Al guardar el PIN offline, la autorización del teléfono se actualiza en Firebase.
- Cuando un administrador prepara un operador en un teléfono nuevo, el dispositivo se habilita automáticamente.
- Los partes y marcas pendientes se sincronizan desde el mismo teléfono donde fueron creados.
- Se conserva IndexedDB y no se eliminan las colas pendientes de versiones anteriores.
