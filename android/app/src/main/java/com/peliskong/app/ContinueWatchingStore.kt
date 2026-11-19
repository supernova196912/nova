package com.peliskong.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Historial "Seguir viendo" en SharedPreferences, como un JSON array de entradas:
 * { id, titleId, type, title, subtitle, poster, episodeId, season, episode, positionMs, durationMs, updatedAt }
 *
 * Lo usan el puente JS (hilo JavaBridge) y NativePlayerActivity (hilo UI): por eso @Synchronized.
 */
class ContinueWatchingStore(context: Context) {

    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    @Synchronized
    fun getAllJson(): String = JSONArray(readAll()).toString()

    /** Acepta una entrada (objeto) o varias (array). Hace merge por "id" conservando campos previos. */
    @Synchronized
    fun upsertJson(json: String) {
        val trimmed = json.trim()
        val incoming = if (trimmed.startsWith("[")) {
            val arr = JSONArray(trimmed)
            (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }
        } else listOf(JSONObject(trimmed))
        val list = readAll().toMutableList()
        incoming.forEach { merge(list, it) }
        write(list)
    }

    @Synchronized
    fun upsert(entry: JSONObject) {
        val list = readAll().toMutableList()
        merge(list, entry)
        write(list)
    }

    @Synchronized
    fun remove(id: String) {
        write(readAll().filter { it.optString("id") != id })
    }

    private fun merge(list: MutableList<JSONObject>, entry: JSONObject) {
        val id = entry.optString("id").takeIf { it.isNotEmpty() && !entry.isNull("id") } ?: return
        val existing = list.firstOrNull { it.optString("id") == id }
        val target = existing ?: JSONObject().also { list.add(it) }
        entry.keys().forEach { k -> target.put(k, entry.opt(k)) }
        if (!entry.has("updatedAt")) target.put("updatedAt", System.currentTimeMillis())
    }

    private fun readAll(): List<JSONObject> = runCatching {
        val arr = JSONArray(prefs.getString(KEY, "[]") ?: "[]")
        (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }
    }.getOrElse { emptyList() }

    private fun write(list: List<JSONObject>) {
        val sorted = list.sortedByDescending { it.optLong("updatedAt", 0L) }.take(MAX_ENTRIES)
        prefs.edit().putString(KEY, JSONArray(sorted).toString()).apply()
    }

    private companion object {
        const val PREFS = "continue_watching"
        const val KEY = "entries"
        const val MAX_ENTRIES = 50
    }
}
