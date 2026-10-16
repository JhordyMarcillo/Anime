'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { Library, VIDEO, SUB } = require('./lib/library');
const { toVtt } = require('./lib/subs');
const { Downloader } = require('./lib/downloader');

const PORT = +process.env.PORT || 8000;
const HOST = process.env.HOST || '127.0.0.1';   // 0.0.0.0 para abrir a tu red local
const MEDIA_DIR = path.resolve(process.env.MEDIA_DIR || path.join(__dirname, 'media'));
const AUTH_USER = process.env.AUTH_USER || '';
const AUTH_PASS = process.env.AUTH_PASS || '';
const AUTH = AUTH_USER && AUTH_PASS ? Buffer.from(`${AUTH_USER}:${AUTH_PASS}`) : null;
const LOOPBACK = ['127.0.0.1', 'localhost', '::1'].includes(HOST);
if (!AUTH && !LOOPBACK && process.env.ALLOW_NO_AUTH !== '1') {
  console.error('Para escuchar fuera de localhost define AUTH_USER y AUTH_PASS (o ALLOW_NO_AUTH=1 bajo tu riesgo).');
  process.exit(1);
}
const authorized = (req) => {
  if (!AUTH) return true;
  const m = (req.headers.authorization || '').match(/^Basic (.+)$/i);
  if (!m) return false;
  const got = Buffer.from(m[1], 'base64');
  return got.length === AUTH.length && require('crypto').timingSafeEqual(got, AUTH);
};
const PUBLIC = path.join(__dirname, 'public');
const HAS_FFMPEG = spawnSync('ffmpeg', ['-version']).status === 0;
const NATIVE = new Set(['.mp4', '.m4v', '.webm', '.mov']);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp4': 'video/mp4',
  '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/mp4', '.mkv': 'video/x-matroska', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.avi': 'video/x-msvideo' };

const lib = new Library(MEDIA_DIR, path.join(__dirname, 'data'));
const dl = new Downloader(MEDIA_DIR, path.join(__dirname, 'data'));
const clients = new Set();
dl.on('update', () => { for (const r of clients) r.write('data: downloads\n\n'); });
lib.on('change', () => { for (const r of clients) r.write('data: change\n\n'); });

// --- actualización automática: watcher + reescaneo periódico ---
let timer = null;
const rescan = () => { clearTimeout(timer); timer = setTimeout(() => { try { lib.scan(); } catch (e) { console.warn(e.message); } }, 2000); };
try { fs.watch(MEDIA_DIR, { recursive: true }, rescan); } catch { console.warn('fs.watch recursivo no disponible; solo reescaneo periódico'); }
setInterval(rescan, 60000);
lib.scan();

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

function stream(req, res, f) {
  const full = path.join(MEDIA_DIR, f.rel);
  if (!NATIVE.has(f.ext) && HAS_FFMPEG) { // MKV/AVI → MP4 fragmentado al vuelo (sin seek)
    res.writeHead(200, { 'Content-Type': 'video/mp4' });
    const ff = spawn('ffmpeg', ['-v', 'error', '-i', full, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'copy', '-c:a', 'aac',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1']);
    ff.stdout.pipe(res);
    res.on('close', () => ff.kill('SIGKILL'));
    return;
  }
  const size = fs.statSync(full).size;
  const type = MIME[f.ext] || 'application/octet-stream';
  const m = (req.headers.range || '').match(/bytes=(\d*)-(\d*)/);
  if (m) {
    let start = m[1] ? +m[1] : size - +m[2];
    let end = m[1] && m[2] ? +m[2] : size - 1;
    if (!(start >= 0 && start <= end && end < size)) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(full, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': size });
    fs.createReadStream(full).pipe(res);
  }
}

function upload(req, res, url) {
  // Cada segmento del nombre se sanea; no se permite salir de MEDIA_DIR.
  const segs = (url.searchParams.get('name') || '').split(/[\\/]+/)
    .map((s) => s.replace(/[<>:"|?*\x00-\x1f]/g, '_').trim()).filter((s) => s && s !== '.' && s !== '..');
  const ext = path.extname(segs[segs.length - 1] || '').toLowerCase();
  if (!segs.length || !(VIDEO.has(ext) || SUB.has(ext))) return send(res, 400, { error: 'nombre o extensión no permitidos' });
  const dest = path.join(MEDIA_DIR, ...segs);
  if (!dest.startsWith(MEDIA_DIR + path.sep)) return send(res, 400, { error: 'ruta inválida' });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  const out = fs.createWriteStream(tmp);
  req.pipe(out);
  out.on('finish', () => { fs.renameSync(tmp, dest); rescan(); send(res, 201, { ok: true }); });
  const fail = () => { out.destroy(); fs.rm(tmp, { force: true }, () => {}); };
  req.on('aborted', fail); out.on('error', (e) => { fail(); send(res, 500, { error: e.message }); });
}

function readJson(req, res, fn) {
  let body = '';
  req.on('data', (d) => { body += d; if (body.length > 10000) req.destroy(); });
  req.on('end', async () => {
    try { await fn(JSON.parse(body || '{}')); } catch (e) { send(res, 400, { error: e.message }); }
  });
}

http.createServer((req, res) => {
  if (!authorized(req)) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Biblioteca"' }); return res.end(); }
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/api/library') return send(res, 200, lib.toJSON());
    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write('retry: 3000\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return;
    }
    if (p === '/api/upload' && req.method === 'POST') return upload(req, res, url);
    if (p === '/api/downloads' && req.method === 'GET') return send(res, 200, dl.state());
    if (p === '/api/downloads' && req.method === 'POST') return readJson(req, res, async ({ url: u, subscribe }) => {
      if (subscribe) dl.subscribe(u); else await dl.add(u);
      send(res, 202, { ok: true });
    });
    if (p === '/api/downloads' && req.method === 'DELETE') return readJson(req, res, ({ url: u }) => { dl.unsubscribe(u); send(res, 200, { ok: true }); });
    let m;
    if ((m = p.match(/^\/stream\/(\w+)$/))) { const f = lib.files.get(m[1]); return f ? stream(req, res, f) : send(res, 404, { error: 'no existe' }); }
    if ((m = p.match(/^\/sub\/(\w+)\/(\d+)$/))) {
      const s = lib.files.get(m[1])?.subs[+m[2]];
      if (!s) return send(res, 404, { error: 'no existe' });
      return send(res, 200, toVtt(fs.readFileSync(s.file, 'utf8'), path.extname(s.file).toLowerCase()), 'text/vtt; charset=utf-8');
    }
    const file = path.join(PUBLIC, p === '/' ? 'index.html' : p);
    if (file.startsWith(PUBLIC + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      return fs.createReadStream(file).pipe(res);
    }
    send(res, 404, { error: 'no encontrado' });
  } catch (e) { send(res, 500, { error: e.message }); }
}).listen(PORT, HOST, () => console.log(`Biblioteca en http://${HOST}:${PORT}  (carpeta: ${MEDIA_DIR}, ffmpeg: ${HAS_FFMPEG ? 'sí' : 'no'})`));
