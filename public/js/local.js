// « Serveur » embarqué de la version en ligne (GitHub Pages).
//
// Sans serveur Séance, c'est le navigateur qui se connecte au fournisseur IPTV :
// il lit le catalogue (compte Xtream ou playlist M3U), le met en cache dans le
// navigateur et lit les flux directement. Tant qu'aucune source n'est ajoutée,
// on affiche le catalogue de démonstration (fichiers JSON générés au build).
//
// Ce module répond aux mêmes routes que l'API du serveur (voir server/index.js),
// pour que le reste de l'interface ne voie pas la différence.
import { Catalog, xtreamData, m3uData } from '../shared/catalog.js';
import { Xtream, xtreamFromM3uUrl, directCandidates } from '../shared/xtream.js';
import { Tmdb } from '../shared/tmdb.js';
import { movieDetail, seriesDetail, epg } from '../shared/details.js';

const CONFIG_KEY = 'seance-config';
export const STATE_KEY = 'seance-demo-state';

const UNREACHABLE = 'Le navigateur n\'a pas pu joindre ce serveur. Depuis cette page en ligne, votre fournisseur doit être '
  + 'accessible en HTTPS et accepter les connexions venant d\'un site web. Si l\'adresse est correcte, installez Séance chez vous : '
  + 'son serveur fait l\'intermédiaire et lève ces limites.';

class ApiError extends Error {}

// ——— Stockage : réglages dans localStorage, gros volumes (catalogue) dans IndexedDB ———
const idb = (() => {
  let opening;
  const open = () => (opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('seance', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  };
  // En navigation privée IndexedDB peut manquer : on continue sans cache.
  return {
    get: (key) => run('readonly', (s) => s.get(key)).catch(() => undefined),
    set: (key, value) => run('readwrite', (s) => s.put(value, key)).catch(() => {}),
    del: (key) => run('readwrite', (s) => s.delete(key)).catch(() => {}),
  };
})();

/** Objet { data, save() } attendu par Catalog et Tmdb, enregistré en différé. */
function persisted(data, write) {
  let timer;
  return {
    data,
    save(delay = 400) {
      clearTimeout(timer);
      timer = setTimeout(() => write(this.data), delay);
    },
  };
}

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* navigation privée : rien n'est conservé */ }
}

const asset = (path) => new URL(path, document.baseURI).href;
const demoFiles = new Map();
/** Fichier JSON du catalogue de démonstration. */
function demoJson(path) {
  if (!demoFiles.has(path)) {
    demoFiles.set(path, fetch(asset(path)).then((res) => {
      if (!res.ok) throw new ApiError(`Erreur ${res.status}`);
      return res.json();
    }));
    if (demoFiles.size > 60) demoFiles.delete(demoFiles.keys().next().value);
  }
  return demoFiles.get(path);
}

function friendly(err) {
  if (err instanceof ApiError || err.refused) return err.message;
  if (err.name === 'TimeoutError') return 'Le serveur IPTV ne répond pas.';
  if (err.name === 'TypeError') return UNREACHABLE; // échec réseau, CORS ou contenu mixte : le navigateur ne les distingue pas
  return err.message;
}

const newId = () => Math.random().toString(36).slice(2, 8).padEnd(6, '0');

export async function createBackend() {
  const saved = readJson(CONFIG_KEY, {});
  const config = {
    data: { sources: saved.sources || [], settings: { tmdbKey: '', ...saved.settings } },
    save() { writeJson(CONFIG_KEY, this.data); },
  };
  const secure = location.protocol === 'https:';

  async function load(source, settings) {
    try {
      if (source.type === 'xtream') return await xtreamData(new Xtream(source), settings);
      let text;
      if (source.file) {
        text = await idb.get(source.file);
        if (typeof text !== 'string') throw new ApiError('Le fichier importé n\'est plus disponible dans ce navigateur : importez-le de nouveau.');
      } else {
        const res = await fetch(source.url, { signal: AbortSignal.timeout(180_000) });
        if (!res.ok) throw new ApiError(`La playlist a répondu ${res.status}`);
        text = await res.text();
      }
      const data = m3uData(text);
      const all = [...data.channels, ...data.movies, ...data.series.flatMap((s) => s.episodes)];
      if (secure && all.filter((e) => /^http:/i.test(e.url)).length > all.length / 2) {
        data.warnings.push('les flux de cette playlist sont en HTTP : depuis cette page (HTTPS) le navigateur refusera de les lire. Installez Séance chez vous pour les regarder.');
      }
      return data;
    } catch (err) {
      throw new ApiError(friendly(err));
    }
  }

  const [cachedCatalog, cachedTmdb] = await Promise.all([idb.get('catalog'), idb.get('tmdb')]);
  const catalog = new Catalog({
    config,
    cache: persisted({ catalog: cachedCatalog ?? null }, (d) => (d.catalog ? idb.set('catalog', d.catalog) : idb.del('catalog'))),
    xtream: (source) => new Xtream(source),
    load,
  });
  const tmdb = new Tmdb(config, persisted(cachedTmdb ?? { matches: {}, genres: {} }, (d) => idb.set('tmdb', d)));
  const preloaded = new Map();
  const enrich = () => tmdb.enrichAll(catalog).catch(() => {});
  catalog.listeners.push(enrich);
  const refresh = (pre) => catalog.refresh(pre).catch((err) => console.error('[catalogue]', err));
  const isDemo = () => catalog.sources.length === 0;

  if (!isDemo()) {
    if (catalog.stale) refresh();
    else enrich();
  }

  async function status() {
    const settings = {
      tmdb: tmdb.enabled,
      showAdult: config.data.settings.showAdult === true,
      liveFormat: config.data.settings.liveFormat === 'ts' ? 'ts' : 'm3u8',
    };
    if (isDemo()) {
      const demo = await demoJson('api/status.json');
      return { ...demo, static: true, demo: true, sources: [], settings, enrichment: tmdb.progress };
    }
    return {
      configured: true,
      static: true,
      demo: false,
      sources: catalog.sources.map((s) => ({
        id: s.id, type: s.type, name: s.name, username: s.username || '', account: s.account || null,
        host: s.url ? new URL(s.url).host : 'fichier importé',
      })),
      settings,
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
    };
  }

  async function addSource(body) {
    let source;
    const x = body.type === 'xtream' ? body : body.type === 'm3u' && body.url && xtreamFromM3uUrl(body.url);
    if (x) {
      if (!x.url || !x.username || !x.password) throw new ApiError('Adresse, identifiant et mot de passe sont requis');
      let bases;
      try { bases = directCandidates(x.url, location.protocol); } catch { throw new ApiError('Adresse du serveur invalide'); }
      let failure;
      for (const base of bases) {
        const candidate = { id: newId(), type: 'xtream', name: body.name?.trim() || new URL(base).hostname, url: base, username: x.username.trim(), password: x.password };
        try {
          candidate.account = await new Xtream(candidate).account();
          source = candidate;
          break;
        } catch (err) {
          failure = err;
          if (err.refused) break; // le serveur répond : inutile d'essayer une autre adresse
        }
      }
      if (!source) throw new ApiError(friendly(failure));
    } else if (body.type === 'm3u') {
      source = { id: newId(), type: 'm3u', name: body.name?.trim() || 'Playlist' };
      if (typeof body.content === 'string' && body.content.trim()) {
        source.file = `m3u:${source.id}`;
        await idb.set(source.file, body.content);
      } else {
        try { source.url = new URL(body.url).href; } catch { throw new ApiError('Adresse de playlist invalide'); }
        if (!/^https?:$/.test(new URL(source.url).protocol)) throw new ApiError('Adresse de playlist invalide');
        if (!body.name?.trim()) source.name = new URL(source.url).hostname;
      }
      try {
        preloaded.set(source.id, await catalog.probe(source));
      } catch (err) {
        if (source.file) idb.del(source.file);
        throw new ApiError(`Playlist illisible. ${err.message}`);
      }
    } else {
      throw new ApiError('Type de source inconnu');
    }
    config.data.sources.push(source);
    config.save();
    refresh(preloaded);
    return { ok: true, id: source.id };
  }

  async function removeSource(id) {
    const source = catalog.source(id);
    if (!source) throw new ApiError('Source inconnue');
    config.data.sources = config.data.sources.filter((s) => s.id !== id);
    config.save();
    if (source.file) idb.del(source.file);
    if (catalog.sources.length) refresh();
    else catalog.clear();
    return { ok: true };
  }

  async function saveSettings(body) {
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
          throw new ApiError(err.fatal ? 'Clé TMDB refusée' : 'TMDB est injoignable pour le moment.');
        }
      } else {
        tmdb.stop();
      }
    }
    if (typeof body.showAdult === 'boolean' && settings.showAdult !== body.showAdult) { settings.showAdult = body.showAdult; reload = true; }
    if (['ts', 'm3u8'].includes(body.liveFormat) && settings.liveFormat !== body.liveFormat) { settings.liveFormat = body.liveFormat; reload = true; }
    config.save();
    if (reload && !isDemo()) refresh();
    else enrich();
    return { ok: true };
  }

  function play(id) {
    if (isDemo()) {
      // Tout le catalogue de démonstration pointe vers les deux clips de test.
      return id.startsWith('c-') ? { url: 'demo/media/live/index.m3u8', type: 'hls' } : { url: 'demo/media/film.mp4', type: 'file' };
    }
    const target = catalog.resolve(id);
    if (!target) throw new ApiError('Flux introuvable');
    // Lecture directe : pas de relais, le navigateur s'adresse au fournisseur.
    const out = { url: target.url, type: target.type, external: target.url, direct: true };
    const ref = catalog.split(id);
    if (ref?.kind === 'c' && ref.source?.type === 'xtream') {
      const other = target.type === 'hls' ? 'ts' : 'm3u8';
      out.alt = { url: target.url.replace(/\.(m3u8|ts)$/i, `.${other}`), type: other === 'ts' ? 'mpegts' : 'hls' };
    }
    return out;
  }

  async function demoEpg(id) {
    const list = await demoJson(`api/epg/${id}.json`);
    // Le programme fictif est recalé sur l'heure courante.
    const slot = 3600;
    const start = Math.floor(Date.now() / 1000 / slot) * slot;
    return list.map((p, i) => ({ ...p, start: start + i * slot, end: start + (i + 1) * slot }));
  }

  function writeState(method, path, body) {
    const state = { favorites: {}, progress: {}, ...readJson(STATE_KEY, {}) };
    if (path === '/api/state/favorite') {
      if (body.on) state.favorites[body.id] = Date.now();
      else delete state.favorites[body.id];
    } else {
      if (body.remove) delete state.progress[body.id];
      else state.progress[body.id] = { ...body, ts: Date.now() };
      const keys = Object.keys(state.progress);
      if (keys.length > 400) keys.sort((a, b) => state.progress[a].ts - state.progress[b].ts).slice(0, keys.length - 400).forEach((k) => delete state.progress[k]);
    }
    writeJson(STATE_KEY, state);
    return { ok: true };
  }

  async function handle(method, path, body = {}) {
    const arg = (prefix) => decodeURIComponent(path.slice(prefix.length));
    const found = (value, what) => {
      if (!value) throw new ApiError(`${what} introuvable`);
      return value;
    };
    if (method === 'GET') {
      if (path === '/api/status') return status();
      if (path === '/api/state') return { favorites: {}, progress: {}, ...readJson(STATE_KEY, {}) };
      if (path === '/api/catalog') return isDemo() ? demoJson('api/catalog.json') : structuredClone(catalog.client());
      if (path.startsWith('/api/play/')) return play(arg('/api/play/'));
      if (path.startsWith('/api/movie/')) {
        const id = arg('/api/movie/');
        return isDemo() ? demoJson(`api/movie/${id}.json`) : found(await movieDetail(catalog, tmdb, id), 'Film');
      }
      if (path.startsWith('/api/series/')) {
        const id = arg('/api/series/');
        if (isDemo()) return demoJson(`api/series/${id}.json`);
        try {
          return found(await seriesDetail(catalog, id), 'Série');
        } catch (err) {
          throw new ApiError(err instanceof ApiError ? err.message : 'Le fournisseur n\'a pas renvoyé les épisodes.');
        }
      }
      if (path.startsWith('/api/epg/')) {
        const id = arg('/api/epg/');
        return isDemo() ? demoEpg(id) : epg(catalog, id).catch(() => []);
      }
    }
    if (method === 'POST' && path === '/api/sources') return addSource(body);
    if (method === 'DELETE' && path.startsWith('/api/sources/')) return removeSource(arg('/api/sources/'));
    if (method === 'POST' && path === '/api/refresh') { if (!isDemo()) refresh(); return { ok: true }; }
    if (method === 'PUT' && path === '/api/settings') return saveSettings(body);
    if (method === 'POST' && (path === '/api/state/favorite' || path === '/api/state/progress')) return writeState(method, path, body);
    throw new ApiError('Indisponible dans la version en ligne');
  }

  return { handle };
}
