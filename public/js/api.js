// Appels à l'API du serveur Séance.
//
// Deux modes :
//  - normal : l'interface parle au serveur Séance (sources IPTV, relais des flux) ;
//  - statique : démonstration en ligne sans serveur (GitHub Pages). Le catalogue
//    fictif est lu dans des fichiers JSON générés par scripts/build-pages.js, et
//    les favoris / la progression restent dans le navigateur.

export const isStatic = document.querySelector('meta[name="seance-static"]') !== null;

// Les chemins sont résolus par rapport à la page : le site peut vivre dans un sous-dossier.
const resolve = (path) => new URL(String(path).replace(/^\//, ''), document.baseURI).href;

async function request(method, path, body) {
  const res = await fetch(resolve(path), {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

// ——— Mode statique ———
const STATE_KEY = 'seance-demo-state';

function readState() {
  try {
    const s = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
    return { favorites: s.favorites || {}, progress: s.progress || {} };
  } catch {
    return { favorites: {}, progress: {} };
  }
}

function writeState(state) {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch { /* navigation privée : rien n'est conservé */ }
}

async function staticGet(path) {
  if (path === '/api/state') return readState();
  const play = /^\/api\/play\/(.+)$/.exec(path);
  if (play) {
    // Tout le catalogue de démonstration pointe vers les deux clips de test.
    return decodeURIComponent(play[1]).startsWith('c-')
      ? { url: 'demo/media/live/index.m3u8', type: 'hls' }
      : { url: 'demo/media/film.mp4', type: 'file' };
  }
  const data = await request('GET', `${path}.json`);
  if (path.startsWith('/api/epg/') && Array.isArray(data)) {
    // Le programme fictif est recalé sur l'heure courante.
    const slot = 3600;
    const start = Math.floor(Date.now() / 1000 / slot) * slot;
    return data.map((p, i) => ({ ...p, start: start + i * slot, end: start + (i + 1) * slot }));
  }
  return data;
}

async function staticWrite(method, path, body = {}) {
  const state = readState();
  if (method === 'POST' && path === '/api/state/favorite') {
    if (body.on) state.favorites[body.id] = Date.now();
    else delete state.favorites[body.id];
  } else if (method === 'POST' && path === '/api/state/progress') {
    if (body.remove) delete state.progress[body.id];
    else state.progress[body.id] = { ...body, ts: Date.now() };
  } else {
    throw new Error('Indisponible dans la démonstration en ligne');
  }
  writeState(state);
  return { ok: true };
}

export function clearDemoState() {
  try { localStorage.removeItem(STATE_KEY); } catch { /* rien à effacer */ }
}

export const api = isStatic
  ? {
    get: staticGet,
    post: (path, body) => staticWrite('POST', path, body),
    put: (path, body) => staticWrite('PUT', path, body),
    del: (path) => staticWrite('DELETE', path),
  }
  : {
    get: (path) => request('GET', path),
    post: (path, body = {}) => request('POST', path, body),
    put: (path, body = {}) => request('PUT', path, body),
    del: (path) => request('DELETE', path),
  };
