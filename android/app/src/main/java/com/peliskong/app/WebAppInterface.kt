package com.peliskong.app

import android.content.Intent
import android.util.Log
import android.webkit.JavascriptInterface

/**
 * Puente expuesto a la web como window.Android.
 * Los métodos corren en el hilo "JavaBridge" (no en el hilo UI).
 * Solo responden si la página cargada pertenece al origen de BuildConfig.WEB_APP_URL.
 */
class WebAppInterface(
    private val activity: MainActivity,
    private val store: ContinueWatchingStore
) {

    @JavascriptInterface
    fun isTvMode(): Boolean = activity.isTvDevice()

    @JavascriptInterface
    fun getAppVersion(): String = BuildConfig.VERSION_NAME

    @JavascriptInterface
    fun getContinueWatchingData(): String =
        if (activity.isTrustedPage) store.getAllJson() else "[]"

    @JavascriptInterface
    fun syncContinueWatching(json: String?) {
        if (!activity.isTrustedPage || json.isNullOrBlank()) return
        runCatching { store.upsertJson(json) }.onFailure { Log.w(TAG, "syncContinueWatching inválido", it) }
    }

    @JavascriptInterface
    fun removeContinueWatching(id: String?) {
        if (!activity.isTrustedPage || id.isNullOrBlank()) return
        store.remove(id)
    }

    /**
     * Enrutador: si la primera fuente (ya filtrada y ordenada por la web) es "direct" abre el
     * reproductor nativo LibVLC (que hará failover y, si se agotan, saltará a los embeds);
     * si es "embed" abre el reproductor web aislado.
     */
    @JavascriptInterface
    fun playContent(payloadJson: String?) {
        if (!activity.isTrustedPage || payloadJson.isNullOrBlank()) return
        val payload = PlaybackPayload.parse(payloadJson)
        val first = payload?.sources?.firstOrNull()
        if (payload == null || first == null) {
            Log.w(TAG, "playContent sin fuentes válidas")
            return
        }
        val target = if (first.type == MediaSource.TYPE_DIRECT) NativePlayerActivity::class.java
        else EmbedPlayerActivity::class.java
        val intent = Intent(activity, target).putExtra(PlaybackPayload.EXTRA, payload.rawJson)
        activity.runOnUiThread { activity.launchPlayer(intent) }
    }

    private companion object {
        const val TAG = "WebAppInterface"
    }
}
