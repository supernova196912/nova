# CINENOVA

CINENOVA contiene una web y una aplicación Android basada en Capacitor. Las instrucciones completas están separadas por destino:

- [Manual de la web](web/README.md)
- [Manual de Android](android-capacitor/README.md)

## Componentes principales

- `web/`: interfaz, catálogo y reproductor web.
- `server.py`: servidor local y proxy de desarrollo para TMDB/UnLimPlay.
- `functions/api/tmdb/[[path]].js`: proxy de TMDB para Cloudflare Pages.
- `android-capacitor/`: proyecto Android que se compila y distribuye actualmente.
- `android/`: proyecto Android nativo anterior; no es el proyecto Capacitor actual.
- `.env.example`: plantilla local. La clave real TMDB debe quedar en un secret de Cloudflare Pages, no en Git ni en los assets de Android.

La aplicación empaqueta una copia de `web/`. Después de modificar la web, ejecuta `npm run sync:android` antes de volver a compilar Android.
