package com.peliskong.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.ImageButton
import android.widget.ProgressBar
import android.widget.SeekBar
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.activity.addCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import org.videolan.libvlc.LibVLC
import org.videolan.libvlc.Media
import org.videolan.libvlc.MediaPlayer
import org.videolan.libvlc.interfaces.IMedia
import org.videolan.libvlc.util.VLCVideoLayout
import java.util.Locale

/**
 * Reproductor nativo LibVLC:
 *  1. Pre-roll publicitario con botón "Saltar" bloqueado N segundos (config.json → preroll).
 *  2. Contenido principal con reanudación, pistas de audio/subtítulos y failover automático
 *     al siguiente "direct" de `sources`; si se agotan, pasa a los "embed" (EmbedPlayerActivity).
 *  3. Guarda la posición en "Seguir viendo" (periódicamente, en onStop y en onDestroy) y la
 *     devuelve como resultado a MainActivity.
 */
class NativePlayerActivity : AppCompatActivity() {

    private enum class Phase { AD, CONTENT, FAILED, FINISHED }

    private lateinit var payload: PlaybackPayload
    private lateinit var store: ContinueWatchingStore

    private var libVlc: LibVLC? = null
    private var player: MediaPlayer? = null
    private val handler = Handler(Looper.getMainLooper())

    // Vistas
    private lateinit var root: View
    private lateinit var videoLayout: VLCVideoLayout
    private lateinit var loading: ProgressBar
    private lateinit var statusText: TextView
    private lateinit var adBadge: TextView
    private lateinit var skipAdButton: Button
    private lateinit var controls: View
    private lateinit var positionText: TextView
    private lateinit var durationText: TextView
    private lateinit var seekBar: SeekBar
    private lateinit var playPauseButton: ImageButton
    private lateinit var sourceSpinner: Spinner

    // Estado
    private var phase = Phase.AD
    private var sourceIndex = 0
    private var currentStarted = false     // la fuente/anuncio actual llegó a "Playing"
    private var contentEverStarted = false // algún stream de contenido llegó a reproducirse
    private var adUnlocked = false
    private var adSecondsLeft = 0
    private var resumePositionMs = 0L
    private var lastPositionMs = 0L
    private var lastDurationMs = 0L
    private var lastSaveAt = 0L
    private var currentFailed = false      // evita doble failover por varios eventos del mismo medio
    private var resumeOnStart = false
    private var userSeeking = false

    private val startTimeout = Runnable { onSourceFailed("timeout sin reproducir") }
    private val hideControlsRunnable = Runnable { hideControls() }
    private val adTick = object : Runnable {
        override fun run() {
            if (phase != Phase.AD) return
            if (adSecondsLeft <= 0) {
                adUnlocked = true
                skipAdButton.isEnabled = true
                skipAdButton.text = getString(R.string.skip_ad)
                skipAdButton.requestFocus()
                return
            }
            skipAdButton.isEnabled = false
            skipAdButton.text = getString(R.string.skip_ad_in, adSecondsLeft)
            adSecondsLeft--
            handler.postDelayed(this, 1000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val parsed = PlaybackPayload.fromIntent(intent)
        if (parsed == null) {
            finish()
            return
        }
        payload = parsed
        store = ContinueWatchingStore(this)
        resumePositionMs = payload.startPositionMs

        setContentView(R.layout.activity_native_player)
        enterImmersiveMode()
        bindViews()
        initLibVlc()

        onBackPressedDispatcher.addCallback(this) {
            if (phase == Phase.CONTENT && controls.visibility == View.VISIBLE) hideControls()
            else finishWithResult()
        }

        startContent(0)
    }

    private fun bindViews() {
        root = findViewById(R.id.root)
        videoLayout = findViewById(R.id.videoLayout)
        loading = findViewById(R.id.loading)
        statusText = findViewById(R.id.statusText)
        adBadge = findViewById(R.id.adBadge)
        skipAdButton = findViewById(R.id.skipAdButton)
        controls = findViewById(R.id.controls)
        positionText = findViewById(R.id.positionText)
        durationText = findViewById(R.id.durationText)
        seekBar = findViewById(R.id.seekBar)
        playPauseButton = findViewById(R.id.playPauseButton)

        findViewById<TextView>(R.id.titleText).text = payload.title
        findViewById<TextView>(R.id.subtitleText).apply {
            text = payload.subtitle
            visibility = if (payload.subtitle.isBlank()) View.GONE else View.VISIBLE
        }

        root.setOnClickListener { if (phase == Phase.CONTENT) toggleControls() }
        skipAdButton.setOnClickListener { if (adUnlocked) endAd() }
        playPauseButton.setOnClickListener { togglePlayPause() }
        findViewById<View>(R.id.rewindButton).setOnClickListener { seekBy(-SEEK_STEP_MS) }
        findViewById<View>(R.id.forwardButton).setOnClickListener { seekBy(SEEK_STEP_MS) }
        findViewById<View>(R.id.audioButton).setOnClickListener { showTrackDialog(audio = true) }
        findViewById<View>(R.id.subtitlesButton).setOnClickListener { showTrackDialog(audio = false) }
        sourceSpinner = findViewById(R.id.sourceSpinner)
        configureSourceSpinner()

        seekBar.keyProgressIncrement = SEEK_STEP_MS.toInt()
        seekBar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(bar: SeekBar, progress: Int, fromUser: Boolean) {
                if (!fromUser) return
                positionText.text = formatTime(progress.toLong())
                if (!userSeeking) seekTo(progress.toLong()) // D-pad sobre la barra
                scheduleHideControls()
            }
            override fun onStartTrackingTouch(bar: SeekBar) { userSeeking = true }
            override fun onStopTrackingTouch(bar: SeekBar) {
                userSeeking = false
                seekTo(bar.progress.toLong())
            }
        })
    }

    private fun initLibVlc() {
        val options = arrayListOf(
            "--network-caching=$NETWORK_CACHING_MS",
            "--http-reconnect",
            "--audio-time-stretch"
        )
        if (BuildConfig.DEBUG) options += "-vv"
        val vlc = LibVLC(this, options)
        libVlc = vlc
        player = MediaPlayer(vlc).also {
            it.attachViews(videoLayout, null, true, false) // subtítulos activados, SurfaceView
            it.setEventListener { event -> onPlayerEvent(event) }
        }
    }

    // ------------------------------------------------------------ reproducción

    private fun playMedia(url: String, headers: Map<String, String>, startMs: Long) {
        val vlc = libVlc ?: return
        val mp = player ?: return
        currentStarted = false
        currentFailed = false
        mp.stop()
        val media = Media(vlc, Uri.parse(url)).apply {
            setHWDecoderEnabled(true, false)
            addOption(":network-caching=$NETWORK_CACHING_MS")
            headers.forEach { (k, v) ->
                when (k.lowercase(Locale.ROOT)) {
                    "user-agent" -> addOption(":http-user-agent=$v")
                    "referer", "referrer" -> addOption(":http-referrer=$v")
                }
            }
            if (startMs > 0) addOption(String.format(Locale.US, ":start-time=%.3f", startMs / 1000.0))
        }
        mp.media = media
        media.release()
        mp.play()
        loading.visibility = View.VISIBLE
        handler.removeCallbacks(startTimeout)
        handler.postDelayed(startTimeout, SOURCE_START_TIMEOUT_MS)
    }

    private fun playAd(preroll: Preroll) {
        phase = Phase.AD
        adUnlocked = preroll.skipAfterSeconds <= 0
        adSecondsLeft = preroll.skipAfterSeconds
        hideControls()
        adBadge.visibility = View.VISIBLE
        skipAdButton.visibility = View.VISIBLE
        skipAdButton.isEnabled = false
        skipAdButton.text = getString(R.string.skip_ad_in, adSecondsLeft)
        playMedia(preroll.url, emptyMap(), 0)
    }

    private fun endAd() {
        if (phase != Phase.AD) return
        handler.removeCallbacks(adTick)
        adBadge.visibility = View.GONE
        skipAdButton.visibility = View.GONE
        startContent(0)
    }

    private fun startContent(index: Int) {
        val directs = payload.directSources
        if (index >= directs.size) {
            onAllDirectSourcesFailed()
            return
        }
        phase = Phase.CONTENT
        sourceIndex = index
        if (sourceSpinner.selectedItemPosition != index) sourceSpinner.setSelection(index)
        val source = directs[index]
        showStatus(if (index > 0) getString(R.string.trying_source, index + 1, directs.size, source.label) else null)
        Log.i(TAG, "Reproduciendo fuente ${index + 1}/${directs.size}: ${source.url}")
        playMedia(source.url, source.headers, resumePositionMs)
        source.subtitles.forEach { sub ->
            player?.addSlave(IMedia.Slave.Type.Subtitle, Uri.parse(sub.url), false)
        }
    }

    /** Failover: error, fin prematuro o timeout → siguiente fuente. */
    private fun onSourceFailed(reason: String) {
        if (currentFailed) return
        currentFailed = true
        handler.removeCallbacks(startTimeout)
        when (phase) {
            Phase.AD -> {
                Log.w(TAG, "El anuncio falló ($reason); se pasa al contenido")
                endAd()
            }
            Phase.CONTENT -> {
                Log.w(TAG, "Fuente ${sourceIndex + 1} falló ($reason)")
                if (lastPositionMs > resumePositionMs) resumePositionMs = lastPositionMs
                startContent(sourceIndex + 1)
            }
            else -> Unit
        }
    }

    private fun onAllDirectSourcesFailed() {
        if (payload.embedSources.isNotEmpty()) {
            openEmbedSource(0)
            return
        }
        phase = Phase.FAILED
        player?.stop()
        loading.visibility = View.GONE
        showStatus(getString(R.string.all_sources_failed))
    }

    private fun onPlayerEvent(event: MediaPlayer.Event) {
        when (event.type) {
            MediaPlayer.Event.Playing -> {
                loading.visibility = View.GONE
                playPauseButton.setImageResource(android.R.drawable.ic_media_pause)
                if (!currentStarted) {
                    currentStarted = true
                    handler.removeCallbacks(startTimeout)
                    if (phase == Phase.AD) {
                        handler.removeCallbacks(adTick)
                        handler.post(adTick)
                    } else if (phase == Phase.CONTENT) {
                        contentEverStarted = true
                        handler.postDelayed({ showStatus(null) }, 1500)
                        showControls()
                    }
                }
            }
            MediaPlayer.Event.Paused -> playPauseButton.setImageResource(android.R.drawable.ic_media_play)
            MediaPlayer.Event.Buffering ->
                loading.visibility = if (event.buffering < 100f) View.VISIBLE else View.GONE
            MediaPlayer.Event.TimeChanged -> if (phase == Phase.CONTENT) {
                lastPositionMs = event.timeChanged
                if (!userSeeking) {
                    seekBar.progress = lastPositionMs.toInt()
                    positionText.text = formatTime(lastPositionMs)
                }
                val now = SystemClock.elapsedRealtime()
                if (now - lastSaveAt > PROGRESS_SAVE_INTERVAL_MS) {
                    lastSaveAt = now
                    saveProgress()
                }
            }
            MediaPlayer.Event.LengthChanged -> if (phase == Phase.CONTENT) {
                lastDurationMs = event.lengthChanged
                seekBar.max = lastDurationMs.toInt().coerceAtLeast(0)
                durationText.text = formatTime(lastDurationMs)
            }
            MediaPlayer.Event.EndReached -> when (phase) {
                Phase.AD -> endAd()
                Phase.CONTENT ->
                    if (!currentStarted || lastPositionMs < 1000) onSourceFailed("EndReached sin reproducir")
                    else onContentFinished()
                else -> Unit
            }
            MediaPlayer.Event.EncounteredError -> onSourceFailed("EncounteredError")
        }
    }

    private fun onContentFinished() {
        phase = Phase.FINISHED
        store.remove(payload.id) // terminado → sale de "Seguir viendo"
        setResult(RESULT_OK, Intent().putExtra(RESULT_POSITION_MS, 0L).putExtra(RESULT_FINISHED, true))
        finish()
    }

    // ------------------------------------------------------------ progreso

    private fun currentPosition(): Long {
        val t = player?.time ?: -1L
        return if (phase == Phase.CONTENT && currentStarted && t > 0) t else lastPositionMs
    }

    private fun saveProgress() {
        if (!contentEverStarted || phase == Phase.FINISHED) return
        val pos = currentPosition().takeIf { it > 0 } ?: resumePositionMs
        val dur = lastDurationMs
        if (dur > 0 && pos >= dur * FINISHED_RATIO) {
            store.remove(payload.id)
        } else if (pos >= MIN_SAVE_POSITION_MS) {
            store.upsert(payload.toProgressEntry(pos, dur))
        }
        setResult(RESULT_OK, Intent().putExtra(RESULT_POSITION_MS, pos).putExtra(RESULT_DURATION_MS, dur))
    }

    private fun finishWithResult() {
        saveProgress()
        finish()
    }

    // ------------------------------------------------------------ controles

    private fun togglePlayPause() {
        val mp = player ?: return
        if (mp.isPlaying) mp.pause() else mp.play()
        showControls()
    }

    private fun seekBy(deltaMs: Long) {
        val target = (currentPosition() + deltaMs).coerceIn(0L, if (lastDurationMs > 0) lastDurationMs else Long.MAX_VALUE)
        seekTo(target)
        showControls()
    }

    private fun seekTo(ms: Long) {
        if (phase != Phase.CONTENT) return
        player?.setTime(ms)
        lastPositionMs = ms
        seekBar.progress = ms.toInt()
        positionText.text = formatTime(ms)
    }

    private fun toggleControls() {
        if (controls.visibility == View.VISIBLE) hideControls() else showControls()
    }

    private fun showControls() {
        if (phase != Phase.CONTENT) return
        if (controls.visibility != View.VISIBLE) {
            controls.visibility = View.VISIBLE
            playPauseButton.requestFocus()
        }
        scheduleHideControls()
    }

    private fun scheduleHideControls() {
        handler.removeCallbacks(hideControlsRunnable)
        handler.postDelayed(hideControlsRunnable, CONTROLS_HIDE_MS)
    }

    private fun hideControls() {
        handler.removeCallbacks(hideControlsRunnable)
        controls.visibility = View.GONE
        root.requestFocus()
    }

    private fun showStatus(text: String?) {
        statusText.text = text
        statusText.visibility = if (text.isNullOrBlank()) View.GONE else View.VISIBLE
    }

    private fun showTrackDialog(audio: Boolean) {
        val mp = player ?: return
        val tracks = (if (audio) mp.audioTracks else mp.spuTracks) ?: emptyArray()
        if (tracks.isEmpty()) {
            Toast.makeText(this, R.string.no_tracks, Toast.LENGTH_SHORT).show()
            return
        }
        val current = if (audio) mp.audioTrack else mp.spuTrack
        val names = tracks.map { it.name ?: "Pista ${it.id}" }.toTypedArray()
        val checked = tracks.indexOfFirst { it.id == current }
        handler.removeCallbacks(hideControlsRunnable)
        AlertDialog.Builder(this)
            .setTitle(if (audio) R.string.audio else R.string.subtitles)
            .setSingleChoiceItems(names, checked) { dialog, which ->
                val id = tracks[which].id
                if (audio) mp.setAudioTrack(id) else mp.setSpuTrack(id)
                dialog.dismiss()
            }
            .setOnDismissListener { scheduleHideControls() }
            .show()
    }

    private fun configureSourceSpinner() {
        val directs = payload.directSources
        val embeds = payload.embedSources
        val labels = directs.mapIndexed { i, source -> "${i + 1}. ${source.label}" } +
            embeds.mapIndexed { i, source -> "${directs.size + i + 1}. ${source.label} (web)" }
        sourceSpinner.adapter = ArrayAdapter(
            this,
            R.layout.spinner_item,
            labels
        ).also { it.setDropDownViewResource(R.layout.spinner_dropdown_item) }
        sourceSpinner.setSelection(0, false)
        sourceSpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                if (position < directs.size) {
                    if (position != sourceIndex) {
                        if (lastPositionMs > 0) resumePositionMs = lastPositionMs
                        startContent(position)
                    }
                } else {
                    if (lastPositionMs > 0) resumePositionMs = lastPositionMs
                    openEmbedSource(position - directs.size)
                }
            }
        }
    }

    private fun openEmbedSource(index: Int) {
        val embeds = payload.embedSources
        if (index !in embeds.indices) {
            phase = Phase.FAILED
            player?.stop()
            loading.visibility = View.GONE
            showStatus(getString(R.string.all_sources_failed))
            return
        }
        saveProgress()
        startActivity(
            Intent(this, EmbedPlayerActivity::class.java)
                .putExtra(PlaybackPayload.EXTRA, payload.rawJson)
                .putExtra(EmbedPlayerActivity.EXTRA_INITIAL_SOURCE_INDEX, index)
                .addFlags(Intent.FLAG_ACTIVITY_FORWARD_RESULT)
        )
        finish()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val code = event.keyCode
        if (code == KeyEvent.KEYCODE_BACK) return super.dispatchKeyEvent(event)

        // Anuncio: todo bloqueado salvo "Atrás" y el botón Saltar una vez habilitado.
        if (phase == Phase.AD) {
            val isSelect = code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER
            return if (adUnlocked && (isSelect || code == KeyEvent.KEYCODE_DPAD_RIGHT || code == KeyEvent.KEYCODE_DPAD_DOWN))
                super.dispatchKeyEvent(event) else true
        }
        if (phase != Phase.CONTENT) return super.dispatchKeyEvent(event)

        if (event.action == KeyEvent.ACTION_DOWN) {
            val controlsVisible = controls.visibility == View.VISIBLE
            when (code) {
                KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_SPACE -> { togglePlayPause(); return true }
                KeyEvent.KEYCODE_MEDIA_PLAY -> { player?.play(); showControls(); return true }
                KeyEvent.KEYCODE_MEDIA_PAUSE -> { player?.pause(); showControls(); return true }
                KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> { seekBy(SEEK_STEP_MS); return true }
                KeyEvent.KEYCODE_MEDIA_REWIND -> { seekBy(-SEEK_STEP_MS); return true }
                KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT -> if (!controlsVisible) {
                    seekBy(if (code == KeyEvent.KEYCODE_DPAD_LEFT) -SEEK_STEP_MS else SEEK_STEP_MS)
                    return true
                }
                KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER,
                KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN -> if (!controlsVisible) {
                    showControls()
                    return true
                }
            }
            if (controlsVisible) scheduleHideControls()
        }
        return super.dispatchKeyEvent(event)
    }

    // ------------------------------------------------------------ ciclo de vida

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enterImmersiveMode()
    }

    override fun onStart() {
        super.onStart()
        if (resumeOnStart) {
            resumeOnStart = false
            player?.play()
        }
    }

    override fun onStop() {
        super.onStop()
        if (!::payload.isInitialized) return
        resumeOnStart = player?.isPlaying == true
        player?.pause()
        saveProgress()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        if (::payload.isInitialized) saveProgress()
        releasePlayer()
        super.onDestroy()
    }

    private fun releasePlayer() {
        player?.let {
            it.setEventListener(null)
            it.stop()
            it.detachViews()
            it.release()
        }
        player = null
        libVlc?.release()
        libVlc = null
    }

    companion object {
        const val RESULT_POSITION_MS = "positionMs"
        const val RESULT_DURATION_MS = "durationMs"
        const val RESULT_FINISHED = "finished"

        private const val TAG = "NativePlayer"
        private const val NETWORK_CACHING_MS = 1500
        private const val SOURCE_START_TIMEOUT_MS = 20_000L
        private const val CONTROLS_HIDE_MS = 4_000L
        private const val PROGRESS_SAVE_INTERVAL_MS = 15_000L
        private const val SEEK_STEP_MS = 10_000L
        private const val MIN_SAVE_POSITION_MS = 5_000L
        private const val FINISHED_RATIO = 0.95
    }
}
