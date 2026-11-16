// Client de l'API « Xtream Codes » (player_api.php), le format le plus courant
// chez les fournisseurs IPTV. Utilisé par le serveur et par la version en ligne.

export function normalizeBase(url) {
  let u = String(url || '').trim();
  if (!u) throw new Error('Adresse du serveur manquante');
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  const parsed = new URL(u);
  return parsed.origin;
}

/** Reconnaît un lien M3U de type get.php?username=…&password=… (compte Xtream). */
export function xtreamFromM3uUrl(url) {
  try {
    const u = new URL(url);
    const username = u.searchParams.get('username');
    const password = u.searchParams.get('password');
    if (/\/get\.php$/i.test(u.pathname) && username && password) return { url: u.origin, username, password };
  } catch { /* pas une URL */ }
  return null;
}

/**
 * Adresses à essayer depuis un navigateur. Une page servie en HTTPS n'a pas le
 * droit d'appeler un serveur en HTTP : on tente alors ses variantes HTTPS.
 */
export function directCandidates(url, pageProtocol) {
  const base = normalizeBase(url);
  if (pageProtocol !== 'https:' || base.startsWith('https://')) return [base];
  const u = new URL(base);
  const list = [`https://${u.host}`];
  if (u.port) list.push(`https://${u.hostname}`);
  return list;
}

export class Xtream {
  /**
   * headers : en-têtes ajoutés aux appels (le serveur y met son User-Agent).
   * wrap : transforme l'adresse appelée — la version en ligne s'en sert pour passer par un relais.
   */
  constructor(source, { headers = {}, wrap = (url) => url } = {}) {
    this.base = normalizeBase(source.url);
    this.username = source.username;
    this.password = source.password;
    this.headers = headers;
    this.wrap = wrap;
  }

  async call(action, params = {}, timeout = 120_000) {
    const u = new URL(this.base + '/player_api.php');
    u.searchParams.set('username', this.username);
    u.searchParams.set('password', this.password);
    if (action) u.searchParams.set('action', action);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const res = await fetch(this.wrap(u.href), { headers: this.headers, signal: AbortSignal.timeout(timeout) });
    if (!res.ok) {
      // Un relais explique son échec dans un petit message JSON : on le conserve.
      const detail = await res.json().then((d) => d?.error, () => undefined);
      throw Object.assign(new Error(`Le serveur IPTV a répondu ${res.status}`), { status: res.status, detail });
    }
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('Réponse inattendue du serveur IPTV (ce n\'est pas une API Xtream ?)');
    }
  }

  async account() {
    const data = await this.call('', {}, 20_000);
    const info = data?.user_info;
    if (!info || String(info.auth) === '0') throw Object.assign(new Error('Identifiants refusés par le serveur IPTV'), { refused: true });
    return {
      status: info.status || '',
      expires: +info.exp_date || 0,
      maxConnections: +info.max_connections || 0,
      activeConnections: +info.active_cons || 0,
    };
  }

  streamUrl(kind, id, ext) {
    const dir = kind === 'live' ? 'live' : kind === 'movie' ? 'movie' : 'series';
    const cred = `${encodeURIComponent(this.username)}/${encodeURIComponent(this.password)}`;
    return `${this.base}/${dir}/${cred}/${id}.${ext}`;
  }
}

export function asArray(x) {
  if (Array.isArray(x)) return x;
  if (x && typeof x === 'object') return Object.values(x);
  return [];
}

/** Décode une chaîne base64 en UTF-8 (titres EPG) en restant tolérant. */
export function b64(s) {
  try {
    const bin = atob(String(s || '').replace(/\s+/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return '';
  }
}
