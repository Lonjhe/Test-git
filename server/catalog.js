// Construction du catalogue unifié (films, séries, chaînes) à partir des sources
// configurées : nettoyage des titres, regroupement des versions, genres.
import fs from 'node:fs';
import path from 'node:path';
import { parseTitle, parseEpisode, detectGenres, cleanCategory, normKey, versionLabel } from '../shared/text.js';
import { Xtream, asArray, USER_AGENT } from './xtream.js';
import { parseM3u, classifyEntry, extOf, playbackType } from './m3u.js';
import { loadDemo } from './demo.js';
import { JsonFile, DATA_DIR, shortHash } from './store.js';

const ADULT = /\b(?:xxx|adult[es]?|porn|\+18|18\+)\b/i;
const MAX_AGE = 12 * 3600 * 1000;

function num(x) {
  const n = parseFloat(x);
  return Number.isFinite(n) ? n : 0;
}

function rating10(r) {
  const n = num(r.rating);
  if (n > 0) return Math.round(Math.min(n, 10) * 10) / 10;
  return Math.round(num(r.rating_5based) * 20) / 10;
}

function yearOf(s) {
  const m = String(s || '').match(/(19|20)\d{2}/);
  return m ? +m[0] : 0;
}

async function loadXtream(source, settings) {
  const x = new Xtream(source);
  const account = await x.account();
  const out = { movies: [], series: [], channels: [], account, warnings: [] };
  const liveExt = settings.liveFormat === 'ts' ? 'ts' : 'm3u8';

  const section = async (label, catAction, listAction, map) => {
    try {
      const cats = new Map(asArray(await x.call(catAction)).map((c) => [String(c.category_id), c.category_name || '']));
      for (const r of asArray(await x.call(listAction))) {
        const cat = cats.get(String(r.category_id)) || '';
        const item = map(r, cat);
        if (item) item.list.push(item.value);
      }
    } catch (err) {
      out.warnings.push(`${label} : ${err.message}`);
    }
  };

  await section('Chaînes', 'get_live_categories', 'get_live_streams', (r, cat) => r.stream_id != null && {
    list: out.channels,
    value: {
      key: String(r.stream_id), name: r.name || '', logo: r.stream_icon || '', cat, num: +r.num || 0,
      epgId: r.epg_channel_id || '', url: x.streamUrl('live', r.stream_id, liveExt),
    },
  });
  await section('Films', 'get_vod_categories', 'get_vod_streams', (r, cat) => r.stream_id != null && {
    list: out.movies,
    value: {
      key: String(r.stream_id), name: r.name || '', poster: r.stream_icon || '', rating: rating10(r),
      added: +r.added || 0, cat, ext: r.container_extension || 'mp4', tmdb: +(r.tmdb || r.tmdb_id) || 0,
      year: yearOf(r.year || r.release_date || r.releaseDate),
      url: x.streamUrl('movie', r.stream_id, r.container_extension || 'mp4'),
    },
  });
  await section('Séries', 'get_series_categories', 'get_series', (r, cat) => r.series_id != null && {
    list: out.series,
    value: {
      key: String(r.series_id), name: r.name || '', poster: r.cover || '', backdrop: asArray(r.backdrop_path)[0] || '',
      rating: rating10(r), added: +r.last_modified || 0, cat, plot: r.plot || '', genres: r.genre || '',
      year: yearOf(r.releaseDate || r.release_date || r.year),
    },
  });
  return out;
}

async function loadM3u(source) {
  let text;
  if (source.file) {
    text = fs.readFileSync(path.join(DATA_DIR, path.basename(source.file)), 'utf8');
  } else {
    const res = await fetch(source.url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(180_000) });
    if (!res.ok) throw new Error(`La playlist a répondu ${res.status}`);
    text = await res.text();
  }
  const entries = parseM3u(text);
  if (!entries.length) throw new Error('Aucune entrée trouvée dans la playlist (format M3U attendu)');

  const out = { movies: [], series: [], channels: [], warnings: [] };
  const shows = new Map();
  let chNum = 0;
  for (const e of entries) {
    const kind = classifyEntry(e);
    const key = shortHash(e.url);
    if (kind === 'live') {
      out.channels.push({ key, name: e.name, logo: e.logo, cat: e.group, num: ++chNum, epgId: e.epgId, url: e.url });
    } else if (kind === 'movie') {
      out.movies.push({ key, name: e.name, poster: e.logo, rating: 0, added: 0, cat: e.group, ext: extOf(e.url) || 'mp4', url: e.url });
    } else {
      const ep = parseEpisode(e.name) || { show: e.name, season: 1, episode: 1, title: '' };
      const showKey = normKey(parseTitle(ep.show).title);
      if (!shows.has(showKey)) {
        shows.set(showKey, {
          key: shortHash(showKey), name: ep.show, poster: e.logo, backdrop: '', rating: 0, added: 0,
          cat: e.group, plot: '', genres: '', year: 0, episodes: [],
        });
      }
      shows.get(showKey).episodes.push({
        key, season: ep.season, episode: ep.episode, title: ep.title, url: e.url, ext: extOf(e.url) || 'mp4',
      });
    }
  }
  out.series = [...shows.values()];
  return out;
}

const QUALITY_RANK = { FHD: 3, HD: 3, '': 2, SD: 1, '4K': 1, CAM: -2 };

/** Regroupe les différentes versions d'un même film (4K, VOSTFR…) sous une seule fiche. */
export function groupMovies(versions) {
  const groups = new Map();
  for (const v of versions) {
    const key = `${normKey(v.title)}|${v.year || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(v);
  }
  // Une version sans année rejoint la fiche datée si le titre n'existe qu'à une seule date.
  const yearsByTitle = new Map();
  for (const key of groups.keys()) {
    const [t, y] = key.split('|');
    if (y) yearsByTitle.set(t, [...(yearsByTitle.get(t) || []), y]);
  }
  for (const [key, list] of [...groups]) {
    const [t, y] = key.split('|');
    const years = yearsByTitle.get(t);
    if (!y && years?.length === 1) {
      groups.get(`${t}|${years[0]}`).push(...list);
      groups.delete(key);
    }
  }

  const movies = [];
  for (const list of groups.values()) {
    const score = (v) => (QUALITY_RANK[v.quality] ?? 2) + (v.ext === 'mp4' ? 0.5 : 0) + (v.poster ? 0.2 : 0);
    list.sort((a, b) => score(b) - score(a));
    const main = list[0];
    const pick = (f) => list.map(f).find(Boolean);
    const movie = {
      id: main.id,
      title: main.title,
      year: pick((v) => v.year) || 0,
      poster: pick((v) => v.poster) || '',
      backdrop: pick((v) => v.backdrop) || '',
      rating: Math.max(...list.map((v) => v.rating || 0)),
      added: Math.max(...list.map((v) => v.added || 0)),
      cat: main.cat,
      genres: pick((v) => v.genres?.length && v.genres) || [],
      quality: main.quality,
      tmdb: pick((v) => v.tmdb) || 0,
    };
    if (list.length > 1) {
      // Le conteneur (MP4, MKV…) n'est affiché que s'il distingue les versions.
      const sameExt = list.every((v) => v.ext === main.ext);
      const labels = list.map((v) => versionLabel(sameExt ? { ...v, ext: '' } : v) || 'Standard');
      const unique = new Set(labels).size === labels.length;
      movie.versions = list.map((v, i) => ({
        id: v.id, quality: v.quality, label: unique ? labels[i] : `${labels[i]} (${i + 1})`,
      }));
    }
    movies.push(movie);
  }
  return movies;
}

function build(results, settings) {
  const urls = {};
  const episodes = {};
  const extras = {};
  const versions = [];
  const series = [];
  const channels = [];
  const hide = (cat) => settings.showAdult !== true && ADULT.test(cat);

  for (const { source, data } of results) {
    const sid = source.id;
    for (const r of data.movies) {
      if (hide(r.cat)) continue;
      const p = parseTitle(r.name);
      const id = `m-${sid}-${r.key}`;
      urls[id] = { url: r.url, type: playbackType(r.url, 'movie') };
      if (r.plot || r.duration) extras[id] = { plot: r.plot || '', duration: r.duration || 0 };
      versions.push({
        id, title: p.title, year: r.year || p.year, quality: p.quality, hdr: p.hdr, lang: p.lang, ext: r.ext,
        poster: r.poster, backdrop: r.backdrop || '', rating: r.rating, added: r.added,
        cat: cleanCategory(r.cat), genres: r.genres || detectGenres(r.cat), tmdb: r.tmdb || 0,
      });
    }
    for (const r of data.series) {
      if (hide(r.cat)) continue;
      const p = parseTitle(r.name);
      const id = `s-${sid}-${r.key}`;
      const genres = detectGenres(r.genres);
      series.push({
        id, title: p.title, year: r.year || p.year, poster: r.poster, backdrop: r.backdrop, rating: r.rating,
        added: r.added, cat: cleanCategory(r.cat), genres: genres.length ? genres : detectGenres(r.cat), plot: r.plot,
      });
      if (r.episodes) {
        episodes[id] = r.episodes
          .sort((a, b) => a.season - b.season || a.episode - b.episode)
          .map((e) => {
            const eid = `e-${sid}-${e.key}`;
            urls[eid] = { url: e.url, type: playbackType(e.url, 'episode') };
            return { id: eid, season: e.season, episode: e.episode, title: e.title, plot: e.plot || '', duration: e.duration || 0, image: e.image || '' };
          });
      }
    }
    for (const r of data.channels) {
      if (hide(r.cat)) continue;
      const id = `c-${sid}-${r.key}`;
      urls[id] = { url: r.url, type: playbackType(r.url, 'live') };
      channels.push({ id, name: r.name.trim(), logo: r.logo, cat: cleanCategory(r.cat) || 'Autres', num: r.num, epgId: r.epgId });
    }
  }
  return { movies: groupMovies(versions), series, channels, urls, episodes, extras };
}

export class Catalog {
  constructor(config, { origin }) {
    this.config = config;
    this.origin = origin;
    this.cache = new JsonFile('cache/catalog.json', { catalog: null }, { secret: true });
    this.data = this.cache.data.catalog;
    this.version = this.data?.updatedAt || 0;
    this.loading = false;
    this.error = '';
    this.listeners = [];
  }

  get sources() {
    return this.config.data.sources;
  }

  source(id) {
    return this.sources.find((s) => s.id === id);
  }

  get stale() {
    if (!this.sources.length) return false;
    if (!this.data) return true;
    const ids = this.sources.map((s) => s.id).join(',');
    return this.data.sourceIds !== ids || Date.now() - this.data.updatedAt > MAX_AGE;
  }

  touch() {
    this.version = Date.now();
  }

  /** Charge une source seule (validation à l'ajout) ; le résultat peut être réutilisé par refresh(). */
  async probe(source) {
    return loadM3u(source);
  }

  async refresh(preloaded) {
    if (this.loading) {
      // Un rechargement est déjà en cours : on en relance un juste après pour prendre en compte les changements.
      this.pending = this.pending.then(() => this.refresh(preloaded));
      return this.pending;
    }
    this.loading = true;
    this.error = '';
    this.pending = this.#load(preloaded).finally(() => { this.loading = false; });
    return this.pending;
  }

  async #load(preloaded) {
    const settings = this.config.data.settings;
    const results = [];
    const warnings = [];
    for (const source of this.sources) {
      try {
        let data = preloaded?.get(source.id);
        preloaded?.delete(source.id);
        if (data) { /* déjà chargé lors de la validation */ } else if (source.type === 'xtream') data = await loadXtream(source, settings);
        else if (source.type === 'm3u') data = await loadM3u(source);
        else data = loadDemo(this.origin());
        results.push({ source, data });
        if (data.account) source.account = data.account;
        for (const w of data.warnings || []) warnings.push(`${source.name} — ${w}`);
      } catch (err) {
        const cause = err.cause?.code ? ` (${err.cause.code})` : '';
        warnings.push(`${source.name} — ${err.name === 'TimeoutError' ? 'le serveur ne répond pas' : err.message}${cause}`);
      }
    }
    if (!results.length && this.sources.length) {
      this.error = warnings.join(' · ');
      // On garde l'ancien catalogue s'il existe : mieux vaut des données d'hier que rien.
      if (this.data) return;
    }
    this.data = {
      ...build(results, settings),
      updatedAt: Date.now(),
      sourceIds: this.sources.map((s) => s.id).join(','),
      warnings,
    };
    this.cache.data.catalog = this.data;
    this.cache.save(50);
    this.config.save();
    this.touch();
    for (const fn of this.listeners) fn();
  }

  clear() {
    this.data = null;
    this.cache.data.catalog = null;
    this.cache.save(50);
    this.touch();
  }

  /** Vue envoyée à l'interface (sans les adresses de flux ni identifiants). */
  client() {
    const d = this.data;
    if (!d) return { version: this.version, movies: [], series: [], channels: [], warnings: [] };
    return { version: this.version, updatedAt: d.updatedAt, movies: d.movies, series: d.series, channels: d.channels, warnings: d.warnings };
  }

  /** Adresse réelle d'un flux à partir de son identifiant. */
  resolve(id) {
    const known = this.data?.urls[id];
    if (known) return known;
    // Épisodes Xtream : e-<source>-x<id>.<ext>
    const m = /^e-([^-]+)-x(\d+)\.([a-z0-9]+)$/i.exec(id);
    const source = m && this.source(m[1]);
    if (source?.type === 'xtream') {
      return { url: new Xtream(source).streamUrl('series', m[2], m[3]), type: 'file' };
    }
    return null;
  }

  split(id) {
    const m = /^([mces])-([^-]+)-(.+)$/.exec(id);
    return m ? { kind: m[1], source: this.source(m[2]), key: m[3] } : null;
  }

  findMovie(id) {
    return this.data?.movies.find((m) => m.id === id || m.versions?.some((v) => v.id === id));
  }
}
