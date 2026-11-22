# CINENOVA — guía técnica y traspaso del proyecto

Este documento es la guía de entrada para desarrollar, desplegar y dar soporte a CINENOVA. Está escrito para una persona o una IA que retome el repositorio sin depender del historial del chat: describe la arquitectura actual, el flujo de reproducción, el bloqueo de publicidad, decisiones anteriores, problemas ya encontrados y cómo diagnosticarlos.

> **Estado documentado:** 19 de noviembre de 2026. La configuración puede cambiar después de esta fecha. Para conocer el estado real, revisar primero el código y el último deployment de Cloudflare Pages.

## Resumen rápido

- La web activa vive en `web/` y es una SPA en HTML, CSS y JavaScript.
- El backend de catálogo es una Cloudflare Pages Function: `functions/api/tmdb/[[path]].js`. La clave de TMDB se configura como secret de Cloudflare y nunca debe llegar al navegador, al APK ni a Git.
- La reproducción integrada usa una Pages Function de proxy: `functions/unlimplay/[[path]].js`. La web carga el reproductor mediante una ruta del mismo origen (`/unlimplay/...`) porque la conexión directa de UnLimPlay desde un iframe fue rechazada en el navegador.
- El proyecto Android que se compila es `android-capacitor/`. `android/` es una versión anterior y no es el destino actual.
- La app apunta a la web remota `https://nova-2yi.pages.dev` desde `capacitor.config.json`. Por eso cambios de interfaz publicados en Pages llegan al abrir de nuevo la app; cambios nativos Java requieren compilar e instalar otro APK.
- La carpeta `chrome-unlimplay-adblock/` contiene una extensión del navegador que el usuario pidió expresamente dejar intacta. No modificarla ni asumir que la app o el sitio la necesitan.

## Arquitectura

```text
Navegador ───────────────┐
                        ├── web/index.html (SPA)
App Capacitor / WebView ─┘       │
                                 ├── /api/tmdb/* ── Pages Function ── TMDB API
                                 │                   secret TMDB_API_KEY
                                 │
                                 └── /unlimplay/* ─ Pages Function proxy ── UnLimPlay
                                                     reescritura + filtro de anuncios

Android nativo (MainActivity.java)
  ├── WebView request filtering adicional
  ├── pantalla completa y orientación del reproductor
  └── puente de teclas del control remoto → interfaz/reproductor
```

La interfaz no llama a TMDB con una clave propia. Pide datos a `/api/tmdb`; Cloudflare añade la credencial al solicitar TMDB. Para vídeo, el frontend construye la URL local `/unlimplay/f/embed/movie/...` o `/unlimplay/f/embed/tv/...`; el proxy obtiene la página del reproductor externo y la devuelve adaptada para que se mantenga dentro del mismo origen de CINENOVA.

## Mapa del repositorio y fuente de verdad

| Ruta | Función / advertencia |
|---|---|
| `web/index.html` | Interfaz SPA, estilos, navegación, detalle, búsqueda y lógica cliente del reproductor. Es el punto principal de cambios visuales y de interacción. |
| `web/app-config.json` | Configuración generada/local con `apiBaseUrl`. Está ignorada por Git; no poner aquí secretos. En el sitio publicado, normalmente se genera durante el build. |
| `functions/api/tmdb/[[path]].js` | Proxy seguro de TMDB para Cloudflare Pages. |
| `functions/unlimplay/[[path]].js` | Proxy del player de UnLimPlay y filtros JavaScript; también contiene controles específicos de TV. |
| `server.py` | Servidor de desarrollo local, proxy local de TMDB y relay local para UnLimPlay. |
| `scripts/generate-env-config.mjs` | Lee la URL base de configuración local y genera el JSON de configuración de frontend. No debe copiar una clave TMDB al cliente. |
| `.env.example` | Plantilla para desarrollo local, sin credenciales reales. |
| `capacitor.config.json` | Directorio web empaquetado y URL remota configurada para Capacitor. |
| `android-capacitor/` | Aplicación Android activa, WebView, puente para control remoto y build Android. |
| `android/` | Implementación Android previa; no compilar para publicar la app actual salvo que el código/configuración futura indique lo contrario. |
| `web/README.md` | Guía adicional de publicación y configuración web. |
| `android-capacitor/README.md` | Guía adicional de build y firma Android. |
| `chrome-unlimplay-adblock/` | Extensión independiente. El usuario pidió no tocarla. No es el mecanismo de bloqueo incorporado al sitio ni a la app. |

Antes de editar, leer este archivo y los README específicos del área. Confirmar qué implementación es activa en el código; no deducirlo sólo por el nombre de carpetas o por una captura antigua.

## Cómo funciona el bloqueo de publicidad

### Por qué existe el proxy

La primera integración intentaba incrustar directamente `https://unlimplay.com/f/embed/...`. En el navegador aparecía el mensaje de que UnLimPlay rechazaba la conexión. Esto suele ser una restricción de embedding/origen y no se resuelve cambiando el botón de reproducción. Se añadió un relay del mismo origen: la página solicita `https://nova-2yi.pages.dev/unlimplay/...`, y la Function pide el recurso externo y lo retransmite.

El proxy también adapta referencias a recursos y cabeceras que impedirían el iframe, incluyendo políticas de frame como `X-Frame-Options` y `Content-Security-Policy` cuando el handler las elimina. Reescribe enlaces y redirecciones del reproductor para que vuelvan a pasar por `/unlimplay`. Así se evita abrir otra página y se mantiene el contexto dentro de CINENOVA. No extrae ni almacena la película: sigue dependiendo del reproductor y de sus servidores externos.

### Capas activas de filtrado

**1. Filtro en la respuesta del proxy web (Cloudflare Pages).** `functions/unlimplay/[[path]].js` inyecta `AD_FILTER_SCRIPT` en el HTML del embed. La lista `AD_DOMAINS` contiene dominios conocidos de anuncios/trackers, entre ellos redes de Google, `adnxs`, `popads`, `popcash`, `exoclick`, `juicyads`, `adsterra`, `monetag`, `onclickalgo`, `acscdn`, `taboola`, `outbrain`, `mgid`, `adform`, `rubiconproject`, `pubmatic`, `openx`, `criteo`, `smartadserver`, `propellerads`, `clickadu`, `evadav`, `trafficstars`, `hilltopads`, `adskeeper` y otros enumerados en el archivo fuente. Para la lista exacta y vigente, consultar `AD_DOMAINS` en esa Function; no duplicarla aquí como fuente de verdad.

El script inyectado, a grandes rasgos:

- Clasifica URLs por hostname y bloquea los dominios conocidos y sus subdominios.
- Envuelve `fetch` y devuelve una respuesta vacía/bloqueada para destinos identificados como anuncios.
- Intercepta solicitudes `XMLHttpRequest` y las corta cuando coinciden.
- Intercepta asignaciones de `src`/`href` mediante `setAttribute`, y evita destinos bloqueados.
- Bloquea ventanas emergentes con `window.open` y cancela clics en enlaces que apuntan a esos dominios.
- Comprueba periódicamente si el reproductor ofrece un botón de saltar anuncio (`#btn-skip`) y lo activa cuando está habilitado y el contador indica que se puede saltar.
- Oculta selectores concretos del logotipo del reproductor (`.ulp-logo-img` y `.ulp-logo-svg`). El filtro no debe describirse como una garantía de ocultar cualquier texto, marca o patrocinio: el HTML/CSS de terceros puede cambiar.

El clasificador deja pasar extensiones de medios habituales (`.m3u8`, `.mp4`, `.ts`, `.vtt`) para no cortar el vídeo y los subtítulos por error. Por eso un anuncio servido como segmento de vídeo o desde el mismo host que el contenido puede pasar el filtro.

**2. Modo de controles para TV.** Si el embed se solicita con `cn_tv=1`, la Function añade `PLAYER_REMOTE_SCRIPT` y `TV_PLAYER_CONTROLS_SCRIPT` además del filtro común y quita `cn_tv` antes de solicitar el recurso upstream. El primero recibe mensajes del documento padre para enfocar/reenviar teclas; el segundo ajusta controles del player (por ejemplo, oculta algunos controles redundantes y mejora el foco de la barra de progreso con flechas). Esto es para navegación de control remoto, no es una capa adicional de filtrado publicitario.

**3. Filtro nativo Android.** `android-capacitor/app/src/main/java/com/nova/cinenova/MainActivity.java` usa `WebViewClient.shouldInterceptRequest` para cortar solicitudes cuyos hosts están en su propia lista `AD_HOSTS`. Deja pasar los hosts de UnLimPlay y tipos de recurso de medios reconocidos para evitar romper la reproducción. También desactiva ventanas múltiples y aperturas automáticas de ventanas JavaScript. Es una capa complementaria dentro de ese WebView, no modifica Chrome ni otros navegadores.

### Qué bloquea y qué no garantiza

Esto es un filtro por listas de dominios y comportamiento del player, no un bloqueador universal de red ni una extensión DNS. Puede reducir anuncios y popups identificables, pero no garantiza eliminar todos los anuncios. UnLimPlay puede cambiar scripts, dominios, rutas, reproductores o servir publicidad desde el mismo host que vídeo; los servidores anidados también pueden tener otra política. Una petición bloqueada en un punto puede romper el reproductor, así que toda nueva regla debe probarse tanto con película como con episodio, en navegador y en TV cuando aplique.

La extensión local del navegador es independiente y queda fuera del alcance de mantenimiento por instrucción del usuario. No pedir que el visitante instale un lanzador o extensión para que funcione la web; la web usa su propio proxy Pages.

### Cómo mantener el filtro de forma segura

1. Inspeccionar `AD_DOMAINS`, `isAd`, `AD_FILTER_SCRIPT`, `PLAYER_REMOTE_SCRIPT` y `TV_PLAYER_CONTROLS_SCRIPT` en `functions/unlimplay/[[path]].js`.
2. Para Android nativo, revisar `AD_HOSTS` y `shouldInterceptRequest` en `MainActivity.java`. Las listas no son idénticas: el filtro de Pages y el nativo tienen capacidades y alcances diferentes.
3. Si se agrega un dominio, bloquear sólo el host confirmado como anuncio, no el dominio base de UnLimPlay ni un CDN compartido de vídeo.
4. Comprobar que audio/vídeo, subtítulos, cambio de episodio, controles D-pad y botón Atrás siguen operativos.
5. Publicar a Pages y comprobar la URL de producción. La vista previa de un commit es otra URL; puede comportarse distinto a producción.

## TMDB, `.env` y secretos

### Desarrollo local

1. Copiar `.env.example` a `.env` en la raíz.
2. Completar `TMDB_API_KEY` con una credencial válida y, si hace falta, `CINENOVA_API_BASE_URL`/orígenes permitidos según `web/README.md`.
3. No compartir ni subir `.env`; está ignorado por Git. No pegar la clave en `web/index.html`, `app-config.json`, `capacitor.config.json`, archivos Gradle ni en el chat.

`generate-env-config.mjs` produce `web/app-config.json` con la URL del backend, no con la clave de TMDB, y limpia la configuración de clave antigua si existe. El navegador sólo conoce la dirección del proxy.

### Cloudflare Pages

En la configuración del proyecto Pages `nova-2yi`, configurar `TMDB_API_KEY` como **secret/variable de entorno cifrada**, tanto para el entorno de producción como para Preview si se usan ambos. La Function espera `env.TMDB_API_KEY`. Configurar también los orígenes permitidos sólo si la política CORS del código requiere dominios adicionales. No es necesario un archivo `.env` publicado en Pages.

La Function restringe el proxy a rutas válidas de TMDB y sólo acepta los métodos previstos (GET/OPTIONS). Añade la clave en upstream como Bearer cuando el valor tiene forma de token JWT; en caso contrario la pasa como `api_key`. Respuestas exitosas se cachean brevemente; errores no se guardan. Si el catálogo aparece vacío, revisar primero el secret del entorno de producción y las respuestas de `/api/tmdb/...`.

## Ejecutar localmente

Desde la raíz correcta (`C:\proyectos\nova` en el equipo del usuario):

```powershell
python server.py --host 127.0.0.1 --port 8000
```

Abrir `http://127.0.0.1:8000/web/`. El servidor local expone la interfaz y los endpoints de desarrollo `/api/tmdb/` y `/unlimplay/`; lee variables del entorno y, si existe, `.env`. Mantenerlo limitado a localhost salvo que se configure una exposición deliberada y protegida.

También hay scripts npm para preparar configuración y sincronizar Capacitor:

```powershell
npm install
npm run config:env
npm run sync:android
```

Consultar `package.json` para los scripts que existan en el checkout actual. El servidor local y Cloudflare no son idénticos: en el estado documentado el relay local no incorpora exactamente la variante TV `cn_tv=1` que implementa Pages. Para verificar la integración final, probar Pages de producción.

### Error histórico `missing required directory/directories: remote`

El usuario ejecutó `python server.py` y recibió que faltaba `remote`. La versión actual de `server.py` sólo exige `web`; `remote` es opcional/legado. Si reaparece, primero verificar `Get-Location`, confirmar que se está ejecutando `C:\proyectos\nova\server.py` y comprobar `git status`/versión del archivo. Es probable que se esté usando una copia antigua o un directorio distinto. No crear una carpeta vacía `remote` como solución sin inspeccionar el servidor.

## Publicar la web en Cloudflare Pages

El dominio de producción documentado es [nova-2yi.pages.dev](https://nova-2yi.pages.dev). Es un proyecto **Pages**. No confundir con el Worker antiguo `nova.pelisnova.workers.dev`, ni con URLs de preview con hash de deployment.

La integración de GitHub despliega commits del repositorio en Cloudflare. Revisar en Pages:

- Repositorio correcto y rama de producción correcta.
- Directorio raíz del proyecto y build/output conforme a `web/README.md` y a la configuración del repo.
- Que las carpetas `functions/` y `web/` entren en el commit. Pages Functions no funcionarán si se publica sólo el HTML sin Functions.
- Que el deployment de producción corresponda al último commit esperado. GitHub y Cloudflare muestran identificadores distintos: comparar SHA del commit, no asumir que el número de deployment tiene que coincidir.
- Que el secret `TMDB_API_KEY` esté configurado para producción.

Después del deploy, validar catálogo, detalle y URL del reproductor desde `https://nova-2yi.pages.dev`; una preview no confirma que el alias de producción se haya actualizado. Si persiste una versión anterior, verificar la rama/build y recargar limpiando caché sólo después de comprobar el deployment.

## App Android, TV y celular

### Proyecto y fuente de interfaz

La app activa está en `android-capacitor/`. Capacitor empaqueta la web de `web/` (`webDir`), pero `capacitor.config.json` además configura `server.url` a la URL Pages. Esa configuración se eligió para que cambios de web puedan publicarse sin pedir que todos reinstalen el APK. En este estado, la app necesita conexión a internet para cargar la interfaz remota.

El usuario ya indicó que desea mantener esta experiencia de actualizaciones remotas. Aun así, Capacitor describe `server.url` como una opción para live reload/desarrollo, no como el mecanismo recomendado de producción. Documentar y respetar la decisión actual, pero si se cambia el plan de distribución, evaluar un sistema OTA de producción con bundles firmados. No afirmar que un plugin de OTA está instalado: no lo está según el repositorio documentado.

**Qué se actualiza remotamente:** HTML, CSS, JavaScript y assets que carga la página Pages, al volver a abrir/recargar la app.

**Qué no se actualiza remotamente:** Java/Kotlin, permisos, manifest, plugins nativos, puente del control remoto, bloqueo del WebView o recursos compilados nativos. Eso exige nueva APK e instalación.

### Reproducción y control remoto

En TV, el botón de reproducir abre una capa de reproductor a pantalla completa y al salir se cierra. `MainActivity.java` activa el modo inmersivo/orientación y gestiona la vista fullscreen de WebView. El puente nativo `TvRemoteBridge` expone detección del dispositivo y fullscreen. Durante reproducción, `dispatchKeyEvent` convierte flechas del control, Enter/centro y play/pause en acciones que la interfaz puede recibir; el JavaScript de la página reenvía mensajes al iframe UnLimPlay. La variante `cn_tv=1` activa ajustes específicos del reproductor a través de Pages.

La navegación y el iframe de un tercero pueden variar según modelo de TV, firmware, versión de WebView y cambios en UnLimPlay. No considerar el soporte de flechas universalmente validado sólo porque compile: probar en un dispositivo real, incluyendo foco, seek, play/pause, episodio siguiente y Atrás.

### Sincronizar y compilar

Después de cambiar la web y querer probar la copia empaquetada local:

```powershell
npm run sync:android
```

Para abrir/compilar Android, usar `android-capacitor/` (Android Studio) o los scripts documentados en `android-capacitor/README.md`. No compilar `android/` por error. La APK de distribución debe identificarse por versión, firma y fecha; no asumir que cualquier `app-debug.apk` es una release apta para publicar.

### Firma de release y distribución

El estado previamente observado era una APK de versión 1.4 / `versionCode` 5 firmada con debug. Sirve para pruebas sideload, pero no es una release firmada con una clave de distribución. No se encontró un keystore `.jks` en el repositorio. Para una release:

1. Crear una clave de firma de release en un lugar seguro fuera del repo.
2. Guardar copias protegidas del keystore y sus contraseñas. La clave debe conservarse para firmar todas las versiones futuras; perderla puede impedir actualizar instalaciones existentes.
3. Configurar firma en Android Studio o Gradle sin subir contraseñas/keystore a Git.
4. Incrementar `versionCode` y actualizar versión visible al preparar cada publicación.
5. Generar APK (o AAB si el canal lo requiere), validar que es release y probar instalación/actualización en un dispositivo real.
6. Publicar la APK en el sitio sólo después de confirmar firma, arquitectura y versión. La documentación Android contiene los pasos específicos de build.

Si la APK debug está instalada, Android puede rechazar instalar encima una APK firmada con otra clave; puede ser necesario desinstalar la debug primero, lo cual puede borrar datos locales.

## Problemas anteriores y cómo se resolvieron

Esta sección recoge decisiones del historial y su implementación actual. No usarla como prueba de que cada situación está resuelta en todos los dispositivos: revisar y probar el estado actual.

| Problema observado | Causa/contexto | Solución incorporada / cómo verificar |
|---|---|---|
| El navegador decía que `unlimplay.com` rechazó la conexión. | El embed directo de origen externo no era aceptado en ese contexto. | Relay de mismo origen `/unlimplay/` en Pages y servidor local; reescritura de URL/cabeceras/redirecciones. Verificar que `web/index.html` usa `unlimplayUrl` y que Pages ejecuta `functions/unlimplay`. |
| La app reproducía, pero aparecían varios anuncios; la web tenía un comportamiento distinto. | Android tenía un interceptor nativo; la web no compartía ese filtro. Además, los anuncios usan dominios que cambian. | Filtro inyectado en el HTML por el proxy web y filtro adicional nativo Android. Son capas diferentes y no universales; revisar listas y probar producción. |
| A veces el player aparecía repetido/anidado o la reproducción no quedaba a pantalla completa. | Navegación dentro del iframe/proxy y presentación de player en la interfaz app no estaban coordinadas. | UI app abre un overlay sólo al pulsar Play; el código nativo gestiona fullscreen y Atrás; el relay reescribe referencias del player. Verificar botón Atrás y modelo de TV concreto. |
| Flechas del control no manejaban el reproductor o el foco se perdía. | Las teclas del mando deben atravesar Android → página → iframe de otro contexto. | Puente Java `dispatchKeyEvent`, función JS de forwarding, listeners `cinenova-player-*` y scripts TV del proxy. Si falla, comprobar que se usa URL Pages actual, query `cn_tv=1`, iframe servido vía proxy y app con el `MainActivity` reciente. |
| La búsqueda/catálogo mostraba secciones vacías tras publicar. | El frontend no obtenía catálogo cuando el proxy TMDB, la variable secreta o la URL base no estaban bien configurados; también hubo confusión entre preview y producción. | Función `/api/tmdb`, secret en Pages y `apiBaseUrl`; comprobar `TMDB_API_KEY` en el entorno de producción y comparar commit desplegado con GitHub. |
| Se intentó poner `TMDB_API_KEY` en `.env`/frontend para Cloudflare. | `.env` local no se importa automáticamente al deployment y cualquier clave cliente se expone. | Secret de Pages leído por `functions/api/tmdb`; frontend sólo recibe URL de backend. No poner key en `app-config.json` ni subir `.env`. |
| El repo de GitHub y Cloudflare parecían tener “números” de implementación distintos. | SHA de commit, número de build y deployment ID son identificadores distintos. Además, Pages preview y producción tienen URL separadas. | Comparar SHA/branch del último deployment y abrir dominio de producción. El número del deployment no tiene por qué coincidir con GitHub. |
| `python server.py` pedía un directorio `remote` inexistente. | Se estaba usando una versión/configuración anterior o una ruta de trabajo distinta. | La versión actual sólo exige `web`; ejecutar desde raíz del repo. Si vuelve, revisar ubicación y archivo ejecutado antes de cambiar carpetas. |
| Se preguntó si la app se actualiza sola desde GitHub. | GitHub no actualiza por sí solo la app instalada; Pages publica la UI remota configurada. | Los cambios web publicados llegan al abrir app porque `server.url` apunta a Pages. Cambios nativos necesitan APK. Esto no reemplaza una OTA firmada robusta para producción. |
| Se confundieron las carpetas Android y la APK de release. | El repo conserva una carpeta Android vieja y la actual Capacitor; también se llegó a tener APK debug. | Compilar `android-capacitor/`, revisar versión y firma del artefacto; crear keystore de release propio y conservarlo. |

## Diagnóstico rápido

| Síntoma | Revisar en este orden |
|---|---|
| Catálogo dice “No se pudo cargar esta sección” | 1) abrir `/api/tmdb/...` en producción y ver status; 2) secret `TMDB_API_KEY` para Production; 3) deployment commit/branch; 4) `apiBaseUrl`; 5) CORS/origen si la consola indica CORS. No pegar la key en el frontend. |
| El iframe muestra rechazo de conexión | Confirmar que la URL comienza en el dominio CINENOVA bajo `/unlimplay/`, no `unlimplay.com` directo; revisar estado de la Pages Function, redirects y salida de proxy. |
| Persisten anuncios | Identificar hostname desde DevTools/Network si es posible; confirmar que la solicitud pasa por `/unlimplay`; comparar host con `AD_DOMAINS` y `AD_HOSTS`; distinguir anuncio servido como `.m3u8/.ts/.mp4` o desde host compartido. Agregar reglas pequeñas y volver a probar reproducción. |
| Producción conserva código viejo | Confirmar que el deployment de producción usa el SHA esperado; no confundir preview URL, Pages URL y Worker antiguo; revisar build y caché. |
| TV no responde con flechas dentro del vídeo | Confirmar app `android-capacitor` actual; `cn_tv=1`; proxy Pages actual; fullscreen nativo activo; revisar enfoque/teclas y probar con mando real. |
| La web local no reproduce igual que producción | El servidor local y Pages no son idénticos; la variante local puede no incluir scripts específicos TV. Comparar la Function desplegada y el script de `server.py`. |
| No se actualiza una app sin reinstalar | Determinar si cambió web remota o código nativo. Web: reiniciar app y confirmar URL de Pages. Nativo: generar e instalar APK nueva. |

## Reglas de continuidad para la próxima IA

1. Empezar en `C:\proyectos\nova` y leer este README, `web/README.md` y `android-capacitor/README.md` según el tema. No explorar todas las carpetas indiscriminadamente en cada cambio.
2. Tratar `functions/unlimplay/[[path]].js`, `MainActivity.java` y `web/index.html` como las fuentes de verdad para sus respectivas capas; confirmar siempre con el código del checkout.
3. No modificar `chrome-unlimplay-adblock/`: el usuario pidió que se deje intacta.
4. No filtrar ni copiar `TMDB_API_KEY` a frontend, APK, archivos de configuración públicos, logs o commits.
5. Mantener el reproductor detrás de `/unlimplay/`; no volver a usar un iframe directo de UnLimPlay sin comprobar compatibilidad y cambios de seguridad.
6. Recordar que la lista de dominios de anuncios es una mitigación que necesita mantenimiento y que excepciones de medios son intencionales para no romper playback.
7. Distinguir Pages producción (`nova-2yi.pages.dev`) de previews y del Worker legado. Antes de concluir que un cambio no se desplegó, comparar SHA, rama y entorno.
8. Distinguir cambios web remotos de cambios nativos Android. La actualización remota actual depende de `server.url` y de conexión; no anunciarla como updater OTA firmado.
9. Para tareas Android TV, probar navegación real con control remoto, especialmente foco del iframe, barra de progreso y salida con Atrás. La compilación correcta por sí sola no prueba interacción del player externo.
10. Al terminar una tarea, resumir archivos modificados, cómo se verificó y qué requiere publicar en Cloudflare o recompilar como APK.

## Documentación relacionada

- [Guía de la web](web/README.md)
- [Guía Android/Capacitor](android-capacitor/README.md)
- [Configuración de Capacitor](capacitor.config.json)
- [Paquetes y scripts](package.json)
- [Plantilla de variables](.env.example)
