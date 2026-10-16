'use strict';
// Descargas por URL (enlace directo o cualquier sitio que yt-dlp soporte) y
// suscripciones que se revisan periódicamente. Úsalo solo con contenido que
// tengas derecho a descargar.
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const { EventEmitter } = require('events');
const { VIDEO, SUB } = require('./library');

const HAS_YTDLP = spawnSync('yt-dlp', ['--version']).status === 0;
const CHECK_MS = (+process.env.SUBSCRIPTION_HOURS || 6) * 3600 * 1000;
const MAX_JOBS = 3;

function isPrivate(ip) {
  if (net.isIPv6(ip)) return ip === '::1' || /^f[cd]/i.test(ip) || /^fe80/i.test(ip) || /^::ffff:/i.test(ip);
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

async function checkUrl(raw) {
  const u = new URL(raw);
  if (!/^https?:$/.test(u.protocol)) throw new Error('solo http/https');
  if (process.env.ALLOW_PRIVATE_DOWNLOADS === '1') return u;
  const addrs = net.isIP(u.hostname) ? [{ address: u.hostname }] : await dns.lookup(u.hostname, { all: true });
  if (addrs.some((a) => isPrivate(a.address))) throw new Error('no se permiten direcciones de red local');
  return u;
}

class Downloader extends EventEmitter {
  constructor(mediaDir, dataDir) {
    super();
    this.mediaDir = mediaDir;
    this.dataDir = dataDir;
    this.subsFile = path.join(dataDir, 'subscriptions.json');
    this.jobs = [];       // últimas descargas (memoria)
    this.queue = [];
    this.running = 0;
    this.subs = this.#loadSubs();
    if (HAS_YTDLP) {
      setInterval(() => this.checkSubscriptions(), CHECK_MS).unref();
      setTimeout(() => this.checkSubscriptions(), 15000).unref();
    }
  }

  #loadSubs() { try { return JSON.parse(fs.readFileSync(this.subsFile, 'utf8')); } catch { return []; } }
  #saveSubs() { fs.writeFileSync(this.subsFile, JSON.stringify(this.subs, null, 2)); }

  state() {
    return { ytdlp: HAS_YTDLP, jobs: this.jobs.slice(-30).reverse(), subscriptions: this.subs, everyHours: CHECK_MS / 3600000 };
  }

  async add(rawUrl, { subscription = false } = {}) {
    const u = await checkUrl(rawUrl);
    const job = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), url: u.href, status: 'en cola', progress: '', subscription };
    this.jobs.push(job);
    if (this.jobs.length > 200) this.jobs.splice(0, this.jobs.length - 200);
    this.queue.push(job);
    this.#pump();
    this.emit('update');
    return job;
  }

  subscribe(rawUrl) {
    const u = new URL(rawUrl);
    if (!/^https?:$/.test(u.protocol)) throw new Error('solo http/https');
    if (!HAS_YTDLP) throw new Error('las suscripciones requieren yt-dlp instalado');
    if (!this.subs.some((s) => s.url === u.href)) { this.subs.push({ url: u.href, added: Date.now() }); this.#saveSubs(); }
    this.add(u.href, { subscription: true }).catch(() => {});
    this.emit('update');
  }

  unsubscribe(url) { this.subs = this.subs.filter((s) => s.url !== url); this.#saveSubs(); this.emit('update'); }

  checkSubscriptions() {
    for (const s of this.subs) this.add(s.url, { subscription: true }).catch(() => {});
  }

  #pump() {
    while (this.running < MAX_JOBS && this.queue.length) {
      const job = this.queue.shift();
      this.running++;
      job.status = 'descargando';
      this.emit('update');
      this.#run(job)
        .then(() => { job.status = 'listo'; })
        .catch((e) => { job.status = 'error'; job.error = e.message; })
        .finally(() => { this.running--; this.emit('update'); this.#pump(); });
    }
  }

  #run(job) { return HAS_YTDLP ? this.#ytdlp(job) : this.#direct(job); }

  #ytdlp(job) {
    const out = path.join(this.mediaDir, 'Descargas', '%(title).150B [%(id)s].%(ext)s');
    const args = ['--newline', '--no-colors', '--restrict-filenames', '--ignore-errors',
      '--download-archive', path.join(this.dataDir, 'yt-archive.txt'),
      '-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b', '--merge-output-format', 'mp4',
      '--write-subs', '--sub-langs', 'es.*,en.*', '--convert-subs', 'vtt',
      '-o', out, '--', job.url];
    return new Promise((resolve, reject) => {
      const p = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let err = '';
      p.stdout.on('data', (d) => {
        const m = String(d).match(/\[download\]\s+([\d.]+%)/g);
        if (m) { job.progress = m[m.length - 1].replace('[download]', '').trim(); this.emit('update'); }
      });
      p.stderr.on('data', (d) => { err = (err + d).slice(-500); });
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split('\n').pop() || 'yt-dlp código ' + code))));
    });
  }

  async #direct(job) {
    let url = job.url;
    for (let hop = 0; hop < 5; hop++) {      // redirecciones validadas una a una
      await checkUrl(url);
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { url = new URL(res.headers.get('location'), url).href; continue; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const cd = (res.headers.get('content-disposition') || '').match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i);
      let name = decodeURIComponent(cd ? cd[1] : path.basename(new URL(url).pathname) || 'video');
      name = name.replace(/[<>:"|?*\\/\x00-\x1f]/g, '_').trim();
      const ext = path.extname(name).toLowerCase();
      if (!VIDEO.has(ext) && !SUB.has(ext)) throw new Error('no es un video/subtítulo directo (instala yt-dlp para páginas web)');
      const dir = path.join(this.mediaDir, 'Descargas');
      fs.mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, name), tmp = dest + '.part';
      const total = +res.headers.get('content-length') || 0;
      let got = 0;
      const out = fs.createWriteStream(tmp);
      try {
        for await (const chunk of res.body) {
          got += chunk.length;
          if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
          if (total) job.progress = Math.floor((got / total) * 100) + '%';
        }
        await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
        fs.renameSync(tmp, dest);
      } catch (e) { out.destroy(); fs.rmSync(tmp, { force: true }); throw e; }
      return;
    }
    throw new Error('demasiadas redirecciones');
  }
}

module.exports = { Downloader };
