# Mi Biblioteca

Servidor multimedia personal (tipo Plex/Jellyfin, sin dependencias) para tus propios
animes, series y películas.

- **Subida automática:** arrastra archivos o carpetas a la web, usa "Subir archivos"
  o copia/descarga directamente en `media/`. Se detectan solos.
- **Biblioteca que se actualiza sola:** vigila la carpeta (`fs.watch` + reescaneo cada 60 s)
  y avisa al navegador en vivo (SSE).
- **Metadatos automáticos:** póster, sinopsis, año y géneros desde AniList (sin clave).
  Opcional: `TMDB_API_KEY` para series y películas que no son anime.
- **Descargas por URL y suscripciones:** pega un enlace directo a un video, o (con
  [yt-dlp](https://github.com/yt-dlp/yt-dlp) instalado) una página o lista de reproducción
  de un sitio que lo permita. Se guarda en `media/Descargas/` con sus subtítulos y entra
  sola a la biblioteca. "Suscribirse" revisa la URL cada `SUBSCRIPTION_HOURS` (6) y baja
  solo lo nuevo. Se rechazan direcciones de red local.
- **Explorar un sitio:** pega la URL de un sitio público en "Fuentes en línea" y el servidor lo rastrea
  (mismo dominio, hasta 40 páginas y profundidad 2, pausa entre peticiones, respeta `robots.txt`), encuentra los videos
  que publica abiertamente (`<video>`, `<source>`, enlaces a `.mp4/.webm/.mkv`, `og:video`, JSON-LD) y los agrega a la
  biblioteca agrupados por serie. Se vuelve a rastrear cada 6 h. Si el sitio lo entiende yt-dlp, se usa yt-dlp primero.
  No ejecuta JavaScript ni descifra reproductores protegidos, y no incluye formas de saltarse bloqueos: sitios con
  reproductores ofuscados, DRM o solo HLS (`.m3u8`) no darán resultados.
- **Fuentes en línea (ver sin descargar):** añade una URL de video directo, un feed RSS/Atom o (con yt-dlp)
  una página/lista. Sus videos aparecen en la biblioteca con la etiqueta "en línea" (agrupados por título,
  con póster y sinopsis) y se reproducen en streaming a través de tu servidor, con seek (Range). Funciona igual
  en la web y en la app de Android TV. Límites: sin subtítulos externos, sin HLS (`.m3u8`) por ahora, y
  el servidor gasta ancho de banda al reenviar el video. Las URLs a redes locales se rechazan.
- **Feeds automáticos (RSS/Atom):** pega una vez la URL de un feed y un filtro (`show 1080p -batch`,
  todas las palabras deben aparecer, `-palabra` excluye, `"frase exacta"`). Se revisa cada
  `FEED_MINUTES` (30) y se baja solo lo nuevo; al añadirlo, lo ya publicado no se baja salvo que marques
  "bajar también lo ya publicado". Máx. 10 descargas por revisión. Usa el enlace directo del item
  (`enclosure`) o su página (con yt-dlp). Los `.torrent`/magnet no se soportan.
- **Subtítulos:** `.srt`, `.vtt`, `.ass/.ssa` junto al video con el mismo nombre
  (`Episodio 01.es.srt`), convertidos a WebVTT.
- **Reproducción:** rango HTTP (seek), siguiente episodio automático y "continuar viendo".
  Los `.mkv`/`.avi` se convierten al vuelo si `ffmpeg` está instalado (sin seek en esos).

## Celular y TV

- Interfaz adaptable a celular, tablet y pantallas grandes; se navega con teclado/control remoto
  (Tab/flechas + Enter) y tiene botón de pantalla completa.
- Instalable como app (PWA) desde Chrome/Safari: "Añadir a pantalla de inicio". La instalación exige
  HTTPS o `localhost`; con Tailscale usa `tailscale serve --bg 8000` para obtener HTTPS.
- "Enviar a TV" usa la API Remote Playback (Chromecast/AirPlay) donde el navegador la soporta.
- TV con navegador (Android TV, Fire TV, Samsung/LG): abre la URL del servidor. En Android TV / Fire TV
  también puedes usar el navegador con la IP de Tailscale o de tu red local.

## App de Android TV (`android/`)

App nativa (Kotlin) que abre tu biblioteca y reproduce con **ExoPlayer**: MKV, HEVC, AC3, adelantar
de verdad, y selección de audio/subtítulos con el control remoto. También se instala en celulares Android.

- **APK:** GitHub → pestaña *Actions* → *Android APK* → último run → artefacto `AnimeTV-debug-apk`
  (o ejecuta el workflow a mano con *Run workflow*). Local: `cd android && gradle assembleDebug`.
- **Instalar en la TV:** con *Downloader* (Fire TV/Android TV) o `adb connect IP_TV && adb install app-debug.apk`.
  Activa "orígenes desconocidos" / depuración USB en la TV.
- **Primer uso:** escribe la dirección del servidor (`100.x.y.z:8000` con Tailscale, o `192.168.x.x:8000`) y la
  clave si pusiste `AUTH_USER`/`AUTH_PASS`. Botón *Menú* del control = volver a Ajustes.
- Para salir de casa instala también Tailscale en la TV (hay app para Android TV).

## Uso

```
node server.js          # Node >= 20
# http://localhost:8000
```

Variables: `PORT` (8000), `HOST` (127.0.0.1; usa 0.0.0.0 para tu red local),
`MEDIA_DIR` (./media), `DATA_DIR` (./data), `TMDB_API_KEY`, `FEED_MINUTES` (30), `SUBSCRIPTION_HOURS` (6).

## Organización recomendada

```
media/Frieren/Frieren - 01.mkv
media/Frieren/Frieren - 01.es.srt
media/Frieren/Season 2/Frieren S02E03.mkv
media/Mi Pelicula (2020).mp4
```

Reconoce `S01E02`, `1x02`, `Ep 2`, ` - 02` y limpia etiquetas como `[Grupo]` o `1080p`.

> Descarga solo contenido que tengas derecho a guardar (el tuyo, dominio público,
> licencias libres o canales que lo permitan). No incluye scrapers de sitios piratas.
> Sin autenticación:
> no lo expongas a internet.

## Tenerlo en un servidor (VPS, NAS, Raspberry Pi)

```
git clone https://github.com/JhordyMarcillo/Anime && cd Anime
AUTH_USER=tu_usuario AUTH_PASS=una_clave_larga docker compose up -d --build
```

La imagen trae `ffmpeg` y `yt-dlp`. Todo se guarda en `./media` (monta ahí tu disco).
Fuera de localhost el servidor exige `AUTH_USER`/`AUTH_PASS` (autenticación básica);
ponlo detrás de HTTPS (Caddy, Nginx, Cloudflare Tunnel o Tailscale) para que la clave
no viaje en claro. Sin Docker: `HOST=0.0.0.0 AUTH_USER=... AUTH_PASS=... node server.js`.
