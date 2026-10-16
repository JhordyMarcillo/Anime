# Guía para Windows (PC + Tailscale)

Todo gratis. Usa PowerShell (menú Inicio → "PowerShell").

## 1. Instalar programas
```
winget install OpenJS.NodeJS.LTS
winget install Git.Git
winget install Gyan.FFmpeg
winget install yt-dlp.yt-dlp
winget install Tailscale.Tailscale
```
Cierra y vuelve a abrir PowerShell. Comprueba: `node -v`, `ffmpeg -version`, `yt-dlp --version`.

## 2. Descargar el proyecto
```
cd $HOME
git clone https://github.com/JhordyMarcillo/Anime
cd Anime
git checkout claude/anime-api-jn1oef
```

## 3. Configurar
```
copy config.example.bat config.bat
notepad config.bat
```
Cambia usuario, clave y `MEDIA_DIR` (carpeta con espacio, p. ej. `D:\Anime`; se crea sola).
`config.bat` no se sube a git.

## 4. Iniciar
Doble clic en `start.bat` (o `.\start.bat`). Verás `Biblioteca en http://0.0.0.0:8000`.
Si Windows pregunta por el Firewall, marca **solo redes privadas**.
Abre http://localhost:8000 e inicia sesión con tu usuario y clave.

## 5. Acceder desde el celular o la TV (Tailscale)
1. Abre Tailscale en la PC (bandeja del sistema) e inicia sesión (Google, Microsoft o GitHub).
2. Instala la app Tailscale en el celular e inicia sesión con **la misma cuenta**.
3. En la PC, mira su IP de Tailscale (`tailscale ip -4`, empieza por `100.`).
4. En el celular: `http://100.x.y.z:8000`. Funciona desde cualquier red, sin abrir puertos.

## 6. Que arranque solo y no se duerma
- `Win + R` → `shell:startup` → crea un acceso directo a `start.bat` en esa carpeta.
- Configuración → Sistema → Inicio/apagado y batería → pantalla y suspensión: **Nunca** al estar enchufada.

## 7. Usarlo
- Videos propios: arrástralos a la web o cópialos a `MEDIA_DIR`. Subtítulos `.srt` con el mismo nombre.
- Descargas: sección "Descargas y suscripciones", pega la URL (solo contenido que tengas derecho a guardar).
- Actualizar el proyecto: `git pull` y reinicia.

## Problemas comunes
- **`node` no se reconoce:** reabre PowerShell o reinicia la PC.
- **No abre desde el celular:** revisa que ambos estén conectados a Tailscale y que el Firewall permita Node en redes privadas.
- **MKV sin adelantar:** es normal, se convierte al vuelo. Los MP4 sí permiten adelantar.
