'use strict';
const $ = (id) => document.getElementById(id);
const video = $('video');
let library = [];
let openKey = null;

/* ---------- utilidades ---------- */
function el(tag, props = {}, ...kids) {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
}
const enter = (fn) => (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };
let toastTimer;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}
const epLabel = (i) => i.episode == null ? i.name : `${i.season > 1 ? `T${i.season} ` : ''}Ep. ${i.episode}`;
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};

/* ---------- biblioteca ---------- */
async function load() {
  const res = await fetch('/api/library');
  library = await res.json();
  renderGrid();
  if (openKey) renderDetail(openKey);
}

function renderGrid() {
  const q = $('q').value.trim().toLowerCase();
  const kind = $('kind').value;
  const list = library.filter((g) => (!kind || g.kind === kind) && (!q || (g.meta?.name || g.title).toLowerCase().includes(q) || g.title.toLowerCase().includes(q)));
  $('grid').replaceChildren(...list.map((g) => {
    const poster = g.meta?.poster
      ? el('img', { className: 'poster', src: g.meta.poster, alt: '', loading: 'lazy' })
      : el('div', { className: 'poster' });
    const n = g.items.length;
    return el('div', { className: 'card', tabIndex: 0, onclick: () => openDetail(g.key), onkeydown: enter(() => openDetail(g.key)) }, poster,
      el('span', {}, g.meta?.name || g.title),
      el('small', {}, g.kind === 'movie' ? 'Película' : `${n} episodio${n === 1 ? '' : 's'}`));
  }));
  $('empty').hidden = library.length > 0;
}

function openDetail(key) { openKey = key; renderDetail(key); $('detail').scrollIntoView({ behavior: 'smooth' }); }

function renderDetail(key) {
  const g = library.find((x) => x.key === key);
  const box = $('detail');
  if (!g) { box.hidden = true; return; }
  box.hidden = false;
  const m = g.meta;
  const info = el('div', {}, el('h2', {}, m?.name || g.title),
    el('p', { className: 'muted' }, [m?.year, m?.genres?.join(', '), m?.score ? `★ ${m.score}/100` : ''].filter(Boolean).join(' · ')),
    el('p', {}, m?.overview || ''));
  const watched = store.get('pos') || {};
  const ul = el('ul', {}, ...g.items.map((i) => el('li', { tabIndex: 0, onclick: () => play(g, i), onkeydown: enter(() => play(g, i)) },
    el('span', {}, epLabel(i)),
    el('span', { className: 'muted' }, watched[i.id] > 5 ? `visto ${Math.floor(watched[i.id] / 60)} min` : ''))));
  box.replaceChildren(el('div', { className: 'top' }, m?.poster ? el('img', { src: m.poster, alt: '' }) : '', info), ul);
}

/* ---------- reproductor ---------- */
let current = null;
window.__setPos = (id, sec) => { // lo llama la app de Android TV al cerrar su reproductor
  const pos = store.get('pos') || {}; pos[id] = sec; store.set('pos', pos);
  if (openKey) renderDetail(openKey);
};

function play(g, item) {
  if (window.AndroidTV) { // app de Android TV: reproductor nativo (MKV, seek, audio/subs)
    const list = g.items.map((i) => ({
      id: i.id, title: `${g.meta?.name || g.title} — ${epLabel(i)}`, url: `/stream/${i.id}?raw=1`,
      subs: i.subs.map((s) => ({ label: s.label, url: `/sub/${i.id}/${s.n}` })),
    }));
    window.AndroidTV.play(JSON.stringify(list), g.items.indexOf(item), JSON.stringify(store.get('pos') || {}));
    return;
  }
  current = item;
  $('player').hidden = false;
  video.replaceChildren();
  video.src = `/stream/${item.id}`;
  item.subs.forEach((s, idx) => {
    const t = el('track', { kind: 'subtitles', label: s.label, srclang: 'es', src: `/sub/${item.id}/${s.n}`, default: idx === 0 });
    video.append(t);
  });
  $('now').textContent = `${g.meta?.name || g.title} — ${epLabel(item)}`;
  const pos = (store.get('pos') || {})[item.id];
  video.onloadedmetadata = () => { if (pos > 5 && pos < video.duration - 10) video.currentTime = pos; };
  video.onended = () => {
    const i = g.items.indexOf(item);
    if (g.items[i + 1]) play(g, g.items[i + 1]);
  };
  $('player').scrollIntoView({ behavior: 'smooth' });
}

let lastSave = 0;
video.ontimeupdate = () => {
  if (!current || Date.now() - lastSave < 5000) return;
  lastSave = Date.now();
  const pos = store.get('pos') || {};
  pos[current.id] = video.currentTime;
  store.set('pos', pos);
};
video.onerror = () => toast('No se pudo reproducir. Si es MKV/AVI, instala ffmpeg en el servidor.');
$('fs').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : (video.requestFullscreen?.() || video.webkitEnterFullscreen?.()));
// Enviar a TV / Chromecast / AirPlay con la API Remote Playback (si el navegador la tiene)
if (video.remote) { $('cast').hidden = false; $('cast').onclick = () => video.remote.prompt().catch((e) => toast('No se pudo enviar: ' + e.message)); }
$('close').onclick = () => { video.pause(); video.removeAttribute('src'); video.load(); $('player').hidden = true; current = null; };

/* ---------- subida ---------- */
async function upload(files) {
  for (const item of files) {
    const f = item.file || item;
    const name = item.name || f.webkitRelativePath || f.name;
    toast(`Subiendo ${name}...`);
    const res = await fetch('/api/upload?name=' + encodeURIComponent(name), { method: 'POST', body: f });
    if (!res.ok) toast(`Error subiendo ${name}: ${(await res.json().catch(() => ({}))).error || res.status}`);
    else toast(`${name} subido`);
  }
}
$('files').onchange = (e) => { upload([...e.target.files]); e.target.value = ''; };

// Arrastrar y soltar (también carpetas)
let dragDepth = 0;
addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('drop').hidden = false; });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop').hidden = true; } });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', async (e) => {
  e.preventDefault(); dragDepth = 0; $('drop').hidden = true;
  const files = [];
  const walk = async (entry, prefix) => {
    if (entry.isFile) {
      const f = await new Promise((r) => entry.file(r));
      files.push({ file: f, name: prefix + f.name }); // File no admite '/' en el nombre
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (let batch = await new Promise((r) => reader.readEntries(r)); batch.length;
        batch = await new Promise((r) => reader.readEntries(r))) {
        for (const c of batch) await walk(c, prefix + entry.name + '/');
      }
    }
  };
  const entries = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  for (const en of entries) await walk(en, '');
  upload(files);
});

/* ---------- descargas y suscripciones ---------- */
async function loadDownloads() {
  const d = await (await fetch('/api/downloads')).json();
  $('dl-note').textContent = d.ytdlp
    ? `yt-dlp detectado. Las suscripciones se revisan cada ${d.everyHours} h.`
    : 'Sin yt-dlp solo se aceptan enlaces directos a archivos de video. Instala yt-dlp para páginas y listas.';
  $('dl-jobs').replaceChildren(...d.jobs.map((j) => el('li', {}, `[${j.status}${j.progress ? ' ' + j.progress : ''}] ${j.url}${j.error ? ' — ' + j.error : ''}`)));
  $('dl-subs').replaceChildren(...d.subscriptions.map((s) => el('li', {}, s.url + ' ',
    el('button', { onclick: async () => { await sendDl('DELETE', { url: s.url }); } }, 'Quitar'))));
}
async function sendDl(method, body) {
  const res = await fetch('/api/downloads', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) toast((await res.json().catch(() => ({}))).error || 'Error ' + res.status);
  loadDownloads().catch(() => {});
}
$('dl-form').onsubmit = async (e) => { e.preventDefault(); await sendDl('POST', { url: $('dl-url').value }); $('dl-url').value = ''; };
$('dl-sub').onclick = () => { const v = $('dl-url').value; if (v) sendDl('POST', { url: v, subscribe: true }); };

/* ---------- actualización en vivo ---------- */
const events = new EventSource('/api/events');
events.onmessage = (e) => { if (e.data === 'downloads') loadDownloads().catch(() => {}); else load().catch(() => {}); };
loadDownloads().catch(() => {});
$('q').oninput = renderGrid;
$('kind').onchange = renderGrid;
load().catch((e) => toast(e.message));

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
