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
- **Subtítulos:** `.srt`, `.vtt`, `.ass/.ssa` junto al video con el mismo nombre
  (`Episodio 01.es.srt`), convertidos a WebVTT.
- **Reproducción:** rango HTTP (seek), siguiente episodio automático y "continuar viendo".
  Los `.mkv`/`.avi` se convierten al vuelo si `ffmpeg` está instalado (sin seek en esos).

## Uso

```
node server.js          # Node >= 20
# http://localhost:8000
```

Variables: `PORT` (8000), `HOST` (127.0.0.1; usa 0.0.0.0 para tu red local),
`MEDIA_DIR` (./media), `TMDB_API_KEY`.

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
