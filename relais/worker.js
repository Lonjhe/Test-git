// Relais Séance — à déployer sur Cloudflare Workers (offre gratuite).
//
// La version en ligne de Séance tourne dans le navigateur, qui refuse d'appeler
// un fournisseur IPTV en HTTP ou qui n'autorise pas les sites web. Ce relais,
// servi en HTTPS, fait l'intermédiaire : il va chercher la ressource demandée
// chez le fournisseur et la renvoie au navigateur avec les en-têtes attendus.
//
// Il est protégé par une clé (variable « CLE ») : sans elle, il refuse tout.
// Utilisation : https://mon-relais.workers.dev/?k=<clé>&u=<adresse encodée>
// Guide pas à pas : relais/README.md

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
};
const PASS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'];

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

/** Comparaison sans fuite de temps (évite de deviner la clé caractère par caractère). */
function sameKey(a, b) {
  if (typeof a !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Réécrit une playlist HLS : segments, variantes et clés repassent par le relais. */
export function rewriteManifest(text, baseUrl, wrap) {
  const abs = (u) => {
    if (/^data:/i.test(u)) return u;
    try { return wrap(new URL(u, baseUrl).href); } catch { return u; }
  };
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${abs(u)}"`);
      return abs(t);
    })
    .join('\n');
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'Méthode non autorisée' });

    const here = new URL(request.url);
    const key = (env && env.CLE) || '';
    if (!key) return json(500, { error: 'Relais non configuré : ajoutez la variable CLE dans les réglages du Worker.' });
    if (!sameKey(here.searchParams.get('k'), key)) return json(403, { error: 'Clé du relais refusée' });
    if (here.searchParams.has('ping')) return json(200, { ok: true, service: 'seance-relais' });

    let target;
    try {
      target = new URL(here.searchParams.get('u'));
    } catch {
      return json(400, { error: 'Adresse à relayer manquante ou invalide' });
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return json(400, { error: 'Adresse à relayer invalide' });

    const headers = { 'User-Agent': (env && env.USER_AGENT) || 'Mozilla/5.0 (Seance IPTV Player)', Accept: '*/*' };
    const range = request.headers.get('Range');
    if (range) headers.Range = range;

    let up;
    try {
      up = await fetch(target.href, { method: request.method, headers, redirect: 'follow' });
    } catch (err) {
      return json(502, { error: `Le relais n'a pas pu joindre le fournisseur : ${err.message}` });
    }

    const wrap = (u) => `${here.origin}${here.pathname}?k=${encodeURIComponent(key)}&u=${encodeURIComponent(u)}`;
    const type = (up.headers.get('content-type') || '').toLowerCase();
    const finalUrl = up.url || target.href;

    // Playlist HLS (flux vidéo) : on réécrit ses adresses. Une playlist de chaînes
    // (.m3u « classique ») commence aussi par #EXTM3U mais doit rester intacte.
    if (up.ok && request.method === 'GET' && (type.includes('mpegurl') || /\.m3u8?$/i.test(new URL(finalUrl).pathname))) {
      const text = await up.text();
      const isHls = /#EXT-X-(TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE)/.test(text);
      return new Response(isHls ? rewriteManifest(text, finalUrl, wrap) : text, {
        status: 200,
        headers: { ...CORS, 'Content-Type': isHls ? 'application/vnd.apple.mpegurl' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    const out = new Headers(CORS);
    for (const name of PASS) {
      const value = up.headers.get(name);
      // fetch décompresse le corps : la longueur annoncée ne vaudrait plus.
      if (value && !(name === 'content-length' && up.headers.get('content-encoding'))) out.set(name, value);
    }
    // Les affiches peuvent rester en cache dans le navigateur ; le reste, non.
    out.set('Cache-Control', type.startsWith('image/') && up.ok ? 'public, max-age=604800' : 'no-store');
    return new Response(up.body, { status: up.status, headers: out });
  },
};
