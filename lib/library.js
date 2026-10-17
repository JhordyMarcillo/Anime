'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { parseFile } = require('./parse');
const { lookup, sleep } = require('./metadata');

const VIDEO = new Set(['.mp4', '.m4v', '.mkv', '.webm', '.avi', '.mov']);
const SUB = new Set(['.srt', '.vtt', '.ass', '.ssa']);
const RETRY_MS = 24 * 3600 * 1000;

class Library extends EventEmitter {
  constructor(mediaDir, dataDir) {
    super();
    this.mediaDir = path.resolve(mediaDir);
    this.cacheFile = path.join(dataDir, 'metadata.json');
    fs.mkdirSync(this.mediaDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });
    this.files = new Map();   // id -> archivo
    this.groups = [];
    this.signature = '';
    this.meta = this.#loadCache();
    this.working = false;
    this.remote = [];         // entradas de fuentes en línea (ver lib/sources.js)
  }

  setRemote(entries) { this.remote = entries; this.scan(); }

  #loadCache() {
    try { return JSON.parse(fs.readFileSync(this.cacheFile, 'utf8')); } catch { return {}; }
  }
  #saveCache() {
    fs.writeFileSync(this.cacheFile + '.tmp', JSON.stringify(this.meta));
    fs.renameSync(this.cacheFile + '.tmp', this.cacheFile);
  }

  #walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name.endsWith('.part')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) this.#walk(full, out);
      else if (e.isFile()) out.push(full);
    }
    return out;
  }

  scan() {
    const all = this.#walk(this.mediaDir);
    const subs = all.filter((f) => SUB.has(path.extname(f).toLowerCase()));
    const files = new Map();
    for (const full of all) {
      const ext = path.extname(full).toLowerCase();
      if (!VIDEO.has(ext)) continue;
      const rel = path.relative(this.mediaDir, full);
      const st = fs.statSync(full);
      const id = crypto.createHash('sha1').update(rel).digest('hex').slice(0, 12);
      const stem = full.slice(0, -ext.length);
      const mySubs = subs
        .filter((s) => s.startsWith(stem) && path.dirname(s) === path.dirname(full))
        .map((s) => ({ file: s, label: path.basename(s).slice(path.basename(stem).length).replace(/^\./, '').replace(/\.[^.]+$/, '') || 'Subtítulo' }));
      files.set(id, { id, rel, ext, size: st.size, mtime: st.mtimeMs, subs: mySubs, ...parseFile(rel) });
    }
    for (const r of this.remote) {   // fuentes en línea: aparecen como archivos sin ruta local
      const p = parseFile(r.title.replace(/[\\/]/g, ' ') + '.mp4');
      files.set(r.id, { id: r.id, rel: r.title, ext: '.mp4', size: 0, mtime: r.added || 0, subs: [], remote: true, url: r.url, ...p });
    }
    this.files = files;

    const byKey = new Map();
    for (const f of files.values()) {
      const key = f.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      if (!byKey.has(key)) byKey.set(key, { key, title: f.title, items: [] });
      byKey.get(key).items.push(f);
    }
    this.groups = [...byKey.values()].map((g) => {
      g.items.sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0) || a.rel.localeCompare(b.rel));
      g.kind = g.items.every((i) => i.kind === 'movie') ? 'movie' : 'series';
      g.added = Math.max(...g.items.map((i) => i.mtime));
      return g;
    }).sort((a, b) => a.title.localeCompare(b.title));

    const sig = JSON.stringify(this.groups.map((g) => [g.key, g.items.map((i) => [i.id, i.size, i.subs.length, !!i.remote])]));
    const changed = sig !== this.signature;
    this.signature = sig;
    if (changed) this.emit('change');
    this.#fillMetadata();
    return changed;
  }

  async #fillMetadata() {
    if (this.working) return;
    this.working = true;
    try {
      for (const g of this.groups) {
        const cached = this.meta[g.key];
        if (cached && (cached.data || Date.now() - cached.at < RETRY_MS)) continue;
        let data;
        try { data = await lookup(g.title, g.kind); }
        catch (e) { console.warn('metadatos no disponibles, se reintenta luego:', e.message); break; }
        this.meta[g.key] = { at: Date.now(), data };
        this.#saveCache();
        this.emit('change');
        await sleep(1200); // respeta el límite de AniList
      }
    } finally { this.working = false; }
  }

  toJSON() {
    return this.groups.map((g) => ({
      key: g.key, title: g.title, kind: g.kind, added: g.added,
      meta: this.meta[g.key]?.data || null,
      items: g.items.map((i) => ({
        id: i.id, season: i.season, episode: i.episode, size: i.size, name: path.basename(i.rel), remote: !!i.remote,
        subs: i.subs.map((s, n) => ({ n, label: s.label })),
      })),
    }));
  }
}

module.exports = { Library, VIDEO, SUB };
