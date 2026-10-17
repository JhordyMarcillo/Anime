'use strict';
// Explora un sitio público a partir de una URL y devuelve los videos que publica
// abiertamente (etiquetas <video>/<source>, enlaces a archivos de video, og:video,
// JSON-LD). Es un rastreador respetuoso: solo el mismo dominio, respeta robots.txt,
// pausa entre peticiones y topes de páginas/profundidad/tiempo.
// No ejecuta JavaScript, no descifra reproductores protegidos ni evita bloqueos.
const path = require('path');
const { VIDEO } = require('./library');
const { clean } = require('./parse');

const UA = 'AnimeLibrary/1.0 (+personal media server)';
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const SKIP_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico', '.css', '.js', '.json', '.xml', '.zip', '.rar', '.7z', '.pdf',
  '.mp3', '.flac', '.woff', '.woff2', '.ttf', '.txt', '.srt', '.vtt', '.ass', '.torrent', '.exe', '.apk', '.iso']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const text = (html) => unesc(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const attrs = (tag) => {
  const out = {}; const re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g; let m;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = unesc(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
};
const isVideo = (u) => { try { return VIDEO.has(path.extname(new URL(u).pathname).toLowerCase()); } catch { return false; } };
const isHls = (u) => { try { return /\.(m3u8|mpd)$/i.test(new URL(u).pathname); } catch { return false; } };
const abs = (u, base) => { try { const x = new URL(u, base); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };

function parseRobots(body, ua = 'animelibrary') {
  const groups = []; let cur = null; let delay = 0;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); const i = line.indexOf(':'); if (i < 0) continue;
    const k = line.slice(0, i).trim().toLowerCase(), v = line.slice(i + 1).trim();
    if (k === 'user-agent') { if (!cur || cur.rules.length) { cur = { agents: [], rules: [], delay: 0 }; groups.push(cur); } cur.agents.push(v.toLowerCase()); }
    else if (cur && (k === 'disallow' || k === 'allow')) cur.rules.push({ allow: k === 'allow', path: v });
    else if (cur && k === 'crawl-delay') cur.delay = Math.min(10, parseFloat(v) || 0);
  }
  const mine = groups.find((g) => g.agents.some((a) => a !== '*' && ua.includes(a))) || groups.find((g) => g.agents.includes('*'));
  const rules = (mine?.rules || []).filter((r) => r.path);
  delay = mine?.delay || 0;
  return {
    delay,
    allowed(pathname) {
      let best = null;
      for (const r of rules) if (pathname.startsWith(r.path) && (!best || r.path.length > best.path.length)) best = r;
      return !best || best.allow;
    },
  };
}

// Extrae { media:[{url,title}], links:[url], pageTitle, hls } de una página HTML.
function extract(html, base) {
  const pageTitle = clean(text((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ''));
  const media = [], links = new Set(); let hls = 0;
  const add = (u, title) => { const a = abs(u, base); if (!a) return; if (isHls(a)) { hls++; return; } if (isVideo(a)) media.push({ url: a, title: (title || '').trim() }); };

  for (const m of html.matchAll(/<video\b[^>]*>[\s\S]*?<\/video>|<video\b[^>]*\/>/gi)) {
    const block = m[0]; const v = attrs(block.match(/<video\b[^>]*>/i)[0]);
    if (v.src) add(v.src, v.title || v['aria-label']);
    for (const s of block.matchAll(/<source\b[^>]*>/gi)) { const a = attrs(s[0]); if (a.src && (!a.type || /^video\//i.test(a.type) || isVideo(a.src))) add(a.src, v.title); }
  }
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    if (/^og:video(:url|:secure_url)?$/i.test(a.property || a.name || '') && a.content) add(a.content);
  }
  for (const m of html.matchAll(/"contentUrl"\s*:\s*"([^"]+)"/g)) add(m[1].replace(/\\\//g, '/'));
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const a = attrs(m[1]); if (!a.href || a.href.startsWith('#') || /^(javascript|mailto|tel):/i.test(a.href)) continue;
    const u = abs(a.href, base); if (!u) continue;
    if (isVideo(u) || isHls(u)) add(u, text(m[2]) || a.title);
    else links.add(u.split('#')[0]);
  }
  // Un solo video en la página: el título de la página es mejor nombre que el del archivo.
  const uniq = [...new Map(media.map((m) => [m.url, m])).values()];
  return { media: uniq, links: [...links], pageTitle, hls };
}

function entryTitle(m, pageTitle, onlyOne) {
  let t = clean(m.title || '');
  const file = clean(decodeURIComponent(path.basename(new URL(m.url).pathname, path.extname(m.url.split('?')[0]))));
  if (!t) t = onlyOne && pageTitle ? pageTitle : file;
  // "Episodio 5" suelto: se antepone el nombre de la serie (título de la página)
  if (pageTitle && /^(?:episodio|episode|ep\.?|cap[ií]tulo|cap\.?|e)?\s*\d+\b/i.test(t) && !t.toLowerCase().includes(pageTitle.toLowerCase())) t = `${pageTitle} - ${t}`;
  return t || file;
}

async function crawl(startUrl, { checkUrl, maxPages = 40, maxDepth = 2, maxMs = 3 * 60000, maxEntries = 500, onProgress } = {}) {
  const start = new URL(startUrl);
  const deadline = Date.now() + maxMs;
  const get = async (url, accept) => {
    let u = url;
    for (let hop = 0; hop < 5; hop++) {
      await checkUrl(u);
      if (new URL(u).host !== start.host) throw new Error('redirige a otro dominio');
      const res = await fetch(u, { redirect: 'manual', headers: { 'User-Agent': UA, Accept: accept }, signal: AbortSignal.timeout(15000) });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { u = new URL(res.headers.get('location'), u).href; continue; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const ct = res.headers.get('content-type') || '';
      const chunks = []; let n = 0;
      for await (const c of res.body) { n += c.length; if (n > MAX_PAGE_BYTES) break; chunks.push(c); }
      return { body: Buffer.concat(chunks).toString('utf8'), ct, url: u };
    }
    throw new Error('demasiadas redirecciones');
  };

  let robots = { delay: 0, allowed: () => true };
  try { robots = parseRobots((await get(new URL('/robots.txt', start).href, 'text/plain')).body); } catch { /* sin robots.txt */ }
  const pause = Math.max(400, robots.delay * 1000);

  const queue = [{ url: start.href.split('#')[0], depth: 0 }];
  const seen = new Set([queue[0].url]);
  const entries = new Map(); let pages = 0, hls = 0, blocked = 0, lastErr = null;

  while (queue.length && pages < maxPages && entries.size < maxEntries && Date.now() < deadline) {
    const { url, depth } = queue.shift();
    if (!robots.allowed(new URL(url).pathname + new URL(url).search)) { blocked++; continue; }
    let page;
    try { page = await get(url, 'text/html,application/xhtml+xml'); } catch (e) { lastErr = e.message; continue; }
    if (page.ct && !/html|xml/i.test(page.ct)) continue;
    pages++;
    const x = extract(page.body, page.url);
    hls += x.hls;
    for (const m of x.media) if (!entries.has(m.url)) entries.set(m.url, { title: entryTitle(m, x.pageTitle, x.media.length === 1), url: m.url, referer: page.url });
    if (depth < maxDepth) {
      for (const l of x.links) {
        let u; try { u = new URL(l); } catch { continue; }
        if (u.host !== start.host || seen.has(l)) continue;
        if (SKIP_EXT.has(path.extname(u.pathname).toLowerCase())) continue;
        seen.add(l); queue.push({ url: l, depth: depth + 1 });
      }
    }
    onProgress?.({ pages, entries: entries.size });
    if (queue.length) await sleep(pause);
  }
  return { entries: [...entries.values()].slice(0, maxEntries), pages, hls, blocked, error: pages === 0 ? lastErr : null };
}

module.exports = { crawl, extract, parseRobots };
