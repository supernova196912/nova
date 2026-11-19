package com.peliskong.app

import android.annotation.SuppressLint
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.ProgressBar
import android.widget.Spinner
import android.widget.TextView
import androidx.activity.addCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import java.io.ByteArrayInputStream
import java.util.Locale

/**
 * Reproductor web aislado para fuentes "embed".
 * - Corre en el proceso ":embed" con su propio directorio de datos de WebView (ver PeliskongApp).
 * - Intersticial previo de N segundos (config.json → embedInterstitialSeconds, por defecto 5).
 * - Sin puente JS, sin pop-ups, sin redirecciones a otros sitios y con la blacklist aplicada
 *   también a las peticiones internas (scripts/anuncios de dominios bloqueados).
 */
class EmbedPlayerActivity : AppCompatActivity() {

    private lateinit var payload: PlaybackPayload
    private val handler = Handler(Looper.getMainLooper())

    private var webView: WebView? = null
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    private lateinit var webContainer: FrameLayout
    private lateinit var fullscreenContainer: FrameLayout
    private lateinit var interstitial: View
    private lateinit var countdownText: TextView
    private lateinit var progress: ProgressBar
    private lateinit var statusText: TextView
    private lateinit var sourceSpinner: Spinner

    private var embedIndex = 0
    private var allowedBaseDomain = ""
    private var initialEmbedHost = ""
    private var initialEmbedPath = ""
    private var initialEmbedIndex = 0
    private var lastFailedEmbedIndex = -1
    private var secondsLeft = 0
    private var embedGateMonitor: Runnable? = null

    private val embedLoadTimeout = Runnable {
        if (embedIndex == initialEmbedIndex) failCurrentEmbed("tiempo de carga agotado")
    }

    private val countdown = object : Runnable {
        override fun run() {
            if (secondsLeft <= 0) {
                interstitial.visibility = View.GONE
                sourceSpinner.visibility = if (payload.embedSources.isNotEmpty()) View.VISIBLE else View.GONE
                loadEmbed(initialEmbedIndex)
                return
            }
            countdownText.text = getString(R.string.embed_starts_in, secondsLeft)
            progress.progress = progress.max - secondsLeft
            secondsLeft--
            handler.postDelayed(this, 1000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val parsed = PlaybackPayload.fromIntent(intent)
        if (parsed == null || parsed.embedSources.isEmpty()) {
            finish()
            return
        }
        payload = parsed

        setContentView(R.layout.activity_embed_player)
        enterImmersiveMode()
        webContainer = findViewById(R.id.webContainer)
        fullscreenContainer = findViewById(R.id.fullscreenContainer)
        interstitial = findViewById(R.id.interstitial)
        countdownText = findViewById(R.id.interstitialCountdown)
        progress = findViewById(R.id.interstitialProgress)
        statusText = findViewById(R.id.embedStatus)
        sourceSpinner = findViewById(R.id.embedSourceSpinner)
        findViewById<TextView>(R.id.interstitialTitle).text = payload.title
        findViewById<TextView>(R.id.interstitialSubtitle).text = payload.subtitle

        onBackPressedDispatcher.addCallback(this) {
            if (customView != null) hideCustomView() else finish()
        }

        initialEmbedIndex = intent.getIntExtra(EXTRA_INITIAL_SOURCE_INDEX, 0)
            .coerceIn(0, payload.embedSources.lastIndex)
        embedIndex = initialEmbedIndex
        configureSourceSpinner()
        secondsLeft = payload.embedInterstitialSeconds
        progress.max = secondsLeft.coerceAtLeast(1)
        handler.post(countdown)
    }

    private fun loadEmbed(index: Int) {
        val embeds = payload.embedSources
        if (index >= embeds.size) {
            showStatus(getString(R.string.all_sources_failed))
            return
        }
        embedIndex = index
        initialEmbedIndex = index
        lastFailedEmbedIndex = -1
        embedGateMonitor?.let { handler.removeCallbacks(it) }
        embedGateMonitor = null
        handler.removeCallbacks(embedLoadTimeout)
        if (sourceSpinner.selectedItemPosition != index) sourceSpinner.setSelection(index)
        val source = embeds[index]
        if (UrlRules.isBlockedAdResource(source.url, payload.blacklist)) {
            Log.i(TAG, "Servidor bloqueado por política: ${UrlRules.hostOf(source.url)}")
            showStatus(getString(R.string.trying_source, index + 1, embeds.size, source.label))
            failCurrentEmbed("servidor bloqueado por publicidad")
            return
        }
        allowedBaseDomain = UrlRules.hostOf(source.url)?.let(UrlRules::baseDomain).orEmpty()
        val initialUri = android.net.Uri.parse(source.url)
        initialEmbedHost = initialUri.host.orEmpty()
        initialEmbedPath = initialUri.path.orEmpty()
        val wv = webView ?: createWebView().also {
            webView = it
            webContainer.addView(it, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        if (index > 0) showStatus(getString(R.string.trying_source, index + 1, embeds.size, source.label))
        Log.i(TAG, "Cargando embed ${index + 1}/${embeds.size}: ${source.url}")
        wv.visibility = View.INVISIBLE
        wv.loadUrl(source.url, source.headers)
        wv.requestFocus()
        handler.postDelayed(embedLoadTimeout, EMBED_LOAD_TIMEOUT_MS)
    }

    private fun configureSourceSpinner() {
        val sources = payload.embedSources
        sourceSpinner.adapter = ArrayAdapter(
            this,
            R.layout.spinner_item,
            sources.mapIndexed { index, source ->
                "${index + 1}. ${source.label.ifBlank { getString(R.string.source) }}"
            }
        ).also { it.setDropDownViewResource(R.layout.spinner_dropdown_item) }
        sourceSpinner.setSelection(initialEmbedIndex)
        sourceSpinner.visibility = View.GONE
        sourceSpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                if (position != embedIndex && interstitial.visibility != View.VISIBLE) loadEmbed(position)
            }
        }
    }

    private fun failCurrentEmbed(reason: String) {
        val failedIndex = embedIndex
        if (lastFailedEmbedIndex == failedIndex) return
        lastFailedEmbedIndex = failedIndex
        embedGateMonitor?.let { handler.removeCallbacks(it) }
        embedGateMonitor = null
        handler.removeCallbacks(embedLoadTimeout)
        webView?.visibility = View.INVISIBLE
        Log.w(TAG, "Embed ${failedIndex + 1} falló ($reason)")
        handler.post {
            if (embedIndex != failedIndex) return@post
            val nextIndex = failedIndex + 1
            if (nextIndex < payload.embedSources.size) {
                val next = payload.embedSources[nextIndex]
                showStatus(getString(R.string.trying_source, nextIndex + 1, payload.embedSources.size, next.label))
                loadEmbed(nextIndex)
            } else {
                showStatus(getString(R.string.all_sources_failed))
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(): WebView = WebView(this).apply {
        setBackgroundColor(Color.BLACK)
        isFocusable = true
        isFocusableInTouchMode = true
        settings.apply {
            javaScriptEnabled = true            // los reproductores embed lo necesitan
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            setSupportMultipleWindows(true)     // onCreateWindow los rechaza sin cargar URL
            javaScriptCanOpenWindowsAutomatically = false
            allowFileAccess = false
            allowContentAccess = false
            setGeolocationEnabled(false)
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SAFE_BROWSING_ENABLE)) {
            WebSettingsCompat.setSafeBrowsingEnabled(settings, true)
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)

        webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                request.isForMainFrame && blockMainFrameNavigation(
                    request.url.toString(), request.hasGesture()
                )

            @Deprecated("API < 24")
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean =
                blockMainFrameNavigation(url, hasGesture = false)

            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                super.onPageStarted(view, url, favicon)
                view.evaluateJavascript(POPUP_GUARD_JS, null)
                embedGateMonitor?.let { handler.removeCallbacks(it) }
                embedGateMonitor = null
                view.visibility = View.INVISIBLE
                if (!url.isNullOrBlank() && !isInitialEmbedLocation(url)) {
                    view.stopLoading()
                    blockMainFrameNavigation(url, hasGesture = false)
                }
            }

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val url = request.url.toString()
                if (isBlockedEmbedRequest(url)) {
                    Log.d(TAG, "Recurso bloqueado por política: ${request.url.host}")
                    return WebResourceResponse("text/plain", "utf-8", ByteArrayInputStream(ByteArray(0)))
                }
                return null
            }

            override fun onPageFinished(view: WebView, url: String?) {
                if (url == view.url) {
                    view.evaluateJavascript(POPUP_GUARD_JS, null)
                    view.evaluateJavascript(EMBED_OVERLAY_GUARD_JS, null)
                    startEmbedGateMonitor(view, embedIndex, url)
                }
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: android.webkit.WebResourceError) {
                if (request.isForMainFrame && request.url.toString() == view.url) {
                    failCurrentEmbed(error.description?.toString() ?: "error de red")
                }
            }

            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
                if (request.isForMainFrame && response.statusCode >= 400 && request.url.toString() == view.url) {
                    failCurrentEmbed("HTTP ${response.statusCode}")
                }
            }

            @Deprecated("Cubre todas las API para el frame principal")
            override fun onReceivedError(view: WebView, errorCode: Int, description: String?, failingUrl: String?) {
                Log.w(TAG, "Embed falló ($description): $failingUrl")
                if (failingUrl == view.url) failCurrentEmbed(description ?: "error de carga")
            }
        }

        webChromeClient = object : WebChromeClient() {
            override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message?): Boolean = false

            override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult): Boolean {
                result.cancel()
                return true
            }

            override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult): Boolean {
                result.cancel()
                return true
            }

            override fun onJsPrompt(view: WebView, url: String, message: String, defaultValue: String, result: JsPromptResult): Boolean {
                result.cancel()
                return true
            }

            override fun onPermissionRequest(request: PermissionRequest) = request.deny()

            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                if (customView != null) {
                    callback.onCustomViewHidden()
                    return
                }
                customView = view
                customViewCallback = callback
                sourceSpinner.visibility = View.GONE
                fullscreenContainer.addView(view, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                fullscreenContainer.visibility = View.VISIBLE
                webContainer.visibility = View.GONE
                enterImmersiveMode()
            }

            override fun onHideCustomView() = hideCustomView()
        }
    }

    private fun isAllowedNavigation(url: String): Boolean {
        val ok = UrlRules.isHttp(url) &&
            UrlRules.sameSite(url, allowedBaseDomain) &&
            !UrlRules.isBlacklisted(url, payload.blacklist)
        if (!ok) Log.d(TAG, "Redirección externa bloqueada: $url")
        return ok
    }

    private fun isBlockedEmbedRequest(url: String): Boolean {
        if (!UrlRules.isHttp(url)) return false
        if (UrlRules.isBlockedAdResource(url, payload.blacklist)) return true
        val uri = Uri.parse(url)
        val host = uri.host?.lowercase(Locale.ROOT) ?: return true
        if (BLOCKED_AD_HOSTS.any { host == it || host.endsWith(".$it") }) return true
        if (BLOCKED_AD_HOST_MARKERS.any { host.contains(it) }) return true
        val pathAndQuery = (uri.encodedPath.orEmpty() + "?" + uri.encodedQuery.orEmpty())
            .lowercase(Locale.ROOT)
        if (BLOCKED_AD_PATH_MARKERS.any { marker -> pathAndQuery.contains(marker) }) return true

        val embedHostAllowed = host == initialEmbedHost || UrlRules.sameSite(url, allowedBaseDomain)
        val playerCdnAllowed = PLAYER_CDN_HOSTS.any { host == it || host.endsWith(".$it") }
        val mediaSegmentAllowed = MEDIA_SEGMENT_EXTENSIONS.any { uri.encodedPath.orEmpty().lowercase(Locale.ROOT).endsWith(it) }
        return !(embedHostAllowed || playerCdnAllowed || mediaSegmentAllowed)
    }

    private fun startEmbedGateMonitor(view: WebView, checkedIndex: Int, checkedUrl: String?) {
        embedGateMonitor?.let { handler.removeCallbacks(it) }
        val monitor = object : Runnable {
            override fun run() {
                if (embedIndex != checkedIndex || lastFailedEmbedIndex == checkedIndex || checkedUrl != view.url) return
                view.evaluateJavascript(EMBED_GATE_DETECTOR_JS) { result ->
                    if (embedIndex != checkedIndex || lastFailedEmbedIndex == checkedIndex || checkedUrl != view.url) return@evaluateJavascript
                    if (result == "true") {
                        failCurrentEmbed("el proveedor exige verificación humana")
                    } else {
                        if (view.visibility != View.VISIBLE) {
                            handler.removeCallbacks(embedLoadTimeout)
                            view.visibility = View.VISIBLE
                            showStatus(null)
                        }
                        handler.postDelayed(this, EMBED_GATE_CHECK_INTERVAL_MS)
                    }
                }
            }
        }
        embedGateMonitor = monitor
        handler.post(monitor)
    }

    private fun isInitialEmbedLocation(url: String): Boolean {
        val uri = android.net.Uri.parse(url)
        return uri.host.equals(initialEmbedHost, ignoreCase = true) && uri.path.orEmpty() == initialEmbedPath
    }

    private fun blockMainFrameNavigation(url: String, hasGesture: Boolean): Boolean {
        val blocked = hasGesture || !isInitialEmbedLocation(url) || !isAllowedNavigation(url)
        if (blocked) {
            showStatus(getString(R.string.embed_navigation_blocked))
            failCurrentEmbed("navegación o redirección bloqueada")
        }
        return blocked
    }

    private fun hideCustomView() {
        val view = customView ?: return
        fullscreenContainer.removeView(view)
        fullscreenContainer.visibility = View.GONE
        webContainer.visibility = View.VISIBLE
        customViewCallback?.onCustomViewHidden()
        customView = null
        customViewCallback = null
        if (payload.embedSources.isNotEmpty() && interstitial.visibility != View.VISIBLE) sourceSpinner.visibility = View.VISIBLE
    }

    private fun showStatus(text: String?) {
        statusText.text = text
        statusText.visibility = if (text.isNullOrBlank()) View.GONE else View.VISIBLE
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enterImmersiveMode()
    }

    override fun onResume() {
        super.onResume()
        webView?.onResume()
    }

    override fun onPause() {
        webView?.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        if (customView != null) hideCustomView()
        webView?.apply {
            stopLoading()
            loadUrl("about:blank")
            webChromeClient = null
            (parent as? ViewGroup)?.removeView(this)
            removeAllViews()
            destroy()
        }
        webView = null
        super.onDestroy()
    }

    companion object {
        private const val TAG = "EmbedPlayer"
        const val EMBED_LOAD_TIMEOUT_MS = 30_000L
        const val EXTRA_INITIAL_SOURCE_INDEX = "com.peliskong.app.INITIAL_EMBED_SOURCE_INDEX"
        private const val EMBED_GATE_CHECK_INTERVAL_MS = 500L
        private val BLOCKED_AD_HOSTS = setOf(
            "doubleclick.net", "googlesyndication.com", "adservice.google.com",
            "propellerads.com", "monetag.com", "adsterra.com", "wizads.com",
            "simplejsmenu.com", "aclib.net", "adcash.com", "popads.net",
            "onclicka.com", "hilltopads.com", "exoclick.com", "playmogo.com"
        )
        private val BLOCKED_AD_HOST_MARKERS = listOf(
            "aclib", "adcash", "popads", "onclicka", "hilltopads", "exoclick", "playmogo",
            "simplejsmenu", "adnimo", "doubleclick", "googlesyndication", "adservice",
            "propeller", "monetag", "adsterra", "wizads"
        )
        private val BLOCKED_AD_PATH_MARKERS = listOf(
            "/ads/", "popunder", "pop-under", "clickunder", "/click/", "/redirect-ad/"
        )
        private val PLAYER_CDN_HOSTS = setOf(
            "jwplayer.com", "jwpcdn.com", "jwplatform.com",
            "videojs.com", "videojs-http-streaming.net", "vjs.zencdn.net",
            "cloudflare.com", "cloudflarestream.com", "videodelivery.net",
            "cdnjs.cloudflare.com", "jsdelivr.net", "unpkg.com"
        )
        private val MEDIA_SEGMENT_EXTENSIONS = listOf(".m3u8", ".mp4", ".ts", ".vtt", ".srt", ".m4s", ".key")
        private val POPUP_GUARD_JS = """
            (function(){
              try{
                var current=Object.getOwnPropertyDescriptor(window,'open');
                if(current&&current.value&&current.value.__peliskongPopupBlocked)return true;
                var blocked=function(){return null;};
                Object.defineProperty(blocked,'__peliskongPopupBlocked',{value:true});
                Object.defineProperty(window,'open',{value:blocked,writable:false,configurable:false});
              }catch(e){}
              return true;
            })()
        """.trimIndent()
        private val EMBED_OVERLAY_GUARD_JS = """
            (function(){
              if(window.__peliskongOverlayGuardInstalled)return;
              window.__peliskongOverlayGuardInstalled=true;
              var roots=[];
              var selector='div,a,iframe';
              var controls='video,button,input,select,textarea,[role="button"],[data-plyr],[class*="control"],[class*="Control"],.jw-controlbar,.vjs-control-bar';
              function transparentLayer(node,style){
                var opacity=parseFloat(style.opacity||'1');
                if(opacity<=0.05)return true;
                if(node.tagName==='IFRAME')return false;
                var background=(style.backgroundColor||'').match(/rgba\([^)]*,\s*([0-9.]+)\s*\)/i);
                var inline=(node.getAttribute('style')||'').toLowerCase();
                var named=/overlay|click|popup|popunder|adlayer|ad-layer/.test(((node.id||'')+' '+(typeof node.className==='string'?node.className:'')).toLowerCase());
                return !!(background&&parseFloat(background[1])<=0.02&&(inline.indexOf('background')>=0||named));
              }
              function protect(node){
                if(!node||node.nodeType!==1||!node.matches||!node.matches(selector))return;
                try{
                  if(node.matches(controls)||node.querySelector('video')||node.closest(controls))return;
                  var style=window.getComputedStyle(node);
                  if(style.position!=='fixed'&&style.position!=='absolute')return;
                  var z=parseInt(style.zIndex||'0',10);
                  if(!isFinite(z)||z<=10||!transparentLayer(node,style))return;
                  var rect=node.getBoundingClientRect();
                  var width=window.innerWidth||document.documentElement.clientWidth;
                  var height=window.innerHeight||document.documentElement.clientHeight;
                  var area=Math.max(0,rect.width)*Math.max(0,rect.height);
                  if(area<=width*height*0.60)return;
                  node.style.setProperty('display','none','important');
                  node.style.setProperty('pointer-events','none','important');
                  node.setAttribute('data-peliskong-click-layer','true');
                }catch(e){}
              }
              function startVideo(video){
                if(!video||video.nodeType!==1)return;
                var source=video.currentSrc||video.getAttribute('src')||'';
                if(!source){
                  var child=video.querySelector('source[src]');
                  if(child)source=child.src||child.getAttribute('src')||'';
                }
                if(!source||!video.paused||video.__peliskongAutoplaySource===source)return;
                video.__peliskongAutoplaySource=source;
                var wasMuted=video.muted;
                video.muted=true;
                video.autoplay=true;
                video.addEventListener('playing',function(){if(!wasMuted)video.muted=false;},{once:true});
                try{
                  var attempt=video.play();
                  if(attempt&&attempt.catch)attempt.catch(function(){
                    video.muted=true;
                    try{var retry=video.play();if(retry&&retry.catch)retry.catch(function(){});}catch(e){}
                  });
                }catch(e){}
              }
              function scan(root){
                if(!root)return;
                if(root.nodeType===1)protect(root);
                var nodes=root.querySelectorAll?root.querySelectorAll(selector):[];
                for(var i=0;i<nodes.length;i++){
                  protect(nodes[i]);
                  if(nodes[i].shadowRoot)observe(nodes[i].shadowRoot);
                }
                if(root.matches&&root.matches('video'))startVideo(root);
                var videos=root.querySelectorAll?root.querySelectorAll('video'):[];
                for(var v=0;v<videos.length;v++)startVideo(videos[v]);
              }
              function observe(root){
                if(!root||roots.indexOf(root)>=0)return;
                roots.push(root);
                try{
                  new MutationObserver(function(mutations){
                    for(var i=0;i<mutations.length;i++){
                      var mutation=mutations[i];
                      if(mutation.type==='attributes')scan(mutation.target);
                      for(var j=0;j<mutation.addedNodes.length;j++)scan(mutation.addedNodes[j]);
                    }
                  }).observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['style','class','id']});
                }catch(e){}
                scan(root);
              }
              observe(document.documentElement);
              window.setInterval(function(){scan(document);},300);
            })()
        """.trimIndent()
        private val EMBED_GATE_DETECTOR_JS = """
            (function(){
              if(!window.__peliskongGateGuard){
                window.__peliskongGateGuard=true;
                window.__peliskongGateFound=false;
                var observed=[];
                function collect(root,seen){
                  if(!root||seen.indexOf(root)!==-1)return '';
                  seen.push(root);
                  var text=root.body?(root.body.innerText||''):(root.innerText||root.textContent||'');
                  var nodes=root.querySelectorAll?root.querySelectorAll('*'):[];
                  for(var i=0;i<nodes.length;i++)if(nodes[i].shadowRoot)text+=' '+collect(nodes[i].shadowRoot,seen);
                  return text;
                }
                function inspect(){
                  var text=((document.title||'')+' '+collect(document,[])).toLowerCase();
                  var blocked=/verifica.{0,60}humano|verify.{0,60}human|are you human|i am human|i am not a robot|captcha|altcha|hcaptcha|recaptcha|human verification/.test(text);
                  if(blocked){
                    window.__peliskongGateFound=true;
                    if(document.documentElement&&document.documentElement.style.visibility!=='hidden')document.documentElement.style.visibility='hidden';
                  }
                  window.alert=function(){return undefined;};
                  window.confirm=function(){return false;};
                  window.prompt=function(){return null;};
                  try{if(window.Notification)window.Notification.requestPermission=function(){return Promise.resolve('denied');};}catch(e){}
                }
                function observe(root){
                  if(!root||observed.indexOf(root)!==-1)return;
                  observed.push(root);
                  try{new MutationObserver(inspect).observe(root,{childList:true,subtree:true,attributes:true,characterData:true});}catch(e){}
                  var nodes=root.querySelectorAll?root.querySelectorAll('*'):[];
                  for(var i=0;i<nodes.length;i++)if(nodes[i].shadowRoot)observe(nodes[i].shadowRoot);
                }
                window.__peliskongGateScan=inspect;
                observe(document.documentElement);
                inspect();
                window.setInterval(inspect,300);
              }
              window.__peliskongGateScan();
              return !!window.__peliskongGateFound;
            })()
        """.trimIndent()
    }
}
