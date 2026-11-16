// Client de l'API « Xtream Codes » (player_api.php), le format le plus courant
// chez les fournisseurs IPTV.
export const USER_AGENT = process.env.SEANCE_USER_AGENT || 'Mozilla/5.0 (Seance IPTV Player)';

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

export class Xtream {
  constructor(source) {
    this.base = normalizeBase(source.url);
    this.username = source.username;
    this.password = source.password;
  }

  async call(action, params = {}, timeout = 120_000) {
    const u = new URL(this.base + '/player_api.php');
    u.searchParams.set('username', this.username);
    u.searchParams.set('password', this.password);
    if (action) u.searchParams.set('action', action);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const res = await fetch(u, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(timeout) });
    if (!res.ok) throw new Error(`Le serveur IPTV a répondu ${res.status}`);
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
    if (!info || String(info.auth) === '0') throw new Error('Identifiants refusés par le serveur IPTV');
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

/** Décode une chaîne base64 (titres EPG) en restant tolérant. */
export function b64(s) {
  try {
    return Buffer.from(String(s || ''), 'base64').toString('utf8');
  } catch {
    return '';
  }
}
