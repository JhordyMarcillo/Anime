'use strict';
// Extrae título / temporada / episodio del nombre de archivo o carpeta.
const path = require('path');

const clean = (s) => s
  .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')                       // [Grupo] (1080p)
  .replace(/\b(\d{3,4}p|x26[45]|h\.?26[45]|hevc|web-?dl|web-?rip|blu-?ray|bdrip|aac|flac|10bit|multi|sub|dual|eng|spa|lat)\b/gi, ' ')
  .replace(/[._]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/(?<=\S)\s(19|20)\d{2}$/, '');   // año final: "Pelicula 2019"

function parseEpisode(base) {
  let m;
  if ((m = base.match(/S(\d{1,2})\s*E(\d{1,4})/i))) return { season: +m[1], episode: +m[2], cut: m.index };
  if ((m = base.match(/\b(\d{1,2})x(\d{2,3})\b/))) return { season: +m[1], episode: +m[2], cut: m.index };
  if ((m = base.match(/\b(?:episode|episodio|ep|e)\s*\.?\s*(\d{1,4})\b/i))) return { season: 1, episode: +m[1], cut: m.index };
  if ((m = base.match(/\s-\s*(\d{1,4})(?:v\d)?(?=\s|\[|\(|$)/))) return { season: 1, episode: +m[1], cut: m.index };
  return null;
}

// rel: ruta relativa a MEDIA_DIR, p.ej. "Frieren/Frieren - 03.mkv"
function parseFile(rel) {
  const parts = rel.split(path.sep);
  const base = path.basename(rel, path.extname(rel));
  const ep = parseEpisode(base.replace(/[._]/g, ' '));
  let title = clean(ep ? base.replace(/[._]/g, ' ').slice(0, ep.cut) : base);
  const folder = parts.length > 1 ? clean(parts[0]) : '';
  // Series: manda el nombre de la carpeta. Películas: manda el nombre del archivo.
  if (folder && (ep || !title)) title = folder;
  // "Season 2" como carpeta intermedia
  let season = ep ? ep.season : null;
  const sm = parts.slice(1, -1).join(' ').match(/(?:season|temporada|s)\s*(\d{1,2})/i);
  if (sm) season = +sm[1];
  return {
    title: title || clean(base) || base,
    season, episode: ep ? ep.episode : null,
    kind: ep ? 'episode' : 'movie',
  };
}

module.exports = { parseFile, clean };
