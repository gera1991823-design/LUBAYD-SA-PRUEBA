# Lubayd SA — Gestión de descansos V1.0.0

Aplicación web progresiva (PWA) para celular y computadora.

## Incluye

- Inicio de sesión con correo y contraseña.
- Creación de usuarios mediante Firebase Authentication.
- Inicio y finalización de descanso.
- Fotografía obligatoria en ambas marcaciones.
- Cámara directa con alternativa de archivo cuando el navegador no permite `getUserMedia`.
- GPS de alta precisión con latitud, longitud y precisión informada en metros.
- Hora de Firebase (`serverTimestamp`) y hora local de respaldo.
- Fotografías almacenadas en Firebase Storage.
- Registros e historial almacenados en Cloud Firestore.
- Diseño responsive e instalación como PWA.
- Reglas de seguridad: cada operador solo puede leer y escribir sus propios registros.

## Proyecto Firebase configurado

El archivo `js/firebase-config.js` ya apunta al proyecto:

```text
lubayd-sa
```

La clave web de Firebase no es una contraseña. La protección depende de `firestore.rules`, `storage.rules` y de mantener habilitados únicamente los métodos de autenticación necesarios.

## 1. Preparar Firebase

En Firebase Console:

1. Abrir el proyecto `lubayd-sa`.
2. En **Authentication → Sign-in method**, habilitar **Correo electrónico/Contraseña**.
3. Crear **Cloud Firestore** si todavía no existe.
4. Habilitar **Firebase Storage** si todavía no existe.
5. En **Authentication → Settings → Authorized domains**, agregar el dominio de GitHub Pages, por ejemplo:

```text
TU-USUARIO.github.io
```

## 2. Publicar las reglas

Con Firebase CLI instalado:

```bash
firebase login
firebase use lubayd-sa
firebase deploy --only firestore:rules,storage
```

También puedes desplegar la aplicación en Firebase Hosting:

```bash
firebase deploy --only hosting,firestore:rules,storage
```

## 3. Subir a GitHub Pages

1. Crear un repositorio en GitHub.
2. Subir **todo el contenido interior** de esta carpeta a la raíz del repositorio.
3. En GitHub abrir **Settings → Pages**.
4. Seleccionar **Deploy from a branch**.
5. Elegir la rama `main` y la carpeta `/ (root)`.
6. Guardar y esperar la publicación.

La aplicación debe abrirse con HTTPS para usar cámara y GPS. GitHub Pages ofrece HTTPS.

## 4. Prueba recomendada

1. Abrir la aplicación en el celular.
2. Crear un usuario.
3. Permitir cámara y ubicación precisa.
4. Pulsar **Iniciar descanso**.
5. Tomar la foto y confirmar que la pantalla muestre coordenadas y precisión.
6. Finalizar el descanso con una segunda fotografía.
7. Abrir **Historial** y comprobar las dos ubicaciones y fotografías.
8. Iniciar sesión con la misma cuenta en una computadora y comprobar el mismo historial.

## Consideración sobre la ubicación

La aplicación solicita `enableHighAccuracy`, descarta lecturas peores y espera una lectura de hasta aproximadamente 20 metros cuando el dispositivo puede obtenerla. La exactitud real depende del GPS, permisos, señal, ubicación física y navegador; por eso se guarda siempre la precisión informada en metros.

## Estructura de datos

```text
users/{uid}
users/{uid}/current/break
users/{uid}/breaks/{breakId}
```

Fotografías:

```text
breaks/{uid}/{breakId}/start.jpg
breaks/{uid}/{breakId}/end.jpg
```
