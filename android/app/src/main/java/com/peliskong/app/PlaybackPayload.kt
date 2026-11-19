package com.peliskong.app

import android.content.Intent
import org.json.JSONArray
import org.json.JSONObject

data class SubtitleTrack(val url: String, val label: String)

data class MediaSource(
    val type: String,
    val url: String,
    val label: String,
    val headers: Map<String, String>,
    val subtitles: List<SubtitleTrack>
) {
    companion object {
        const val TYPE_DIRECT = "direct"
        const val TYPE_EMBED = "embed"
    }
}

data class Preroll(val url: String, val skipAfterSeconds: Int)

/**
 * Contrato entre la web y los reproductores nativos (lo arma app.js → buildPayload()).
 * Se transporta entre Activities como JSON crudo para que también cruce al proceso ":embed".
 */
data class PlaybackPayload(
    val rawJson: String,
    val id: String,
    val titleId: String,
    val type: String,
    val title: String,
    val subtitle: String,
    val poster: String,
    val episodeId: String?,
    val season: Int?,
    val episode: Int?,
    val startPositionMs: Long,
    val sources: List<MediaSource>,
    val preroll: Preroll?,
    val embedInterstitialSeconds: Int,
    val blacklist: List<String>
) {
    val directSources: List<MediaSource> get() = sources.filter { it.type == MediaSource.TYPE_DIRECT }
    val embedSources: List<MediaSource> get() = sources.filter { it.type == MediaSource.TYPE_EMBED }

    /** Entrada para "Seguir viendo" (mismo formato que usa la web en localStorage). */
    fun toProgressEntry(positionMs: Long, durationMs: Long): JSONObject = JSONObject().apply {
        put("id", id)
        put("titleId", titleId)
        put("type", type)
        put("title", title)
        put("subtitle", subtitle)
        put("poster", poster)
        put("episodeId", episodeId ?: JSONObject.NULL)
        put("season", season ?: JSONObject.NULL)
        put("episode", episode ?: JSONObject.NULL)
        put("positionMs", positionMs)
        put("durationMs", durationMs)
        put("updatedAt", System.currentTimeMillis())
    }

    companion object {
        const val EXTRA = "com.peliskong.app.PAYLOAD"

        fun fromIntent(intent: Intent?): PlaybackPayload? = intent?.getStringExtra(EXTRA)?.let(::parse)

        /** Parsea y sanea: solo http/https, solo tipos conocidos y nada que esté en la blacklist. */
        fun parse(json: String): PlaybackPayload? = runCatching {
            val o = JSONObject(json)
            val blacklist = o.optJSONArray("blacklist").strings().map { it.lowercase().trim() }.filter { it.isNotEmpty() }
            val sources = o.optJSONArray("sources").objects().mapNotNull { s ->
                val type = s.optString("type")
                val url = s.optString("url")
                if ((type != MediaSource.TYPE_DIRECT && type != MediaSource.TYPE_EMBED) ||
                    !UrlRules.isHttp(url) || UrlRules.isBlacklisted(url, blacklist)
                ) return@mapNotNull null
                val headers = s.optJSONObject("headers")?.let { h ->
                    h.keys().asSequence().associateWith { k -> h.optString(k) }
                } ?: emptyMap()
                val subs = s.optJSONArray("subtitles").objects().mapNotNull { sub ->
                    val u = sub.optString("url")
                    if (UrlRules.isHttp(u)) SubtitleTrack(u, sub.optString("label", sub.optString("lang", "Subtítulo"))) else null
                }
                MediaSource(type, url, s.optString("label", type), headers, subs)
            }
            val id = o.optStringOrNull("id") ?: return null
            PlaybackPayload(
                rawJson = json,
                id = id,
                titleId = o.optStringOrNull("titleId") ?: id,
                type = o.optString("type", "movie"),
                title = o.optString("title"),
                subtitle = o.optStringOrNull("subtitle") ?: "",
                poster = o.optStringOrNull("poster") ?: "",
                episodeId = o.optStringOrNull("episodeId"),
                season = if (o.isNull("season")) null else o.optInt("season"),
                episode = if (o.isNull("episode")) null else o.optInt("episode"),
                startPositionMs = o.optLong("startPositionMs", 0L).coerceAtLeast(0L),
                sources = sources,
                preroll = null,
                embedInterstitialSeconds = 0,
                blacklist = blacklist
            )
        }.getOrNull()

        private fun JSONObject.optStringOrNull(key: String): String? =
            if (isNull(key)) null else optString(key).takeIf { it.isNotEmpty() }

        private fun JSONArray?.objects(): List<JSONObject> =
            if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }

        private fun JSONArray?.strings(): List<String> =
            if (this == null) emptyList() else (0 until length()).mapNotNull { optString(it, null) }
    }
}
