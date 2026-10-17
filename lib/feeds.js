'use strict';
// Feeds RSS/Atom que el usuario añade: cada cierto tiempo se revisan y los
// elementos nuevos que cumplan el filtro se mandan al descargador.
// Solo se siguen enlaces http/https a video (o páginas que yt-dlp soporte);
// no hay cliente de torrents ni búsqueda propia.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { VIDEO } = require('./library');

const EVERY_MS = Math.max(5, +process.env.FEED_MINUTES || 30) * 60000;
const MAX_NEW_PER_CHECK = 10;
const MAX_SEEN = 3000;
const MAX_XML = 5 * 1024 * 1024;

const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, '&')
  .trim();
const tag = (x, name) => { const m = x.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i')); return m ? decode(m[1]) : ''; };
const attr = (x, name, a) => { const m = x.match(new RegExp(`<${name}\\s[^>]*?${a}\\s*=\\s*["']([^"']+)["']`, 'i')); return m ? decode(m[1]) : ''; };

function parseFeed(xml) {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  return blocks.map((b) => {
    const title = tag(b, 'title');
    const guid = tag(b, 'guid') || tag(b, 'id');
    const enclosure = attr(b, 'enclosure', 'url') || attr(b, 'media:content', 'url') || attr(b, 'link\\s[^>]*?rel="enclosure"[^>]*?', 'href');
    const link = tag(b, 'link') || attr(b, 'link', 'href');
    const type = (b.match(/<enclosure[^>]*?type\s*=\s*["']([^"']+)/i) || [])[1] || '';
    return { title, guid: guid || enclosure || link || title, enclosure, link, type };
  }).filter((i) => i.title || i.link || i.enclosure);
}

// El filtro es una lista de palabras separadas por espacios: todas deben aparecer
// en el título; las que empiezan por "-" no deben aparecer. Comillas para frases.
function matches(title, filter) {
  const words = (filter || '').match(/-?"[^"]+"|-?\S+/g) || [];
  const t = title.toLowerCase();
  return words.every((w) => {
    const neg = w.startsWith('-');
    const term = w.replace(/^-/, '').replace(/"/g, '').toLowerCase();
    return term ? (t.includes(term) !== neg) : true;
  });
}

// Elige qué URL bajar: la del enclosure si es un video; si no, el enlace del item.
function pickUrl(item) {
  const urls = [item.enclosure, item.link].filter(Boolean);
  for (const u of urls) {
    let p; try { p = new URL(u); } catch { continue; }
    if (!/^https?:$/.test(p.protocol)) continue;
    if (/torrent/i.test(item.type) || /\.torrent(\?|$)/i.test(p.pathname)) continue;
    return p.href;
  }
  return null;
}

class Feeds extends EventEmitter {
  constructor(downloader, dataDir, checkUrl) {
    super();
    this.dl = downloader;
    this.checkUrl = checkUrl;
    this.file = path.join(dataDir, 'feeds.json');
    this.feeds = this.#load();
    this.busy = false;
    setInterval(() => this.checkAll(), EVERY_MS).unref();
    setTimeout(() => this.checkAll(), 20000).unref();
  }

  #load() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return []; } }
  #save() { fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.feeds, null, 2)); fs.renameSync(this.file + '.tmp', this.file); }

  state() {
    return {
      everyMinutes: EVERY_MS / 60000,
      feeds: this.feeds.map(({ seen, ...f }) => ({ ...f, seenCount: seen.length })),
    };
  }

  async fetchXml(rawUrl) {
    let url = rawUrl;
    for (let hop = 0; hop < 5; hop++) {
      await this.checkUrl(url);
      const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'AnimeLibrary/1.0' } });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { url = new URL(res.headers.get('location'), url).href; continue; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const chunks = []; let size = 0;
      for await (const c of res.body) { size += c.length; if (size > MAX_XML) throw new Error('feed demasiado grande'); chunks.push(c); }
      return Buffer.concat(chunks).toString('utf8');
    }
    throw new Error('demasiadas redirecciones');
  }

  async add(rawUrl, { filter = '', backfill = false } = {}) {
    const u = new URL(rawUrl);
    if (!/^https?:$/.test(u.protocol)) throw new Error('solo http/https');
    if (this.feeds.some((f) => f.url === u.href && f.filter === filter)) throw new Error('ese feed ya existe');
    const items = parseFeed(await this.fetchXml(u.href));   // valida que sea un feed y que responda
    if (!items.length) throw new Error('no se encontraron elementos en el feed');
    const feed = {
      id: crypto.randomBytes(4).toString('hex'), url: u.href, filter: filter.trim(), added: Date.now(),
      lastCheck: null, lastError: null, downloaded: 0, seen: backfill ? [] : items.map((i) => i.guid),
    };
    this.feeds.push(feed);
    this.#save();
    this.emit('update');
    if (backfill) this.check(feed).catch(() => {});
    return feed.id;
  }

  remove(id) { this.feeds = this.feeds.filter((f) => f.id !== id); this.#save(); this.emit('update'); }

  async checkAll() {
    if (this.busy) return;
    this.busy = true;
    try { for (const f of [...this.feeds]) await this.check(f); } finally { this.busy = false; }
  }

  async check(feed) {
    let queued = 0;
    feed.lastError = null;
    try {
      const items = parseFeed(await this.fetchXml(feed.url));
      const seen = new Set(feed.seen);
      for (const it of items.reverse()) {            // los más antiguos primero
        if (seen.has(it.guid)) continue;
        if (!matches(it.title, feed.filter)) { feed.seen.push(it.guid); continue; }
        if (queued >= MAX_NEW_PER_CHECK) break;      // el resto se baja en la próxima revisión
        const url = pickUrl(it);
        feed.seen.push(it.guid);
        if (!url) continue;                          // p. ej. solo .torrent: no soportado
        try { await this.dl.add(url); queued++; feed.downloaded++; }
        catch (e) { feed.lastError = `${it.title}: ${e.message}`; }
      }
      if (feed.seen.length > MAX_SEEN) feed.seen = feed.seen.slice(-MAX_SEEN);
    } catch (e) { feed.lastError = e.message; }
    feed.lastCheck = Date.now();
    this.#save();
    this.emit('update');
    return queued;
  }

  checkNow(id) { const f = this.feeds.find((x) => x.id === id); return f ? this.check(f) : Promise.resolve(0); }
}

module.exports = { Feeds, parseFeed, matches, pickUrl };
