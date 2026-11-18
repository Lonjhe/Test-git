// Séance — serveur : sert l'interface, l'API du catalogue et relaie les flux.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { ROOT, DATA_DIR, config, userState, JsonFile, newId } from './store.js';
import { Catalog } from './catalog.js';
import { Tmdb } from './tmdb.js';
import { connect, userAgentFor, xtreamFromM3uUrl, normalizeBase } from './xtream.js';
import { movieDetail, seriesDetail, epg } from './details.js';
import { makeSigner, proxyStream } from './proxy.js';
import { demoArt } from './demo.js';
import { hasFfmpeg, probe, convert, startHls, hlsFile, stopAllConversions } from './convert.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.mp4': 'video/mp4', '.m4s': 'video/iso.segment', '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.map': 'application/json',
};

const STATIC = [
  ['/shared/', path.join(ROOT, 'shared')],
  ['/demo/media/', path.join(ROOT, 'server', 'demo-media')],
  ['/', path.join(ROOT, 'public')],
];
const VENDOR = {
  '/vendor/hls.min.js': path.join(ROOT, 'node_modules/hls.js/dist/hls.min.js'),
  '/vendor/mpegts.js': path.join(ROOT, 'node_modules/mpegts.js/dist/mpegts.js'),
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req, limit = 1 << 20) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'JSON attendu');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Requête trop volumineuse');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'JSON invalide');
  }
}

function serveFile(req, res, file) {
  let stat;
  try { stat = fs.statSync(file); } catch { stat = null; }
  if (!stat?.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Introuvable');
    return;
  }
  const headers = {
    'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
    'Last-Modified': stat.mtime.toUTCString(),
  };
  if (req.headers['if-modified-since'] === headers['Last-Modified'] && !req.headers.range) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  let start = 0;
  let end = stat.size - 1;
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = +range[1];
      if (range[2]) end = Math.min(+range[2], end);
    } else {
      start = Math.max(0, stat.size - +range[2]);
    }
    if (start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
  }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(headers['Content-Range'] ? 206 : 200, headers);
  if (req.method === 'HEAD') res.end();
  else fs.createReadStream(file, { start, end }).pipe(res);
}

export async function startServer({ port = +process.env.PORT || 8080, host = process.env.HOST || '0.0.0.0' } = {}) {
  let listenPort = port;
  const catalog = new Catalog(config, { origin: () => `http://127.0.0.1:${listenPort}` });
  const tmdb = new Tmdb(config, new JsonFile('cache/tmdb.json', { matches: {}, genres: {} }));
  const signer = makeSigner(config.data.secret);
  const preloaded = new Map();
  let gz = { version: -1, buf: null };

  const enrich = () => tmdb.enrichAll(catalog).catch((err) => console.warn('[tmdb]', err.message));
  catalog.listeners.push(enrich);

  const ffmpeg = await hasFfmpeg();

  const status = () => ({
    configured: catalog.sources.length > 0,
    sources: catalog.sources.map((s) => ({
      id: s.id, type: s.type, name: s.name, username: s.username || '', account: s.account || null,
      host: s.url ? (() => { try { return new URL(s.url).host; } catch { return ''; } })() : s.file ? 'fichier importé' : '',
    })),
    settings: {
      tmdb: tmdb.enabled,
      showAdult: config.data.settings.showAdult === true,
      liveFormat: config.data.settings.liveFormat === 'ts' ? 'ts' : 'm3u8',
      ffmpeg,
    },
    catalog: {
      version: catalog.version,
      updatedAt: catalog.data?.updatedAt || 0,
      loading: catalog.loading,
      error: catalog.error,
      warnings: catalog.data?.warnings || [],
      counts: {
        movies: catalog.data?.movies.length || 0,
        series: catalog.data?.series.length || 0,
        channels: catalog.data?.channels.length || 0,
      },
    },
    enrichment: tmdb.progress,
  });

  async function addSource(body) {
    const type = body.type;
    let source;
    if (type === 'demo') {
      if (catalog.sources.some((s) => s.type === 'demo')) throw new HttpError(400, 'La démonstration est déjà ajoutée');
      source = { id: 'demo', type, name: 'Démonstration' };
    } else if (type === 'xtream' || (type === 'm3u' && body.url && xtreamFromM3uUrl(body.url))) {
      const x = type === 'xtream' ? body : xtreamFromM3uUrl(body.url);
      if (!x.url || !x.username || !x.password) throw new HttpError(400, 'Adresse, identifiant et mot de passe sont requis');
      let base;
      try { base = normalizeBase(x.url); } catch { throw new HttpError(400, 'Adresse du serveur invalide'); }
      source = { id: newId(), type: 'xtream', name: body.name?.trim() || new URL(base).hostname, url: base, username: x.username.trim(), password: x.password };
      try {
        source.account = await connect(source);
      } catch (err) {
        throw new HttpError(400, err.name === 'TimeoutError' ? 'Le serveur IPTV ne répond pas' : `Connexion impossible : ${err.cause?.code || err.message}`);
      }
    } else if (type === 'm3u') {
      source = { id: newId(), type, name: body.name?.trim() || 'Playlist' };
      if (typeof body.content === 'string' && body.content.trim()) {
        source.file = `playlist-${source.id}.m3u`;
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(path.join(DATA_DIR, source.file), body.content, { mode: 0o600 });
      } else {
        try { source.url = new URL(body.url).href; } catch { throw new HttpError(400, 'Adresse de playlist invalide'); }
        if (!/^https?:$/.test(new URL(source.url).protocol)) throw new HttpError(400, 'Adresse de playlist invalide');
        if (!body.name?.trim()) source.name = new URL(source.url).hostname;
      }
      try {
        preloaded.set(source.id, await catalog.probe(source));
      } catch (err) {
        if (source.file) fs.rmSync(path.join(DATA_DIR, source.file), { force: true });
        throw new HttpError(400, `Playlist illisible : ${err.cause?.code || err.message}`);
      }
    } else {
      throw new HttpError(400, 'Type de source inconnu');
    }
    config.data.sources.push(source);
    config.flush();
    catalog.refresh(preloaded).catch((err) => console.error('[catalogue]', err));
    return source;
  }

  async function api(req, res, url) {
    const p = url.pathname;
    const method = req.method;
    const idOf = (prefix) => decodeURIComponent(p.slice(prefix.length));

    if (p === '/api/status' && method === 'GET') return sendJson(res, 200, status());

    if (p === '/api/catalog' && method === 'GET') {
      if (gz.version !== catalog.version) {
        gz = { version: catalog.version, buf: zlib.gzipSync(JSON.stringify(catalog.client())) };
      }
      const etag = `"${gz.version}"`;
      if (req.headers['if-none-match'] === etag) { res.writeHead(304); return res.end(); }
      const gzipOk = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', ETag: etag,
        ...(gzipOk ? { 'Content-Encoding': 'gzip' } : {}),
      });
      return res.end(gzipOk ? gz.buf : zlib.gunzipSync(gz.buf));
    }

    if (p === '/api/sources' && method === 'POST') {
      const source = await addSource(await readJson(req, 200 << 20));
      return sendJson(res, 200, { ok: true, id: source.id });
    }

    if (p.startsWith('/api/sources/') && method === 'DELETE') {
      const id = idOf('/api/sources/');
      const source = catalog.source(id);
      if (!source) throw new HttpError(404, 'Source inconnue');
      config.data.sources = config.data.sources.filter((s) => s.id !== id);
      config.flush();
      if (source.file) fs.rmSync(path.join(DATA_DIR, path.basename(source.file)), { force: true });
      if (catalog.sources.length) catalog.refresh().catch(() => {});
      else catalog.clear();
      return sendJson(res, 200, { ok: true });
    }

    if (p === '/api/refresh' && method === 'POST') {
      catalog.refresh().catch((err) => console.error('[catalogue]', err));
      return sendJson(res, 200, { ok: true });
    }

    if (p === '/api/settings' && method === 'PUT') {
      const body = await readJson(req);
      const settings = config.data.settings;
      let reload = false;
      if (typeof body.tmdbKey === 'string') {
        const previous = settings.tmdbKey;
        settings.tmdbKey = body.tmdbKey.trim();
        if (settings.tmdbKey) {
          try {
            await tmdb.check();
          } catch (err) {
            settings.tmdbKey = previous;
            throw new HttpError(400, err.fatal ? 'Clé TMDB refusée' : `TMDB injoignable : ${err.cause?.code || err.message}`);
          }
        } else {
          tmdb.stop();
        }
      }
      for (const key of ['showAdult']) {
        if (typeof body[key] === 'boolean' && settings[key] !== body[key]) { settings[key] = body[key]; reload = true; }
      }
      if (['ts', 'm3u8'].includes(body.liveFormat) && settings.liveFormat !== body.liveFormat) {
        settings.liveFormat = body.liveFormat;
        reload = true;
      }
      config.flush();
      if (reload && catalog.sources.length) catalog.refresh().catch(() => {});
      else enrich();
      return sendJson(res, 200, { ok: true });
    }

    if (p.startsWith('/api/movie/') && method === 'GET') {
      const detail = await movieDetail(catalog, tmdb, idOf('/api/movie/'));
      if (!detail) throw new HttpError(404, 'Film introuvable');
      return sendJson(res, 200, detail);
    }

    if (p.startsWith('/api/series/') && method === 'GET') {
      let detail;
      try {
        detail = await seriesDetail(catalog, idOf('/api/series/'));
      } catch (err) {
        throw new HttpError(502, `Le fournisseur n'a pas renvoyé les épisodes : ${err.cause?.code || err.message}`);
      }
      if (!detail) throw new HttpError(404, 'Série introuvable');
      return sendJson(res, 200, detail);
    }

    if (p.startsWith('/api/epg/') && method === 'GET') {
      return sendJson(res, 200, await epg(catalog, idOf('/api/epg/')).catch(() => []));
    }

    if (p.startsWith('/api/play/') && method === 'GET') {
      const id = idOf('/api/play/');
      const target = catalog.resolve(id);
      if (!target) throw new HttpError(404, 'Flux introuvable');
      const out = { url: `/stream/${encodeURIComponent(id)}`, type: target.type, external: target.url, ext: (/\.([a-z0-9]{2,4})(?:$|\?)/i.exec(new URL(target.url).pathname)?.[1] || '').toLowerCase() };
      const ref = catalog.split(id);
      if (ref?.kind === 'c' && ref.source?.type === 'xtream') {
        const other = target.type === 'hls' ? 'ts' : 'm3u8';
        out.alt = { url: `${out.url}?fmt=${other}`, type: other === 'ts' ? 'mpegts' : 'hls' };
      }
      // Films et épisodes : conversion possible si ffmpeg est installé.
      if (target.type === 'file') {
        out.ffmpeg = ffmpeg;
        if (ffmpeg) {
          out.convert = `/convert/${encodeURIComponent(id)}`;
          out.convertHls = `/convert-hls/${encodeURIComponent(id)}`;
        }
      }
      return sendJson(res, 200, out);
    }

    if (p.startsWith('/api/probe/') && method === 'GET') {
      const id = idOf('/api/probe/');
      const target = catalog.resolve(id);
      if (!target || !ffmpeg) throw new HttpError(404, 'Analyse indisponible');
      try {
        return sendJson(res, 200, await probe(target.url, userAgentFor(catalog.split(id)?.source)));
      } catch (err) {
        throw new HttpError(502, err.message);
      }
    }

    if (p === '/api/state' && method === 'GET') return sendJson(res, 200, userState.data);

    if (p === '/api/state/favorite' && method === 'POST') {
      const { id, on } = await readJson(req);
      if (typeof id !== 'string' || !id) throw new HttpError(400, 'Identifiant manquant');
      if (on) userState.data.favorites[id] = Date.now();
      else delete userState.data.favorites[id];
      userState.save();
      return sendJson(res, 200, { ok: true });
    }

    if (p === '/api/state/progress' && method === 'POST') {
      const body = await readJson(req);
      if (typeof body.id !== 'string' || !body.id) throw new HttpError(400, 'Identifiant manquant');
      const progress = userState.data.progress;
      if (body.remove) {
        delete progress[body.id];
      } else {
        const text = (v) => (typeof v === 'string' ? v.slice(0, 300) : '');
        progress[body.id] = {
          pos: Math.max(0, +body.pos || 0), dur: Math.max(0, +body.dur || 0), ts: Date.now(), done: !!body.done,
          kind: text(body.kind), title: text(body.title), sub: text(body.sub), poster: text(body.poster),
          parent: text(body.parent), play: text(body.play),
        };
        const keys = Object.keys(progress);
        if (keys.length > 400) {
          keys.sort((a, b) => progress[a].ts - progress[b].ts).slice(0, keys.length - 400).forEach((k) => delete progress[k]);
        }
      }
      userState.save();
      return sendJson(res, 200, { ok: true });
    }

    throw new HttpError(404, 'Route inconnue');
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    try {
      if (p.startsWith('/api/')) return await api(req, res, url);

      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Méthode non autorisée');

      if (p.startsWith('/stream/')) {
        const id = decodeURIComponent(p.slice('/stream/'.length));
        const target = catalog.resolve(id);
        if (!target) throw new HttpError(404, 'Flux introuvable');
        let upstream = target.url;
        const fmt = url.searchParams.get('fmt');
        if (fmt === 'ts' || fmt === 'm3u8') upstream = upstream.replace(/\.(m3u8|ts)$/i, `.${fmt}`);
        const source = catalog.split(id)?.source;
        return await proxyStream(req, res, upstream, signer, { userAgent: userAgentFor(source), tag: source?.id });
      }

      if (p.startsWith('/convert/')) {
        const id = decodeURIComponent(p.slice('/convert/'.length));
        const target = catalog.resolve(id);
        if (!target || !ffmpeg) throw new HttpError(404, 'Conversion indisponible');
        return await convert(req, res, target.url, userAgentFor(catalog.split(id)?.source), Math.max(0, +url.searchParams.get('t') || 0));
      }

      if (p.startsWith('/convert-hls/')) {
        const id = decodeURIComponent(p.slice('/convert-hls/'.length));
        const target = catalog.resolve(id);
        if (!target || !ffmpeg) throw new HttpError(404, 'Conversion indisponible');
        let sid;
        try {
          sid = await startHls(target.url, userAgentFor(catalog.split(id)?.source), Math.max(0, +url.searchParams.get('t') || 0));
        } catch (err) {
          throw new HttpError(502, err.message);
        }
        res.writeHead(302, { Location: `/hls-conv/${sid}/index.m3u8`, 'Cache-Control': 'no-store' });
        return res.end();
      }

      if (p.startsWith('/hls-conv/')) {
        const [, , sid, name] = p.split('/');
        const file = hlsFile(sid, name || '');
        if (!file) throw new HttpError(404, 'Segment introuvable');
        return serveFile(req, res, file);
      }

      if (p === '/hls') {
        const upstream = signer.verify(url.searchParams.get('u'), url.searchParams.get('s'));
        if (!upstream) throw new HttpError(403, 'Lien de flux invalide');
        const source = catalog.source(url.searchParams.get('src') || '');
        return await proxyStream(req, res, upstream, signer, { userAgent: userAgentFor(source), tag: source?.id });
      }

      const art = /^\/demo\/art\/(\d+)\.svg$/.exec(p);
      if (art) {
        const shape = url.searchParams.get('shape');
        res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
        return res.end(demoArt(+art[1], url.searchParams.get('t') || '', ['wide', 'logo'].includes(shape) ? shape : 'poster'));
      }

      if (VENDOR[p]) return serveFile(req, res, VENDOR[p]);

      for (const [prefix, dir] of STATIC) {
        if (!p.startsWith(prefix)) continue;
        let rel;
        try { rel = decodeURIComponent(p.slice(prefix.length)); } catch { throw new HttpError(400, 'Adresse invalide'); }
        const file = path.join(dir, rel || 'index.html');
        if (file !== dir && !file.startsWith(dir + path.sep)) throw new HttpError(403, 'Accès refusé');
        return serveFile(req, res, file);
      }
      throw new HttpError(404, 'Introuvable');
    } catch (err) {
      if (!(err instanceof HttpError)) console.error('[serveur]', req.method, p, err);
      if (res.headersSent) return res.destroy();
      sendJson(res, err.status || 500, { error: err instanceof HttpError ? err.message : 'Erreur interne du serveur' });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  listenPort = server.address().port;

  if (catalog.stale) catalog.refresh().catch((err) => console.error('[catalogue]', err));
  else enrich();
  const timer = setInterval(() => { if (catalog.stale) catalog.refresh().catch(() => {}); }, 30 * 60e3);
  timer.unref();
  server.on('close', () => { clearInterval(timer); tmdb.stop(); stopAllConversions(); });

  return { server, port: listenPort, catalog, tmdb };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.HOST || '0.0.0.0';
  startServer({ host }).then(({ port }) => {
    console.log(`\n  Séance est prête.\n\n  Sur cet ordinateur :  http://localhost:${port}`);
    if (host === '0.0.0.0') {
      for (const list of Object.values(os.networkInterfaces())) {
        for (const a of list || []) {
          if (a.family === 'IPv4' && !a.internal) console.log(`  Sur le réseau local : http://${a.address}:${port}   (TV, tablette, téléphone)`);
        }
      }
    }
    console.log('');
  }).catch((err) => {
    console.error(err.code === 'EADDRINUSE' ? 'Ce port est déjà utilisé : lancez avec PORT=8081 npm start' : err);
    process.exit(1);
  });
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      for (const f of JsonFile.all) if (f.timer) f.flush();
      stopAllConversions();
      process.exit(0);
    });
  }
}
