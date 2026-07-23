# Publicación en GitHub Pages

Este proyecto debe compilarse con Vite. No publique directamente `index.html` desde la rama `main`.

## 1. Subir el proyecto completo

Suba todo el contenido de esta carpeta a la raíz del repositorio `LUBAYD-SA-PRUEBA`, incluyendo:

- `.github/workflows/deploy.yml`
- `public/`
- `src/`
- `vite.config.js`
- `index.html`
- `package.json`

## 2. Agregar secretos de Firebase

En GitHub abra:

`Settings > Secrets and variables > Actions > New repository secret`

Cree estos seis secretos con los valores de la configuración Web de Firebase:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

## 3. Elegir GitHub Actions como origen

En GitHub abra:

`Settings > Pages > Build and deployment > Source > GitHub Actions`

## 4. Publicar

Al guardar los archivos en `main`, el flujo de trabajo compilará el proyecto y publicará la carpeta `dist`.

Revise el resultado en la pestaña `Actions`. Cuando el flujo quede verde, abra:

`https://gera1991823-design.github.io/LUBAYD-SA-PRUEBA/`

## 5. Limpiar la versión en blanco anterior

Después del primer despliegue correcto:

1. Abra la página.
2. Presione `Ctrl + F5`.
3. Si continúa en blanco, abra DevTools > Application > Service Workers y pulse `Unregister`; luego borre los datos del sitio y recargue.
