# Lubayd SA V21.1.0 — sincronización, asistencia GPS y Safari

Aplicación web progresiva (PWA) para gestión forestal con Firebase, funcionamiento offline, partes, combustible, asistencia con fotografía/GPS y chat.

## Correcciones y mejoras

- **Sincronización de asistencia:** las marcas pueden autenticarse con la sesión Firebase del operador o con la credencial del teléfono offline.
- **Registros protegidos:** una marca no se elimina del teléfono hasta recibir confirmación del servidor.
- **Reintentos idempotentes:** si el servidor recibió la marca pero el celular perdió la respuesta, el próximo intento no duplica la llegada o salida.
- **GPS obligatorio:** llegada y salida exigen una ubicación válida antes de confirmar.
- **Reparación de marcas anteriores:** al tocar **Sincronizar ahora**, la app puede agregar GPS a registros antiguos que quedaron pendientes sin ubicación.
- **Interfaz simplificada:** una tarjeta de jornada muestra estado, hora, duración, coordenadas, precisión y acceso al mapa.
- **Safari/iPhone:** guía integrada para instalar la PWA en la pantalla de inicio y activar notificaciones desde el icono instalado.

## Publicación obligatoria

Subir solamente los archivos estáticos a GitHub Pages no actualiza la función que recibe las marcas. Para que la corrección de sincronización quede activa, publica también Firebase Functions y las reglas:

```bash
npm install -g firebase-tools
firebase login
cd functions
npm install
cd ..
firebase deploy --only functions,firestore:rules
```

Si la web se publica con Firebase Hosting:

```bash
firebase deploy --only hosting,functions,firestore:rules
```

Después de publicar:

1. Abrir la app con internet.
2. Pulsar **Actualizar aplicación** o recargar forzadamente.
3. Cerrar y volver a abrir la PWA instalada.
4. Entrar a **Asistencia** y probar una llegada.

## Prueba de llegada y salida

1. Iniciar sesión como operador.
2. Abrir **Asistencia**.
3. Tocar **Marcar llegada**.
4. Permitir cámara y ubicación precisa.
5. Tomar la fotografía.
6. Confirmar cuando aparezcan las coordenadas GPS.
7. Comprobar que la tarjeta muestre la ubicación y el estado **Sincronizada**.
8. Repetir con **Marcar salida**.

Si una marca queda pendiente, permanece guardada localmente. Al recuperar internet, tocar **Sincronizar ahora**.

## Notificaciones en iPhone

Requisitos:

- iOS/iPadOS 16.4 o posterior.
- Sitio publicado con HTTPS.
- Abrir la página en Safari.
- Safari → **Compartir** → **Agregar a pantalla de inicio**.
- Abrir Lubayd desde el icono instalado.
- Iniciar sesión y tocar **Activar notificaciones**.

El permiso se solicita únicamente después de una acción del usuario.
