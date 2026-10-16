const $ = (id) => document.getElementById(id);
const video = $('video');
const statusEl = $('status');
let hls = null;
let subTracks = []; // {track, cues:[{start,end,text}]}

const say = (msg) => { statusEl.textContent = msg; };

/* ---------- AniList (metadatos) ---------- */
async function anilist(query, variables) {
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error('AniList: ' + res.status);
  return (await res.json()).data;
}

async function search(term) {
  const data = await anilist(`
    query($s:String){ Page(perPage:24){ media(search:$s,type:ANIME,sort:POPULARITY_DESC){
      id title{romaji english} coverImage{large} } } }`, { s: term });
  const box = $('results');
  box.replaceChildren();
  for (const m of data.Page.media) {
    const card = document.createElement('div');
    card.className = 'card';
    const img = document.createElement('img');
    img.src = m.coverImage.large; img.alt = '';
    const name = document.createElement('span');
    name.textContent = m.title.english || m.title.romaji;
    card.append(img, name);
    card.onclick = () => showInfo(m.id);
    box.append(card);
  }
}

async function showInfo(id) {
  const { Media: m } = await anilist(`
    query($id:Int){ Media(id:$id){ title{romaji english} description episodes status
      coverImage{large} trailer{id site} genres siteUrl
      streamingEpisodes{title url site} } }`, { id });
  const info = $('info');
  info.replaceChildren();
  const wrap = document.createElement('div'); wrap.className = 'detail';
  const img = document.createElement('img'); img.src = m.coverImage.large; img.alt = '';
  const txt = document.createElement('div');
  const h = document.createElement('h2'); h.textContent = m.title.english || m.title.romaji;
  const p = document.createElement('p');
  p.innerHTML = m.description || '';
  p.querySelectorAll('script,iframe,object,embed').forEach((n) => n.remove());
  const meta = document.createElement('p'); meta.className = 'muted';
  meta.textContent = `${m.episodes ?? '?'} episodios · ${m.status} · ${m.genres.join(', ')}`;
  txt.append(h, meta, p);
  if (m.trailer && m.trailer.site === 'youtube') {
    const a = document.createElement('a');
    a.href = 'https://www.youtube.com/watch?v=' + encodeURIComponent(m.trailer.id);
    a.textContent = 'Ver tráiler'; a.target = '_blank'; a.rel = 'noopener';
    txt.append(a, ' · ');
  }
  if (m.streamingEpisodes?.length) {
    const ul = document.createElement('ul');
    for (const e of m.streamingEpisodes.slice(0, 30)) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = e.url; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = `${e.title} (${e.site})`;
      li.append(a); ul.append(li);
    }
    txt.append(document.createElement('br'), 'Ver en plataformas oficiales:', ul);
  }
  wrap.append(img, txt); info.append(wrap);
}

/* ---------- Video ---------- */
function resetVideo() {
  if (hls) { hls.destroy(); hls = null; }
  if (video.src.startsWith('blob:')) URL.revokeObjectURL(video.src);
  video.removeAttribute('src');
}

function loadUrl(url) {
  resetVideo();
  if (/\.m3u8(\?|$)/i.test(url) && window.Hls && Hls.isSupported()) {
    hls = new Hls();
    hls.loadSource(url);
    hls.attachMedia(video);
  } else {
    video.src = url;
  }
  say('Video cargado: ' + url);
}

$('video-file').onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  resetVideo();
  video.src = URL.createObjectURL(f);
  say('Video local: ' + f.name + (/\.mkv$/i.test(f.name) ? ' (MKV: depende del navegador/códec)' : ''));
};

$('load-url').onclick = () => {
  try { loadUrl(new URL($('video-url').value.trim()).href); }
  catch { say('URL inválida'); }
};

video.onerror = () => say('No se pudo reproducir el video (formato, códec o CORS).');

/* ---------- Subtítulos ---------- */
function parseTime(t) {
  const m = t.trim().replace(',', '.').match(/(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)/);
  return m ? (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0;
}

function parseSrtVtt(text) {
  const cues = [];
  for (const block of text.replace(/\r/g, '').replace(/^﻿/, '').split(/\n\n+/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    cues.push({ start: parseTime(a), end: parseTime(b.split(/\s/).filter(Boolean)[0]),
                text: lines.slice(i + 1).join('\n') });
  }
  return cues;
}

function parseAss(text) {
  const cues = [];
  let fmt = null;
  for (const line of text.replace(/\r/g, '').split('\n')) {
    if (line.startsWith('Format:') && line.includes('Start')) fmt = line.slice(7).split(',').map((s) => s.trim());
    else if (line.startsWith('Dialogue:') && fmt) {
      const parts = line.slice(9).split(',');
      const get = (k) => parts[fmt.indexOf(k)];
      const txt = parts.slice(fmt.indexOf('Text')).join(',')
        .replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n');
      cues.push({ start: parseTime(get('Start')), end: parseTime(get('End')), text: txt });
    }
  }
  return cues.sort((x, y) => x.start - y.start);
}

function addSubtitle(name, cues) {
  const track = video.addTextTrack('subtitles', name, 'es');
  track.mode = 'showing';
  subTracks.push({ track, cues });
  applyCues();
}

function applyCues() {
  const off = parseFloat($('sub-offset').value) || 0;
  for (const { track, cues } of subTracks) {
    for (const c of [...track.cues || []]) track.removeCue(c);
    for (const c of cues) {
      const s = Math.max(0, c.start + off), e = Math.max(s + 0.01, c.end + off);
      track.addCue(new VTTCue(s, e, c.text));
    }
  }
}

$('sub-file').onchange = async (e) => {
  for (const f of e.target.files) {
    const text = await f.text();
    const cues = /\.(ass|ssa)$/i.test(f.name) ? parseAss(text) : parseSrtVtt(text);
    addSubtitle(f.name, cues);
    say(`Subtítulo "${f.name}": ${cues.length} líneas`);
  }
};

$('sub-offset').onchange = applyCues;
$('sub-size').oninput = (e) => video.style.setProperty('--sub-scale', e.target.value / 100);
$('speed').onchange = (e) => { video.playbackRate = parseFloat(e.target.value); };

$('search-form').onsubmit = (e) => {
  e.preventDefault();
  const term = $('q').value.trim();
  if (term) search(term).catch((err) => say(err.message));
};

search('One Piece').catch(() => {});
