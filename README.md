# Lubayd SA V20.8 — Offline completo

Esta versión mantiene el diseño V20.1 y permite al operador trabajar sin conexión en:

- Inicio y métricas locales.
- Nuevo parte diario.
- Historial y detalle de partes.
- Gráficos calculados con datos del dispositivo.
- Ubicaciones de partes que tengan GPS.
- Asistencia con fotografía.

Los partes y marcas quedan en cola y se envían cuando vuelve internet.

## Backend requerido

Despliega estas Functions:

```bash
firebase deploy --only functions:syncOfflineAttendance,functions:syncOfflinePart --project lubayd-sa
```

Y las reglas:

```bash
firebase deploy --only firestore:rules --project lubayd-sa
```

## Prueba

1. Instala la PWA y prepara el dispositivo desde el administrador.
2. Activa modo avión.
3. Ingresa con PIN.
4. Crea un parte y revisa Historial.
5. Registra asistencia. La cámara debe mostrar imagen; si el GPS no responde, permite guardar como Sin GPS.
6. Recupera internet y espera la sincronización.
