'use strict';
// Fuentes en línea: URLs que el usuario añade y que aparecen en la biblioteca
// para verse sin descargar. Tipos: video directo, feed RSS/Atom (cada item es
// una entrada) o página/lista soportada por yt-dlp (si está instalado).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { VIDEO } = require('./library');
const { parseFeed, pickUrl } = require('./feeds');
const { clean } = require('./parse');
const { crawl } = require('./crawler');

const EVERY_MS = Math.max(5, +process.env.FEED_MINUTES || 30) * 60000;
const MAX_ENTRIES = 500;
const SITE_EVERY_MS = 6 * 3600 * 1000;   // los sitios se vuelven a rastrear con menos frecuencia
const hash = (s) => crypto.createHash('sha1').update('remote:' + s).digest('hex').slice(0, 12);
const isVideoUrl = (u) => { try { return VIDEO.has(path.extname(new URL(u).pathname).toLowerCase()); } catch { return false; } };
const titleFromUrl = (u) => { try { return clean(decodeURIComponent(path.basename(new URL(u).pathname, path.extname(new URL(u).pathname)))) || u; } catch { return u; } };

function ytdlp(args, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const p = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const t = setTimeout(() => p.kill('SIGKILL'), timeout);
    p.stdout.on('data', (d) => { if (out.length < 20e6) out += d; });
    p.stderr.on('data', (d) => { err = (err + d).slice(-400); });
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (c) => { clearTimeout(t); c === 0 ? resolve(out) : reject(new Error(err.trim().split('\n').pop() || 'yt-dlp ' + c)); });
  });
}

class Sources extends EventEmitter {
  constructor(dataDir, checkUrl, fetchXml, hasYtdlp) {
    super();
    this.checkUrl = checkUrl; this.fetchXml = fetchXml; this.hasYtdlp = hasYtdlp;
    this.file = path.join(dataDir, 'sources.json');
    this.sources = this.#load();       // [{id,url,type,title,added,lastCheck,lastError,entries:[{title,url}]}]
    this.resolved = new Map();         // url de página -> {url, at}
    setInterval(() => this.refreshAll(), EVERY_MS).unref();
    setTimeout(() => this.refreshAll(), 10000).unref();
  }

  #load() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return []; } }
  #save() { fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.sources)); fs.renameSync(this.file + '.tmp', this.file); }

  entries() {
    const out = [], seen = new Set();
    for (const s of this.sources) for (const e of s.entries || []) {
      const id = hash(e.url);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, title: e.title, url: e.url, referer: e.referer, sourceId: s.id, added: s.added });
    }
    return out;
  }
  getEntry(id) { return this.entries().find((e) => e.id === id); }

  state() {
    return this.sources.map((s) => ({ id: s.id, url: s.url, type: s.type, title: s.title, count: (s.entries || []).length, lastCheck: s.lastCheck, lastError: s.lastError, crawling: !!s.crawling, progress: s.progress || '' }));
  }

  async #probe(url) {
    if (isVideoUrl(url)) return 'direct';
    await this.checkUrl(url);
    const res = await fetch(url, { headers: { Range: 'bytes=0-4095', 'User-Agent': 'AnimeLibrary/1.0' }, signal: AbortSignal.timeout(20000), redirect: 'follow' });
    const ct = res.headers.get('content-type') || '';
    const head = (await res.text().catch(() => '')).slice(0, 4096);
    if (ct.startsWith('video/')) return 'direct';
    if (/<rss[\s>]|<feed[\s>]|<rdf:RDF/i.test(head)) return 'feed';
    return this.hasYtdlp ? 'page' : 'site';   // página web: yt-dlp si está, y si no, rastreo del sitio
  }

  async add(rawUrl, title = '') {
    const u = new URL(rawUrl);
    if (!/^https?:$/.test(u.protocol)) throw new Error('solo http/https');
    await this.checkUrl(u.href);
    if (this.sources.some((s) => s.url === u.href)) throw new Error('esa fuente ya existe');
    const type = await this.#probe(u.href);
    const s = { id: crypto.randomBytes(4).toString('hex'), url: u.href, type, title: title.trim().slice(0, 120), added: Date.now(), lastCheck: null, lastError: null, entries: [] };
    this.sources.push(s);
    if (type === 'site') { this.refresh(s); return s.id; }           // el rastreo tarda: sigue en segundo plano
    await this.refresh(s);
    if (type === 'page' && (s.lastError || !s.entries.length)) {      // yt-dlp no sabe leer el sitio: rastrear la página
      s.type = 'site'; this.refresh(s); return s.id;
    }
    if (s.lastError && !s.entries.length) { this.sources = this.sources.filter((x) => x !== s); this.#save(); throw new Error(s.lastError); }
    return s.id;
  }

  remove(id) { this.sources = this.sources.filter((s) => s.id !== id); this.#save(); this.emit('update'); }

  async refreshAll() {
    for (const s of [...this.sources]) {
      if (s.type === 'site' && (s.crawling || Date.now() - (s.lastCheck || 0) < SITE_EVERY_MS)) continue;
      await this.refresh(s);
    }
  }

  async refresh(s) {
    if (s.crawling) return;
    s.lastError = null;
    try {
      if (s.type === 'site') {
        s.crawling = true; this.emit('update');
        const r = await crawl(s.url, { checkUrl: this.checkUrl, onProgress: (p) => { s.progress = `${p.pages} páginas, ${p.entries} videos`; } });
        if (r.entries.length) s.entries = r.entries;
        else s.lastError = r.error || (r.hls ? `se encontraron ${r.hls} streams HLS (.m3u8), aún no soportados`
          : r.blocked ? 'robots.txt del sitio no permite rastrearlo' : 'no se encontraron videos directos (el sitio puede usar JavaScript o un reproductor protegido)');
        s.progress = `${r.pages} páginas`;
      } else if (s.type === 'direct') {
        s.entries = [{ title: s.title || titleFromUrl(s.url), url: s.url }];
      } else if (s.type === 'feed') {
        s.entries = parseFeed(await this.fetchXml(s.url)).map((i) => ({ title: i.title, url: pickUrl(i) })).filter((e) => e.url).slice(0, MAX_ENTRIES);
      } else {
        const info = JSON.parse(await ytdlp(['-J', '--flat-playlist', '--no-warnings', '--', s.url]));
        const list = info.entries || [info];
        s.entries = list.map((e) => ({ title: e.title || titleFromUrl(e.url || s.url), url: e.url || e.webpage_url || s.url })).filter((e) => /^https?:/.test(e.url)).slice(0, MAX_ENTRIES);
      }
      if (!s.entries.length && s.type !== 'site') s.lastError = 'sin entradas reproducibles';
    } catch (e) { s.lastError = e.message; }
    s.crawling = false;
    s.lastCheck = Date.now();
    this.#save();
    this.emit('update');
  }

  // URL real del archivo: directa si ya es un video; con yt-dlp si es una página.
  async resolve(entry) {
    if (isVideoUrl(entry.url)) return entry.url;
    if (!this.hasYtdlp) throw new Error('esta entrada es una página: instala yt-dlp en el servidor');
    const c = this.resolved.get(entry.url);
    if (c && Date.now() - c.at < 10 * 60000) return c.url;
    const out = await ytdlp(['-g', '--no-playlist', '--no-warnings', '-f', 'b[ext=mp4]/b', '--', entry.url]);
    const url = out.trim().split('\n')[0];
    if (!/^https?:/.test(url)) throw new Error('yt-dlp no devolvió un enlace de video');
    this.resolved.set(entry.url, { url, at: Date.now() });
    return url;
  }
}

module.exports = { Sources };
