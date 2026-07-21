# Lubayd SA V20.8.7

- Compatibilidad específica para Android, Redmi y MIUI.
- La sincronización ya no depende exclusivamente de `navigator.onLine`.
- Reintentos al abrir, volver al primer plano, recuperar foco y cada 15 segundos.
- Los partes solo se marcan sincronizados después de confirmación del servidor.
- Recuperación de IndexedDB cuando Android bloquea temporalmente la base local.
- La vista y el desplazamiento se conservan también en `localStorage`.
- Actualización de PWA reforzada para evitar versiones antiguas en caché.
- Ajustes de ancho, inputs y zoom accidental en Android.
