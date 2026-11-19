package com.peliskong.app

import android.app.Activity
import android.app.UiModeManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.view.WindowManager
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.util.Locale

/** Detecta Android TV por modo de UI o por la característica Leanback. */
fun Context.isTvDevice(): Boolean {
    val uiMode = getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
    if (uiMode?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION) return true
    return packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
}

/** Pantalla completa inmersiva: oculta barras de estado y navegación (reaparecen con un deslizamiento). */
fun Activity.enterImmersiveMode() {
    WindowCompat.setDecorFitsSystemWindows(window, false)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        window.attributes = window.attributes.apply {
            layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
    }
    WindowInsetsControllerCompat(window, window.decorView).apply {
        hide(WindowInsetsCompat.Type.systemBars())
        systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }
}

object UrlRules {

    private val blockedAdHosts = setOf("playmogo.com")
    private val adPathMarkers = listOf("/ads/", "popunder", "pop-under")

    fun isHttp(url: String?): Boolean {
        val scheme = url?.let { Uri.parse(it).scheme?.lowercase(Locale.ROOT) }
        return scheme == "http" || scheme == "https"
    }

    fun hostOf(url: String?): String? = url?.let { Uri.parse(it).host?.lowercase(Locale.ROOT) }

    /** true si el host coincide con un dominio de la blacklist o es subdominio de él. */
    fun isBlacklisted(url: String?, blacklist: List<String>): Boolean {
        val host = hostOf(url) ?: return true
        return blacklist.any { host == it || host.endsWith(".$it") }
    }

    /** Bloquea dominios y rutas de recursos vetados por la política del reproductor. */
    fun isBlockedAdResource(url: String?, blacklist: List<String>): Boolean {
        if (!isHttp(url)) return false
        val host = hostOf(url) ?: return true
        if (blacklist.any { host == it || host.endsWith(".$it") }) return true
        if (blockedAdHosts.any { host == it || host.endsWith(".$it") }) return true
        val uri = Uri.parse(url)
        val pathAndQuery = (uri.encodedPath.orEmpty() + "?" + uri.encodedQuery.orEmpty())
            .lowercase(Locale.ROOT)
        return adPathMarkers.any { marker -> pathAndQuery.contains(marker) }
    }

    /**
     * Aproximación simple de "dominio registrable" (últimas dos etiquetas).
     * Suficiente para permitir redirecciones www/cdn del mismo sitio en el reproductor embed.
     * Para dominios tipo .com.ar/.co.uk considera usar la Public Suffix List.
     */
    fun baseDomain(host: String): String {
        val parts = host.split('.')
        return if (parts.size <= 2) host else parts.takeLast(2).joinToString(".")
    }

    fun sameSite(url: String?, allowedBase: String): Boolean {
        val host = hostOf(url) ?: return false
        return host == allowedBase || host.endsWith(".$allowedBase")
    }
}

fun formatTime(ms: Long): String {
    val total = (ms.coerceAtLeast(0) / 1000)
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) String.format(Locale.US, "%d:%02d:%02d", h, m, s)
    else String.format(Locale.US, "%d:%02d", m, s)
}
