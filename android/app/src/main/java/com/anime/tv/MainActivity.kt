package com.anime.tv

import android.annotation.SuppressLint
import android.content.Intent
import android.net.http.SslError
import android.os.Bundle
import android.view.KeyEvent
import android.webkit.HttpAuthHandler
import android.webkit.JavascriptInterface
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject

/**
 * Muestra la biblioteca web del servidor y delega la reproducción en ExoPlayer
 * (MKV, HEVC, AC3, seek real, subtítulos y audio seleccionables).
 */
class MainActivity : AppCompatActivity() {
    private lateinit var cfg: Config
    private lateinit var web: WebView
    private var authTries = 0

    private val settingsLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        if (cfg.isReady) load() else finish()
    }
    private val playerLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        // El reproductor devuelve las posiciones {id: segundos} para "continuar viendo".
        val json = r.data?.getStringExtra(PlayerActivity.EXTRA_POSITIONS) ?: return@registerForActivityResult
        val obj = JSONObject(json)
        for (id in obj.keys()) {
            val sec = obj.optDouble(id, 0.0)
            web.evaluateJavascript("window.__setPos && window.__setPos(${JSONObject.quote(id)}, $sec)", null)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        cfg = Config(this)
        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            isFocusable = true
            isFocusableInTouchMode = true
            setBackgroundColor(0xFF0F1115.toInt())
            addJavascriptInterface(Bridge(), "AndroidTV")
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean {
                    if (r.url.host == cfg.host) return false
                    // Enlaces externos (Crunchyroll, Tubi...): se abren en su app oficial o en el navegador.
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, r.url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                    return true
                }
                override fun onReceivedHttpAuthRequest(v: WebView, h: HttpAuthHandler, host: String, realm: String) {
                    if (host == cfg.host && authTries++ < 2) h.proceed(cfg.user, cfg.pass) else { h.cancel(); openSettings("Usuario o contraseña incorrectos.") }
                }
                override fun onReceivedError(v: WebView, r: WebResourceRequest, e: WebResourceError) {
                    if (r.isForMainFrame) openSettings("No se pudo conectar con ${cfg.baseUrl}. Revisa la dirección y que el servidor y Tailscale estén activos.")
                }
                @SuppressLint("WebViewClientOnReceivedSslError")
                override fun onReceivedSslError(v: WebView, h: SslErrorHandler, e: SslError) { h.cancel() }
            }
        }
        setContentView(web)
        if (cfg.isReady) load() else openSettings(null)
    }

    private fun load() { authTries = 0; web.loadUrl(cfg.baseUrl + "/"); web.requestFocus() }

    private fun openSettings(message: String?) {
        settingsLauncher.launch(Intent(this, SettingsActivity::class.java).putExtra("message", message))
    }

    /** Botón Menú del control remoto → ajustes del servidor. */
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_MENU) { openSettings(null); return true }
        return super.onKeyDown(keyCode, event)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // Atrás cierra el reproductor de la web o sale; no navega historial.
        web.evaluateJavascript("(function(){var p=document.getElementById('player');if(p&&!p.hidden){document.getElementById('close').click();return 1}return 0})()") {
            if (it != "1") finish()
        }
    }

    inner class Bridge {
        /** Lo llama la web: playlist JSON, índice de inicio y mapa de posiciones guardadas. */
        @JavascriptInterface
        fun play(playlistJson: String, startIndex: Int, positionsJson: String) {
            runOnUiThread {
                playerLauncher.launch(Intent(this@MainActivity, PlayerActivity::class.java)
                    .putExtra(PlayerActivity.EXTRA_PLAYLIST, playlistJson)
                    .putExtra(PlayerActivity.EXTRA_INDEX, startIndex)
                    .putExtra(PlayerActivity.EXTRA_SAVED, positionsJson))
            }
        }
    }
}
