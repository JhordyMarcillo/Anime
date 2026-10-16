package com.anime.tv

import android.content.Context
import android.util.Base64
import java.net.URI

/** Dirección y credenciales del servidor, guardadas en las preferencias privadas de la app. */
class Config(context: Context) {
    private val prefs = context.getSharedPreferences("server", Context.MODE_PRIVATE)

    var baseUrl: String
        get() = prefs.getString("url", "") ?: ""
        set(v) = prefs.edit().putString("url", normalize(v)).apply()
    var user: String
        get() = prefs.getString("user", "") ?: ""
        set(v) = prefs.edit().putString("user", v).apply()
    var pass: String
        get() = prefs.getString("pass", "") ?: ""
        set(v) = prefs.edit().putString("pass", v).apply()

    val isReady get() = baseUrl.isNotEmpty()
    val host: String get() = runCatching { URI(baseUrl).host }.getOrNull() ?: ""

    /** Cabecera Basic, o null si el servidor no usa contraseña. */
    fun authHeader(): String? =
        if (user.isEmpty() && pass.isEmpty()) null
        else "Basic " + Base64.encodeToString("$user:$pass".toByteArray(), Base64.NO_WRAP)

    /** Convierte una ruta del servidor (p. ej. /stream/abc) en URL absoluta. */
    fun absolute(path: String): String =
        if (path.startsWith("http")) path else baseUrl.trimEnd('/') + "/" + path.trimStart('/')

    private fun normalize(v: String): String {
        var s = v.trim()
        if (s.isEmpty()) return ""
        if (!s.startsWith("http://") && !s.startsWith("https://")) s = "http://$s"
        return s.trimEnd('/')
    }
}
