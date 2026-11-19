package com.peliskong.app

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.KeyEvent
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/**
 * Contenedor principal: carga la interfaz web remota (actualización instantánea sin publicar APK)
 * y expone el puente window.Android. La reproducción se delega a Activities nativas.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var store: ContinueWatchingStore

    /** true solo si la página actual pertenece al origen de WEB_APP_URL (lo consulta el puente JS). */
    @Volatile
    var isTrustedPage: Boolean = false
        private set

    private val appOrigin: String by lazy { originOf(BuildConfig.WEB_APP_URL) }
    private var backInFlight = false

    /** Al volver de un reproductor, avisamos a la web para que redibuje "Seguir viendo". */
    private val playerLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
            notifyContinueWatchingChanged()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = ContinueWatchingStore(this)

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        webView = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            isFocusable = true
            isFocusableInTouchMode = true
        }
        setContentView(webView)
        enterImmersiveMode()
        configureWebView()

        // "Atrás": primero se le pregunta a la web; solo se cierra la app si responde false.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = askWebToHandleBack()
        })

        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(BuildConfig.WEB_APP_URL)
        }
        webView.requestFocus()
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private fun configureWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            allowFileAccess = false
            allowContentAccess = false
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            userAgentString = "$userAgentString PeliskongApp/${BuildConfig.VERSION_NAME}"
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SAFE_BROWSING_ENABLE)) {
            WebSettingsCompat.setSafeBrowsingEnabled(webView.settings, true)
        }

        webView.addJavascriptInterface(WebAppInterface(this, store), "Android")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                handleNavigation(request.url.toString())

            @Deprecated("API < 24")
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean =
                handleNavigation(url)

            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                isTrustedPage = url != null && originOf(url) == appOrigin
            }

            // La versión "deprecated" la invoca el sistema en todas las API para errores del frame principal.
            @Deprecated("Cubre todas las API para el frame principal")
            override fun onReceivedError(view: WebView, errorCode: Int, description: String?, failingUrl: String?) {
                Log.w(TAG, "Error cargando $failingUrl: $description")
                showOfflinePage()
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                if (BuildConfig.DEBUG) Log.d("WebConsole", "${message.message()} (${message.sourceId()}:${message.lineNumber()})")
                return true
            }
        }
    }

    /** Navegación dentro del origen de la app → WebView. Cualquier otro enlace → app externa. */
    private fun handleNavigation(url: String): Boolean {
        if (originOf(url) == appOrigin) return false
        if (UrlRules.isHttp(url)) {
            try {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            } catch (e: ActivityNotFoundException) {
                Log.w(TAG, "Sin app para abrir $url")
            }
        }
        return true
    }

    private fun askWebToHandleBack() {
        if (backInFlight) return
        if (!isTrustedPage) { // p. ej. página de "sin conexión"
            finish()
            return
        }
        backInFlight = true
        webView.evaluateJavascript(
            "(function(){try{return !!(window.onAndroidBackPressed && window.onAndroidBackPressed());}catch(e){return false;}})()"
        ) { result ->
            backInFlight = false
            if (result != "true") finish() // la web está en la pantalla principal
        }
    }

    /**
     * Los mandos de Android TV envían KEYCODE_BACK: lo consumimos en ACTION_DOWN y en ACTION_UP
     * lo delegamos al OnBackPressedDispatcher (que consulta a la web).
     */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_BACK) {
            if (event.action == KeyEvent.ACTION_UP && !event.isCanceled) {
                onBackPressedDispatcher.onBackPressed()
            }
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    fun launchPlayer(intent: Intent) {
        playerLauncher.launch(intent)
    }

    private fun notifyContinueWatchingChanged() {
        if (!isTrustedPage) return
        webView.evaluateJavascript(
            "window.onContinueWatchingUpdated && window.onContinueWatchingUpdated();", null
        )
    }

    private fun showOfflinePage() {
        val target = JSONObject.quote(BuildConfig.WEB_APP_URL)
        val html = """
            <!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
            <style>body{background:#0b0b0f;color:#eceef3;font-family:sans-serif;display:flex;flex-direction:column;
            align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}
            button{background:#f5b301;border:0;border-radius:6px;padding:12px 22px;font-size:18px;font-weight:700}
            button:focus{outline:4px solid #fff;outline-offset:3px}</style></head>
            <body><h2>Sin conexión</h2><p>No se pudo cargar el catálogo.</p>
            <button autofocus onclick='location.href=$target'>Reintentar</button>
            <script>document.querySelector('button').focus()</script></body></html>
        """.trimIndent()
        webView.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enterImmersiveMode()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        notifyContinueWatchingChanged()
    }

    override fun onPause() {
        webView.onPause()
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onDestroy() {
        webView.apply {
            removeJavascriptInterface("Android")
            stopLoading()
            loadUrl("about:blank")
            (parent as? ViewGroup)?.removeView(this)
            destroy()
        }
        super.onDestroy()
    }

    private companion object {
        const val TAG = "MainActivity"

        fun originOf(url: String): String {
            val uri = Uri.parse(url)
            val scheme = uri.scheme?.lowercase() ?: return ""
            val authority = uri.encodedAuthority?.lowercase() ?: return ""
            return "$scheme://$authority"
        }
    }
}
