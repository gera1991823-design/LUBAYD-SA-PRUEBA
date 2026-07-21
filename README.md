# Lubayd SA V20.8.7 — Android/Redmi

Esta versión parte de V20.8.6 y refuerza el funcionamiento en Android/MIUI.

## Instalación
1. Subir todos los archivos interiores a la raíz de GitHub.
2. No borrar datos de la PWA si existen partes pendientes.
3. En el Redmi, abrir la app con internet y entrar en Más > Configuración > Actualizar aplicación.
4. Cerrar completamente la PWA y volver a abrirla.
5. Verificar que figure Versión 20.8.7.

No requiere volver a desplegar Cloud Functions ni reglas si V20.8.6 ya estaba desplegada.

## Prueba
- Iniciar sesión online una vez en el Redmi.
- Desactivar internet, crear un parte y confirmar que quede pendiente.
- Reactivar internet y mantener la app abierta entre 15 y 30 segundos.
- El parte debe pasar a Sincronizado y aparecer al administrador.
