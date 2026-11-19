package com.peliskong.app

import android.app.Application
import android.os.Build
import android.webkit.WebView

class PeliskongApp : Application() {

    override fun onCreate() {
        super.onCreate()
        // Android 9+ exige que cada proceso que use WebView tenga su propio directorio de datos.
        // El proceso ":embed" (EmbedPlayerActivity) queda así aislado del WebView principal.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val process = getProcessName()
            if (process != packageName) {
                WebView.setDataDirectorySuffix(process.substringAfter(':', "secondary"))
            }
        }
    }
}
