'use strict';
// Metadatos: AniList (sin clave) y TMDB (opcional, TMDB_API_KEY) como respaldo
// para series/películas que no son anime.
const TMDB_KEY = process.env.TMDB_API_KEY || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function anilist(title) {
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `query($s:String){ Media(search:$s,type:ANIME,sort:SEARCH_MATCH){
        id title{romaji english} description(asHtml:false) episodes format genres
        averageScore seasonYear coverImage{large} bannerImage } }`,
      variables: { s: title },
    }),
  });
  if (res.status === 429) { await sleep(65000); return anilist(title); }
  if (!res.ok) return null;
  const m = (await res.json()).data?.Media;
  if (!m) return null;
  return {
    source: 'anilist', id: m.id,
    name: m.title.english || m.title.romaji,
    overview: (m.description || '').replace(/<[^>]*>/g, ''),
    poster: m.coverImage?.large, banner: m.bannerImage,
    year: m.seasonYear, genres: m.genres, score: m.averageScore,
    format: m.format, episodes: m.episodes,
  };
}

async function tmdb(title, kind) {
  if (!TMDB_KEY) return null;
  const type = kind === 'movie' ? 'movie' : 'tv';
  const url = `https://api.themoviedb.org/3/search/${type}?api_key=${TMDB_KEY}&language=es-ES&query=${encodeURIComponent(title)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const r = (await res.json()).results?.[0];
  if (!r) return null;
  return {
    source: 'tmdb', id: r.id, name: r.title || r.name, overview: r.overview,
    poster: r.poster_path && 'https://image.tmdb.org/t/p/w342' + r.poster_path,
    banner: r.backdrop_path && 'https://image.tmdb.org/t/p/w780' + r.backdrop_path,
    year: +(r.release_date || r.first_air_date || '0').slice(0, 4) || null,
    score: r.vote_average ? Math.round(r.vote_average * 10) : null,
  };
}

async function lookup(title, kind) {
  // Si falla la red lanza el error: así no se guarda como "sin resultado".
  return (await anilist(title)) || (await tmdb(title, kind));
}

module.exports = { lookup, sleep };
