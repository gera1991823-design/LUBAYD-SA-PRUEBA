# UBAYD SA - Sistema de Partes y Control Operativo

Aplicación web progresiva (PWA) para:

- Inicio de sesión y creación de usuarios.
- Uso en línea y sin conexión.
- Parte diario basado en el formulario físico entregado.
- Registro de combustible.
- Inicio y fin de descansos.
- Captura de ubicación y fotografía.
- Firma del encargado en el parte.
- Sincronización con Firebase.
- Panel de administración de usuarios y roles.

## Funcionamiento sin conexión

1. El usuario debe crear su cuenta y realizar el primer ingreso con internet.
2. Después del ingreso correcto, el dispositivo guarda un verificador local de la contraseña con PBKDF2 y el perfil del usuario en IndexedDB.
3. Los formularios se guardan localmente con estado `pending`.
4. Cuando vuelve la conexión, el botón **Sincronizar** carga los datos en Firestore y las imágenes en Cloud Storage.
5. La interfaz se almacena con un Service Worker, por lo que puede abrirse sin conexión después de la primera carga.

Importante: la creación de usuarios nuevos siempre requiere conexión. Para un entorno productivo con dispositivos compartidos, conviene sustituir el acceso offline por enrolamiento del dispositivo y PIN local.

## Requisitos

- Node.js 20 o superior.
- Una cuenta de Firebase.
- El sitio debe funcionar en `localhost` o mediante HTTPS para usar Service Worker, cámara y geolocalización.

## 1. Instalar y ejecutar

```bash
npm install
cp .env.example .env
npm run dev
```

Abra la dirección que muestra Vite, normalmente `http://localhost:5173`.

## 2. Crear el proyecto Firebase

En Firebase Console:

1. Cree un proyecto.
2. Registre una aplicación Web.
3. Active **Authentication > Sign-in method > Email/Password**.
4. Cree una base de datos **Cloud Firestore**.
5. Active **Cloud Storage**.
6. Copie la configuración de la aplicación Web al archivo `.env`.

Ejemplo:

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

La aplicación usa internamente el nombre de usuario como una dirección técnica con el formato:

```text
usuario@usuarios.ubayd.app
```

El correo real del empleado queda guardado en el documento del perfil.

## 3. Publicar reglas y hosting

Instale Firebase CLI:

```bash
npm install -g firebase-tools
firebase login
firebase use --add
firebase deploy --only firestore:rules,storage
```

Para publicar la aplicación:

```bash
npm run build
firebase deploy --only hosting
```

## 4. Crear el primer administrador

1. Cree el primer usuario desde la página principal.
2. En Firebase Console, vaya a **Authentication > Users** y copie su UID.
3. En Firestore, abra `users/{UID}`.
4. Cambie el campo:

```text
role: "operator"
```

por:

```text
role: "admin"
```

5. Cierre la sesión e ingrese nuevamente.

Después, ese administrador podrá cambiar roles y activar o desactivar usuarios desde la aplicación.

## Estructura de la nube

```text
users/{uid}
partes/{recordId}
combustibles/{recordId}
descansos/{recordId}
records/{uid}/{tipo}/{recordId}/foto.jpg
records/{uid}/{tipo}/{recordId}/firma.png
```

## Archivos principales

- `src/main.js`: interfaz, autenticación, formularios, ubicación, cámara y sincronización.
- `src/db.js`: IndexedDB para datos locales.
- `src/offline-auth.js`: validación local de credenciales.
- `src/firebase.js`: conexión con Firebase.
- `public/sw.js`: funcionamiento offline.
- `firestore.rules`: permisos de base de datos.
- `storage.rules`: permisos de fotografías y firmas.

## Recomendaciones para producción

- Activar Firebase App Check.
- Implementar aprobación de usuarios nuevos por administrador.
- Usar políticas de contraseñas y recuperación de acceso.
- Registrar auditoría de cambios de roles.
- Definir conservación y privacidad de fotos y ubicaciones.
- Probar el modo offline en los teléfonos reales que utilizarán los operadores.
