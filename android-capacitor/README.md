# CINENOVA para Android

Esta guía describe la aplicación Android basada en Capacitor, para celulares táctiles y Android TV. Ejecuta los comandos de configuración desde la raíz del proyecto (`C:\proyectos\nova`) y los comandos Gradle desde `android-capacitor/`.

## Qué proyecto Android usar

Compila **`android-capacitor/`**. La carpeta hermana `android/` corresponde a una implementación nativa anterior y no es el proyecto configurado actualmente por Capacitor.

La aplicación Android empaqueta la interfaz que vive en `web/`. El código nativo que complementa el WebView se encuentra en `android-capacitor/app/src/main/java/com/nova/cinenova/MainActivity.java`; ahí se configuran el modo de pantalla completa, controles y el bloqueo de solicitudes a dominios publicitarios conocidos.

## Funciones

- Interfaz adaptable a celular táctil y Android TV.
- En TV, menú lateral completo y navegación con cruceta; al reproducir, el foco pasa al iframe y las flechas/OK quedan disponibles para los controles del reproductor.
- La sección Infantil combina películas familiares, series infantiles, animación familiar y dibujos animados, con contenido adulto excluido en las consultas.
- Al reproducir en celular o TV, el video ocupa la pantalla en horizontal e inmersivo; Atrás sale del reproductor y restaura la orientación.
- Reproducción integrada de UnLimPlay.
- La app intercepta solicitudes a una lista de dominios publicitarios conocidos dentro de su WebView. El filtrado puede requerir mantenimiento si el reproductor cambia los dominios usados.
- La APK incluye los archivos web sincronizados al momento de compilar.
- No solicita ni guarda una API key TMDB. Las llamadas al catálogo van al backend de Cloudflare Pages.

## Requisitos

- Node.js y npm.
- Android Studio y Android SDK instalados.
- JDK compatible con la versión de Android Gradle Plugin del proyecto (Android Studio incluye un JDK adecuado; configura `JAVA_HOME` o el Gradle JDK desde Android Studio si Gradle no lo encuentra).
- Una clave API de TMDB.

## Configuración inicial

Desde PowerShell en la raíz:

```powershell
cd C:\proyectos\nova
npm ci
Copy-Item .env.example .env
```

Edita `.env` y define la dirección pública del proyecto de Cloudflare Pages:

```dotenv
CINENOVA_API_BASE_URL=https://tu-proyecto.pages.dev
```

Usa la URL real que Cloudflare Pages asigne a tu sitio (o tu dominio personalizado). No subas `.env` a Git. La clave `TMDB_API_KEY` se configura como **Secret** en Cloudflare Pages y no se copia a la APK. El campo `CINENOVA_API_BASE_URL` es solo una URL pública; `scripts/generate-env-config.mjs` la escribe en `web/app-config.json` para que la APK sepa dónde consultar el catálogo.

Si todavía no publicaste Pages, puedes compilar la interfaz, pero el catálogo de la APK no funcionará hasta definir la URL del backend y volver a sincronizar/compilar.

## Actualizaciones remotas de la interfaz

La APK carga la interfaz desde `https://nova-2yi.pages.dev` (configurada en `capacitor.config.json`). Al publicar cambios de HTML, CSS o JavaScript en la rama de producción de Cloudflare Pages, la app los recibirá al volver a abrirse o recargar la vista; para esos cambios no hace falta compilar ni reinstalar otra APK. El dispositivo necesita conexión a Internet para iniciar y actualizar la interfaz.

Esto actualiza la parte web de la app. Cambios en código Android/Java, permisos, plugins, orientación o comportamiento nativo todavía requieren compilar y distribuir una APK nueva. La app no instala APKs ni actualiza código nativo en silencio.

Para sincronizar los assets empaquetados y la configuración de Android para la próxima compilación, ejecuta:

```powershell
npm run sync:android
```

Este comando ejecuta `npm run config:env` y después `cap sync android`. La configuración del proyecto en `capacitor.config.json` establece `web/` como directorio web y `android-capacitor/` como plataforma Android. La configuración generada contiene solo la URL del backend, nunca la clave TMDB.

Comprueba que la URL no termine en una ruta como `/api`; el código agrega `/api/tmdb` automáticamente. El backend debe permitir llamadas desde el origen de Capacitor (`https://localhost`), como ya hace la Function incluida.

## Compilar una APK de depuración

```powershell
cd C:\proyectos\nova
npm run sync:android
cd android-capacitor
.\gradlew.bat assembleDebug
```

La APK queda en:

```text
android-capacitor/app/build/outputs/apk/debug/app-debug.apk
```

También puedes abrir el proyecto en Android Studio desde la raíz con:

```powershell
npm run android
```

Luego selecciona la configuración `app` y ejecuta **Run** o compila desde el menú de Android Studio. Si modificaste el contenido de `web/`, sincronízalo antes.

## Instalar en un dispositivo conectado por ADB

Con depuración USB habilitada y el dispositivo conectado:

```powershell
cd C:\proyectos\nova\android-capacitor
adb install -r .\app\build\outputs\apk\debug\app-debug.apk
```

Para Android TV, habilita opciones de desarrollador y depuración de red/ADB, conecta el dispositivo y utiliza `adb install -r` de la misma manera.

## Crear una versión de distribución

`assembleDebug` crea una APK de desarrollo. Para distribuir la app desde la web, crea una APK `release` firmada desde Android Studio con **Build > Generate Signed Bundle / APK > APK**, elige el módulo `app` y la variante `release`. Si aún no tienes una clave, créala desde el asistente y guárdala fuera del repositorio. Conserva la misma clave para las siguientes versiones; no subas el `.jks` ni las contraseñas a Git.

Cuando el asistente termine, copia la APK firmada resultante a:

```text
C:\proyectos\nova\web\descargas\cinenova-android.apk
```

Después de copiarla, sube el cambio de la página junto con la APK a GitHub para que Cloudflare Pages publique el botón y el archivo. Una vez instalada la APK configurada para Pages, los cambios de la interfaz se publican en el sitio y llegan al volver a abrir la app; esos cambios web no requieren una APK nueva. Para cambiar el código nativo de Android sí hay que incrementar `versionCode`, firmar con la misma clave e instalar la nueva APK. La APK `release` firmada reemplaza la `debug`; si el dispositivo ya tiene instalada una `debug`, Android puede exigir desinstalarla primero.

## Comandos frecuentes

Desde la raíz:

| Comando | Acción |
| --- | --- |
| `npm ci` | Instala las dependencias fijadas en `package-lock.json`. |
| `npm run config:env` | Genera `web/app-config.json` con la URL pública del backend y elimina la configuración antigua que podía contener una clave. |
| `npm run sync:android` | Genera la configuración y sincroniza Capacitor con Android. |
| `npm run android` | Abre el proyecto Android de Capacitor en Android Studio. |

Desde `android-capacitor/`:

| Comando | Acción |
| --- | --- |
| `./gradlew assembleDebug` (macOS/Linux) | Compila la APK debug. |
| `./gradlew.bat assembleDebug` (Windows) | Compila la APK debug. |
| `./gradlew clean` (macOS/Linux) | Limpia los productos Gradle anteriores. |
| `./gradlew.bat clean` (Windows) | Limpia los productos Gradle anteriores. |

## Solución de problemas

### Cambios de la web no aparecen en la app

Ejecuta `npm run sync:android` y compila de nuevo. Capacitor copia los archivos web al proyecto Android durante la sincronización.

### Gradle no encuentra Android SDK o Java

Abre `android-capacitor/` en Android Studio, deja que configure el SDK y selecciona un JDK compatible en **Settings > Build Tools > Gradle > Gradle JDK**. Android Studio puede crear `local.properties`; ese archivo es local y no debe versionarse.

### La app no muestra películas o series

Comprueba que `CINENOVA_API_BASE_URL` apunte al dominio activo de Cloudflare Pages, vuelve a ejecutar `npm run sync:android` y recompila. Verifica también que el secret `TMDB_API_KEY` esté configurado en Pages.

### El reproductor no abre o cambió la publicidad

Comprueba la conexión del dispositivo. El filtrado nativo solo bloquea los hosts incluidos en `MainActivity.java`; los cambios en los dominios o el reproductor de UnLimPlay pueden requerir actualizar ese código y recompilar.

## Archivos principales

- `capacitor.config.json`: identificador, nombre, directorio web y plataforma configurada.
- `scripts/generate-env-config.mjs`: genera solo la URL pública del backend que usa la app.
- `android-capacitor/app/src/main/java/com/nova/cinenova/MainActivity.java`: ajustes del WebView Android, navegación, pantalla completa y filtro de hosts.
- `android-capacitor/app/src/main/AndroidManifest.xml`: actividades y entradas de lanzamiento para Android y Android TV.
- `web/`: interfaz compartida con la versión web.
- `functions/api/tmdb/[[path]].js`: Function de Cloudflare que consulta TMDB sin revelar la clave.
- `functions/unlimplay/[[path]].js`: Function de Cloudflare usada por el reproductor y sus ajustes visuales.
- `web/README.md`: guía completa de la versión web y del servidor local.
