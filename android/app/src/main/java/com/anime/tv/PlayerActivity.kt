package com.anime.tv

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.WindowManager
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import org.json.JSONArray
import org.json.JSONObject

class PlayerActivity : AppCompatActivity() {
    companion object {
        const val EXTRA_PLAYLIST = "playlist"
        const val EXTRA_INDEX = "index"
        const val EXTRA_SAVED = "saved"
        const val EXTRA_POSITIONS = "positions"
    }

    private var player: ExoPlayer? = null
    private val ids = mutableListOf<String>()
    private val positions = JSONObject()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val cfg = Config(this)

        val http = DefaultHttpDataSource.Factory().setAllowCrossProtocolRedirects(true).apply {
            cfg.authHeader()?.let { setDefaultRequestProperties(mapOf("Authorization" to it)) }
        }
        val exo = ExoPlayer.Builder(this, DefaultRenderersFactory(this).setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON))
            .setMediaSourceFactory(DefaultMediaSourceFactory(http))
            .setSeekBackIncrementMs(10_000)
            .setSeekForwardIncrementMs(10_000)
            .build()
        player = exo

        val view = PlayerView(this).apply {
            this.player = exo
            setShowSubtitleButton(true)
            controllerShowTimeoutMs = 4000
            keepScreenOn = true
        }
        setContentView(view)
        view.requestFocus()

        val list = JSONArray(intent.getStringExtra(EXTRA_PLAYLIST) ?: "[]")
        val saved = JSONObject(intent.getStringExtra(EXTRA_SAVED) ?: "{}")
        val items = (0 until list.length()).map { i ->
            val o = list.getJSONObject(i)
            ids.add(o.getString("id"))
            val subs = o.optJSONArray("subs") ?: JSONArray()
            MediaItem.Builder()
                .setUri(cfg.absolute(o.getString("url")))
                .setMediaId(o.getString("id"))
                .setSubtitleConfigurations((0 until subs.length()).map { n ->
                    val s = subs.getJSONObject(n)
                    MediaItem.SubtitleConfiguration.Builder(Uri.parse(cfg.absolute(s.getString("url"))))
                        .setMimeType(MimeTypes.TEXT_VTT)
                        .setLabel(s.optString("label", "Subtítulo"))
                        .setLanguage("es")
                        .setSelectionFlags(if (n == 0) C.SELECTION_FLAG_DEFAULT else 0)
                        .build()
                })
                .build()
        }
        val start = intent.getIntExtra(EXTRA_INDEX, 0).coerceIn(0, (items.size - 1).coerceAtLeast(0))
        val resumeSec = saved.optDouble(ids.getOrNull(start) ?: "", 0.0)
        exo.setMediaItems(items, start, if (resumeSec > 5) (resumeSec * 1000).toLong() else C.TIME_UNSET)

        exo.addListener(object : Player.Listener {
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                // Al pasar solo al siguiente episodio, el anterior queda como visto (posición 0).
                if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO && exo.previousMediaItemIndex >= 0) {
                    ids.getOrNull(exo.previousMediaItemIndex)?.let { positions.put(it, 0.0) }
                }
            }
        })
        exo.prepare()
        exo.playWhenReady = true
    }

    private fun rememberPosition() {
        val p = player ?: return
        val id = p.currentMediaItem?.mediaId ?: return
        val ms = p.currentPosition
        val dur = p.duration
        val finished = dur != C.TIME_UNSET && ms > dur - 10_000
        positions.put(id, if (finished) 0.0 else ms / 1000.0)
    }

    override fun onStop() {
        super.onStop()
        rememberPosition()
        player?.pause()
    }

    override fun finish() {
        rememberPosition()
        setResult(RESULT_OK, Intent().putExtra(EXTRA_POSITIONS, positions.toString()))
        super.finish()
    }

    override fun onDestroy() {
        player?.release()
        player = null
        super.onDestroy()
    }
}
