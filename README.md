# Lubayd SA V20.8.2 — sincronización de partes corregida

Mantiene el diseño V20.1, el modo offline completo y la sesión de una hora.

## Corrección principal

Los partes creados sin conexión ahora se procesan automáticamente cuando:

- vuelve internet;
- el operador inicia sesión online;
- Firebase termina de inicializarse;
- se pulsa **Sincronizar ahora**.

Cuando el mismo operador inicia sesión online, la aplicación intenta guardar el parte directamente en Firestore. Si eso falla, utiliza `syncOfflinePart` como respaldo.

## Backend requerido

```bash
firebase deploy --only functions:syncOfflineAttendance,functions:syncOfflinePart --project lubayd-sa
firebase deploy --only firestore:rules --project lubayd-sa
```

Verifica:

```bash
firebase functions:list --project lubayd-sa
```

Deben aparecer:

- `notifyNewChatMessage`
- `syncOfflineAttendance`
- `syncOfflinePart`

## Recuperar un parte que ya está pendiente

1. Publica V20.8.2 en GitHub.
2. Actualiza o reinstala la PWA.
3. Con internet, inicia sesión con el mismo operador que creó el parte.
4. Espera entre 5 y 10 segundos.
5. Abre **Historial**. El estado debe cambiar a **Sincronizado**.
6. En el administrador, abre Historial y actualiza.

Si aparece **Error al sincronizar**, pulsa **Sincronizar ahora** y revisa el mensaje mostrado.
