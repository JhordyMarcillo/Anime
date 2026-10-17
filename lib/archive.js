'use strict';
// Internet Archive (archive.org): contenido de dominio público y licencias abiertas.
// Acepta URLs /details/<id> de un item (uno o varios videos) o de una colección.
const path = require('path');
const { VIDEO } = require('./library');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FORMAT_RANK = ['h.264', 'mpeg4', 'webm', 'matroska'];   // preferencia: derivados MP4 ligeros primero
const rank = (f) => {
  const fmt = (f.format || '').toLowerCase();
  const i = FORMAT_RANK.findIndex((x) => fmt.includes(x));
  return i >= 0 ? i : (VIDEO.has(path.extname(f.name || '').toLowerCase()) ? 9 : -1);
};

function idFromUrl(raw) {
  const m = new URL(raw).pathname.match(/^\/(?:details|download)\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function getJson(url, checkUrl) {
  await checkUrl(url);
  const res = await fetch(url, { headers: { 'User-Agent': 'AnimeLibrary/1.0' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('archive.org respondió ' + res.status);
  return res.json();
}

// Videos de un item: el mejor formato; si hay varios archivos (episodios), todos.
function itemEntries(baseUrl, id, meta) {
  const files = (meta.files || []).filter((f) => rank(f) >= 0 && !/\.(srt|vtt)$/i.test(f.name));
  if (!files.length) return [];
  const best = Math.min(...files.map(rank));
  const chosen = files.filter((f) => rank(f) === best).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const title = (meta.metadata?.title || id).toString();
  return chosen.map((f) => {
    const base = path.basename(f.name, path.extname(f.name));
    // Si el archivo ya empieza por el título del item no se repite ("Serie Libre ep 01").
    return { title: chosen.length === 1 ? title : base.toLowerCase().startsWith(title.toLowerCase()) ? base : `${title} - ${base}`,
      url: `${baseUrl}/download/${encodeURIComponent(id)}/${f.name.split('/').map(encodeURIComponent).join('/')}` };
  });
}

async function archiveEntries(rawUrl, { base, checkUrl, max = 30 }) {
  const id = idFromUrl(rawUrl);
  if (!id) throw new Error('URL de archive.org no reconocida (usa /details/<identificador>)');
  const meta = await getJson(`${base}/metadata/${encodeURIComponent(id)}`, checkUrl);
  if (!meta.metadata) throw new Error('no existe ese identificador en archive.org');
  if (meta.metadata.mediatype !== 'collection') return itemEntries(base, id, meta);

  const q = encodeURIComponent(`collection:${id} AND mediatype:movies`);
  const list = await getJson(`${base}/advancedsearch.php?q=${q}&fl%5B%5D=identifier&sort%5B%5D=downloads+desc&rows=${max}&output=json`, checkUrl);
  const entries = [];
  for (const d of list.response?.docs || []) {
    try { entries.push(...itemEntries(base, d.identifier, await getJson(`${base}/metadata/${encodeURIComponent(d.identifier)}`, checkUrl))); } catch { /* se omite el item */ }
    await sleep(250);
  }
  return entries;
}

module.exports = { archiveEntries, idFromUrl };
