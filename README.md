# Lubayd SA V20.5 — Diseño V20.1 + modo offline

Esta versión recupera la identidad visual de la línea V20.1/V20.2 y mantiene las mejoras funcionales de asistencia offline.

## Diseño restaurado

- Fondo claro y paneles blancos.
- Verde corporativo `#0b6b3a` y amarillo de marca.
- Logotipo completo Lubayd SA en acceso y barra lateral.
- Íconos oficiales de la PWA.
- Tarjetas, navegación lateral y barra inferior móvil del diseño V20.1.
- Vista de marcas simple con filtros, resumen y tarjetas por operador.

## Roles de asistencia

- **Operador:** registra llegada y salida con fotografía y GPS.
- **Supervisor:** únicamente visualiza las marcas.
- **Administrador:** visualiza, edita horarios y elimina registros. No registra llegada ni salida.

Las reglas de Firestore también limitan la creación de marcas al rol operador.

## Trabajo sin internet

1. El usuario instala la PWA e inicia sesión con internet al menos una vez.
2. En **Configuración**, crea un PIN offline de 4 a 6 números.
3. Sin conexión, abre la aplicación mediante el PIN.
4. Las marcas, fotografías, GPS y horarios quedan guardados en IndexedDB.
5. Cuando vuelve internet, inicia sesión normalmente y pulsa **Sincronizar ahora** si no comienza automáticamente.
6. El administrador podrá ver las marcas después de que el teléfono del operador termine la sincronización.

## Horarios

- La aplicación usa la zona horaria `America/Montevideo`.
- Las horas editadas por administración se interpretan como horario de Uruguay.
- La salida debe ser posterior a la entrada.
- Se conserva la hora de captura del teléfono y la hora de recepción del servidor.
- Conviene mantener fecha y hora automáticas activadas en cada celular.

## Publicación

1. Descomprime el ZIP.
2. Sube todo el contenido de la carpeta a la raíz del repositorio de GitHub Pages.
3. Reemplaza los archivos anteriores.
4. Publica `firestore.rules` en Firebase.
5. Elimina la PWA anterior del celular e instálala nuevamente.
6. Inicia sesión online y configura nuevamente el PIN offline.

## Prueba recomendada

1. Inicia sesión como operador con internet.
2. Configura el PIN offline.
3. Activa modo avión.
4. Accede mediante el PIN y registra llegada y salida.
5. Recupera internet e inicia sesión normal.
6. Sincroniza.
7. Desde el administrador, comprueba que puede visualizar, editar y eliminar, pero no marcar.

## Colecciones utilizadas

- `usuarios`
- `partes`
- `asistencias`
- `asistencia_fotos`
- `asistencia_auditoria`
- `chats`
- `push_tokens`

No es necesario crear las colecciones manualmente.
