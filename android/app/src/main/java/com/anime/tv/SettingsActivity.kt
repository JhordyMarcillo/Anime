package com.anime.tv

import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

/** Pantalla para escribir la dirección del servidor (y usuario/clave si los hay). */
class SettingsActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val cfg = Config(this)

        fun field(hint: String, value: String, password: Boolean = false) = EditText(this).apply {
            this.hint = hint
            setText(value)
            setTextColor(0xFFE8E8EA.toInt())
            setHintTextColor(0xFF8B8F99.toInt())
            textSize = 20f
            isSingleLine = true
            if (password) inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
            else inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = 24 }
        }

        val title = TextView(this).apply {
            text = "Conectar con tu servidor"
            textSize = 28f
            setTextColor(0xFFFF4D6D.toInt())
        }
        val help = TextView(this).apply {
            text = intent.getStringExtra("message")
                ?: "Escribe la dirección de tu servidor, por ejemplo 100.64.0.5:8000 (Tailscale) o 192.168.1.20:8000."
            textSize = 16f
            setTextColor(0xFF8B8F99.toInt())
        }
        val url = field("Dirección (http://...)", cfg.baseUrl)
        val user = field("Usuario (opcional)", cfg.user)
        val pass = field("Contraseña (opcional)", cfg.pass, password = true)
        val save = Button(this).apply {
            text = "Guardar y abrir"
            setOnClickListener {
                if (url.text.isNullOrBlank()) { url.error = "Obligatorio"; return@setOnClickListener }
                cfg.baseUrl = url.text.toString()
                cfg.user = user.text.toString()
                cfg.pass = pass.text.toString()
                setResult(RESULT_OK)
                finish()
            }
        }

        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(160, 48, 160, 48)
            addView(title); addView(help); addView(url); addView(user); addView(pass)
            addView(save, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = 32 })
        })
        url.requestFocus()
    }
}
