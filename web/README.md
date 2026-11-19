# CINENOVA Web

Guía para desarrollar y publicar la web en Cloudflare Pages. Los comandos locales se ejecutan desde la raíz del proyecto, `C:\proyectos\nova`.

## Cómo funciona

- `web/` contiene la interfaz y los archivos estáticos.
- `functions/api/tmdb/[[path]].js` es una Cloudflare Pages Function que consulta TMDB desde el servidor.
- `functions/unlimplay/[[path]].js` sirve el reproductor a través del mismo origen y aplica los ajustes de la página de carga.
- La clave TMDB se configura como **Secret** en Cloudflare Pages y no se envía al navegador.
- `server.py` permite ejecutar localmente la web, el proxy de TMDB y el proxy de UnLimPlay.

La interfaz no ofrece un campo para pegar API keys ni una opción de configuración de TMDB. La región de catálogo queda predeterminada en Argentina.

## Requisitos

- Node.js y npm para generar la configuración de la app y para el proceso de build de Cloudflare.
- Python 3.10 o posterior para el servidor local.
- Una cuenta de Cloudflare Pages y una clave TMDB configurada como secreto en el entorno de Pages.

## Desarrollo local

1. Copia `.env.example` a `.env` en la raíz del proyecto.
2. Coloca la clave TMDB en `TMDB_API_KEY` dentro de `.env`. Este archivo está ignorado por Git.
3. Inicia el servidor local:

   ```powershell
   cd C:\proyectos\nova
   python server.py
   ```

4. Abre [http://127.0.0.1:8000/web/](http://127.0.0.1:8000/web/).

El backend local usa `.env` desde Python; el navegador llama a `/api/tmdb/...` y nunca recibe la clave. Para cambiar el puerto:

```powershell
python server.py --port 8002
```

Para probar en otro dispositivo de la red local, inicia con `python server.py --host 0.0.0.0 --port 8000`, permite el puerto en el firewall y visita `http://IP-LOCAL-DE-LA-PC:8000/web/`. No abras el servidor de desarrollo directamente a Internet.

## Publicar en Cloudflare Pages

Configura el proyecto Pages conectado al repositorio:

| Opción | Valor |
| --- | --- |
| Root directory | raíz del repositorio (`nova`) |
| Build command | `npm run config:env` |
| Build output directory | `web` |
| Variable/Secret de runtime | `TMDB_API_KEY` como **Secret** |
| Variable de build | `CINENOVA_API_BASE_URL` con la URL pública del proyecto Pages |

En **Settings > Variables and Secrets**, crea `TMDB_API_KEY` como Secret (no como variable visible). No agregues `.env` al repositorio ni a la carpeta de salida. Pages detecta las funciones que están en `functions/` en la raíz del proyecto.

El comando de build genera `web/app-config.json`, que solo contiene la URL pública del backend. No contiene la clave TMDB. Si Pages ya está conectado al repositorio, después de guardar la configuración inicia un nuevo deployment.

### Descargar la app Android

El botón **Descargar app** de la web apunta a `web/descargas/cinenova-android.apk`. Para activarlo, copia allí la APK `release` firmada antes de subir el cambio a GitHub. No uses `app-debug.apk` para distribuirla y no incluyas el archivo `.jks` ni sus contraseñas en el repositorio. El `.gitignore` permite publicar únicamente esa APK de descarga.

También configura `CINENOVA_ALLOWED_ORIGINS` como variable si usas un origen adicional para la app. El código permite por defecto los orígenes locales de Capacitor (`https://localhost`, `http://localhost`, `capacitor://localhost`). Los sitios web servidos desde el mismo dominio no necesitan CORS.

## API de TMDB

La interfaz llama a rutas bajo `/api/tmdb/`, por ejemplo `/api/tmdb/trending/all/day?language=es-MX`. La Pages Function solo reenvía solicitudes a `https://api.themoviedb.org/3/`; no permite elegir un host externo. La credencial se agrega en el servidor usando `TMDB_API_KEY`.

El endpoint es público para que el catálogo pueda usarse desde la web y desde la APK. La clave no aparece en HTML, JavaScript, URL pública ni configuración empaquetada. Como cualquier visitante puede consumir el endpoint y afectar la cuota de TMDB, configura límites o reglas de rate limiting en Cloudflare antes de publicar a gran escala.

## Proxy del reproductor

La ruta `/unlimplay/...` se maneja con `functions/unlimplay/[[path]].js` en Cloudflare Pages y con `server.py` durante el desarrollo local. El proxy conserva el indicador de carga y oculta el logo y el texto de patrocinio de UnLimPlay. El servidor de desarrollo Python no es un servidor de producción.

## Solución de problemas

### El catálogo no carga en Cloudflare

- Revisa que el secret de runtime se llame exactamente `TMDB_API_KEY`.
- Confirma que `functions/api/tmdb/[[path]].js` está en la raíz del repositorio y que Pages está desplegando las Functions.
- Confirma también que `functions/unlimplay/[[path]].js` está incluido en el deployment si quieres usar el reproductor en la web publicada.
- Consulta los logs del deployment y la respuesta de `/api/tmdb/genre/movie/list?language=es-MX`.
- Asegúrate de no abrir el HTML con doble clic; la web necesita el backend.

### La web carga pero la app Android no

La APK necesita conocer la URL pública del Pages backend. Define `CINENOVA_API_BASE_URL` antes de ejecutar `npm run sync:android`; los detalles están en `android-capacitor/README.md`.

### La web local responde con error de configuración

Comprueba que `.env` esté en `C:\proyectos\nova`, contenga `TMDB_API_KEY=...` y que `python server.py` siga ejecutándose.

## Archivos relacionados

- `../server.py`: backend local y proxy de desarrollo.
- `../functions/api/tmdb/[[path]].js`: proxy seguro de TMDB para Cloudflare Pages.
- `../.env.example`: ejemplo de configuración local; nunca subas el `.env` real.
- `../android-capacitor/README.md`: guía de Android.
