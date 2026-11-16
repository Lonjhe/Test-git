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

const VERSION = 2;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
// Hôtes en adresse IP pour lesquels le passage par un nom de domaine a fonctionné.
const viaDns = new Set();

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

/**
 * Cloudflare signale ses propres refus par une courte page « error code: 1xxx »
 * (statut 403, 409 ou 530). Renvoie ce code, ou 0 si la réponse vient du fournisseur.
 */
async function cloudflareCode(res) {
  if (![403, 409, 530].includes(res.status)) return 0;
  if (!/^text\//i.test(res.headers.get('content-type') || '')) return 0;
  if (+res.headers.get('content-length') > 20000) return 0;
  const text = (await res.clone().text()).slice(0, 20000);
  const m = /error code:\s*(1\d{3})/i.exec(text) || /Error\s+(1\d{3})\b/.exec(text);
  return m ? +m[1] : res.status === 530 ? 530 : 0;
}

function explain(code) {
  if (code === 1003) return 'Cloudflare refuse que le relais appelle directement cette adresse IP (erreur 1003).';
  if (code === 1016) return 'Cloudflare ne trouve pas ce serveur depuis son réseau (erreur 1016 : nom de domaine introuvable).';
  if ([1006, 1007, 1008, 1010, 1020].includes(code)) return `Votre fournisseur bloque les connexions venant de Cloudflare (erreur ${code}).`;
  return `Cloudflare a refusé la connexion du relais vers ce serveur (erreur ${code}).`;
}

/**
 * Appelle le fournisseur. Cloudflare interdit à un Worker d'appeler une adresse IP
 * « nue » : dans ce cas on réessaie avec un nom de domaine qui désigne la même
 * adresse (service public nip.io : 1.2.3.4.nip.io → 1.2.3.4).
 */
async function reach(target, init, env) {
  const tries = [target.href];
  if (IPV4.test(target.hostname)) {
    const named = new URL(target.href);
    named.hostname = `${target.hostname}.${(env && env.DNS_IP) || 'nip.io'}`;
    if (viaDns.has(target.host)) tries.unshift(named.href);
    else tries.push(named.href);
  }
  let failure = {};
  for (const href of tries) {
    try {
      const res = await fetch(href, init);
      const code = await cloudflareCode(res);
      if (!code) {
        if (href !== target.href) viaDns.add(target.host);
        return { res };
      }
      failure = { code };
    } catch (err) {
      if (!failure.code) failure = { message: err.message };
    }
  }
  return failure;
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
    if (here.searchParams.has('ping')) return json(200, { ok: true, service: 'seance-relais', version: VERSION });

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

    const { res: up, code, message } = await reach(target, { method: request.method, headers, redirect: 'follow' }, env);
    if (!up) {
      return code
        ? json(502, { error: explain(code), cloudflare: code })
        : json(502, { error: `Le relais n'a pas pu joindre ce serveur (${message || 'pas de réponse'}).` });
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
