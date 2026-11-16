// Relais des flux vidéo. Le navigateur ne parle qu'à ce serveur :
//  - les identifiants du fournisseur ne quittent jamais la machine,
//  - pas de blocage CORS / contenu mixte,
//  - les playlists HLS sont réécrites pour que leurs segments passent aussi par ici.
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { USER_AGENT } from './xtream.js';

export function makeSigner(secret) {
  const mac = (url) => crypto.createHmac('sha256', secret).update(url).digest('base64url').slice(0, 24);
  return {
    sign: (url) => `/hls?u=${Buffer.from(url).toString('base64url')}&s=${mac(url)}`,
    /** Renvoie l'URL d'origine si la signature est valide, sinon null. */
    verify(u, s) {
      let url;
      try { url = Buffer.from(String(u), 'base64url').toString(); } catch { return null; }
      const expected = mac(url);
      const given = String(s);
      if (given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return null;
      return /^https?:\/\//i.test(url) ? url : null;
    },
  };
}

/** Réécrit une playlist HLS : chaque URI (segments, variantes, clés) devient une URL signée du relais. */
export function rewriteManifest(text, baseUrl, sign) {
  const abs = (u) => {
    if (/^data:/i.test(u)) return u;
    try { return sign(new URL(u, baseUrl).href); } catch { return u; }
  };
  return String(text)
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${abs(u)}"`);
      return abs(t);
    })
    .join('\n');
}

const MIME = { mp4: 'video/mp4', m4v: 'video/mp4', mkv: 'video/x-matroska', webm: 'video/webm', ts: 'video/mp2t', avi: 'video/x-msvideo', mov: 'video/quicktime' };
const PASS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'];

/**
 * opts.userAgent : nom de lecteur accepté par la source ;
 * opts.tag : identifiant de la source, reporté sur les liens HLS pour garder ce nom.
 */
export async function proxyStream(req, res, upstream, signer, opts = {}) {
  const sign = (u) => signer.sign(u) + (opts.tag ? `&src=${encodeURIComponent(opts.tag)}` : '');
  const controller = new AbortController();
  const abort = () => controller.abort();
  res.on('close', abort);

  const headers = { 'User-Agent': opts.userAgent || USER_AGENT, Accept: '*/*' };
  if (req.headers.range) headers.Range = req.headers.range;

  let up;
  try {
    up = await fetch(upstream, { headers, redirect: 'follow', signal: controller.signal });
  } catch (err) {
    if (!res.headersSent && !res.destroyed) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Flux injoignable : ${err.cause?.code || err.message}`);
    }
    return;
  }

  const type = (up.headers.get('content-type') || '').toLowerCase();
  const finalPath = new URL(up.url || upstream).pathname.toLowerCase();
  const isManifest = up.ok && (/mpegurl/.test(type) || /\.m3u8?$/.test(finalPath));

  if (isManifest) {
    const text = await up.text();
    const body = text.trimStart().startsWith('#EXTM3U') ? rewriteManifest(text, up.url || upstream, sign) : text;
    res.writeHead(200, {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(body);
    return;
  }

  const out = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
  for (const h of PASS) {
    const v = up.headers.get(h);
    // fetch décompresse le corps : la longueur annoncée ne vaudrait plus.
    if (v && !(h === 'content-length' && up.headers.get('content-encoding'))) out[h] = v;
  }
  const ext = finalPath.match(/\.([a-z0-9]+)$/)?.[1];
  if ((!type || type === 'application/octet-stream') && MIME[ext]) out['content-type'] = MIME[ext];
  res.writeHead(up.status, out);
  if (!up.body || req.method === 'HEAD') {
    controller.abort();
    res.end();
    return;
  }
  const body = Readable.fromWeb(up.body);
  body.on('error', () => res.destroy());
  body.pipe(res);
}
