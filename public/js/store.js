// État de l'application côté navigateur : catalogue, favoris, progression.
import { api } from './api.js';
import { buildIndex } from '/shared/recommend.js';
import { fold } from '/shared/text.js';

export const store = {
  status: null,
  version: -1,
  movies: [],
  series: [],
  channels: [],
  byId: new Map(),
  favorites: {},
  progress: {},
  indexes: {},
  // Contexte de lecture (titre, file d'attente d'épisodes ou de chaînes) transmis au lecteur.
  playContext: null,
};

export async function loadStatus() {
  store.status = await api.get('/api/status');
  return store.status;
}

export async function loadCatalog() {
  const c = await api.get('/api/catalog');
  store.version = c.version;
  store.movies = c.movies;
  store.series = c.series;
  store.channels = c.channels;
  store.byId = new Map();
  store.indexes = {};
  for (const m of c.movies) {
    m.kind = 'movie';
    m.search = fold(m.title);
    store.byId.set(m.id, m);
    for (const v of m.versions || []) store.byId.set(v.id, m);
  }
  for (const s of c.series) {
    s.kind = 'series';
    s.search = fold(s.title);
    store.byId.set(s.id, s);
  }
  for (const ch of c.channels) {
    ch.kind = 'channel';
    ch.title = ch.name;
    ch.search = fold(ch.name);
    store.byId.set(ch.id, ch);
  }
}

export async function loadState() {
  const s = await api.get('/api/state');
  store.favorites = s.favorites || {};
  store.progress = s.progress || {};
}

/** Index de recommandation, construit à la première utilisation. */
export function indexOf(kind) {
  return (store.indexes[kind] ??= buildIndex(kind === 'series' ? store.series : store.movies));
}

export function genresOf(items) {
  const counts = new Map();
  for (const it of items) for (const g of it.genres || []) counts.set(g, (counts.get(g) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}

export const isFav = (id) => id in store.favorites;

export function toggleFav(id) {
  const on = !isFav(id);
  if (on) store.favorites[id] = Date.now();
  else delete store.favorites[id];
  api.post('/api/state/favorite', { id, on }).catch(() => {});
  return on;
}

export function favorites(kind) {
  return Object.entries(store.favorites)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => store.byId.get(id))
    .filter((it) => it && (!kind || it.kind === kind));
}

export function saveProgress(entry) {
  store.progress[entry.id] = { ...entry, ts: Date.now() };
  api.post('/api/state/progress', entry).catch(() => {});
}

export function clearProgress(id) {
  delete store.progress[id];
  api.post('/api/state/progress', { id, remove: true }).catch(() => {});
}

/** Fraction vue (0–1) d'un film ou d'un épisode, 0 si jamais commencé. */
export function watchedFraction(id) {
  const p = store.progress[id];
  if (!p) return 0;
  if (p.done) return 1;
  return p.dur > 0 ? Math.min(1, p.pos / p.dur) : 0;
}

/** Lectures en cours, la plus récente d'abord (un seul épisode par série). */
export function continueWatching() {
  const seen = new Set();
  const out = [];
  const entries = Object.entries(store.progress).sort((a, b) => b[1].ts - a[1].ts);
  for (const [id, p] of entries) {
    if (p.done || p.pos < 20) continue;
    const group = p.parent || id;
    if (seen.has(group)) continue;
    seen.add(group);
    if (p.kind === 'movie' && !store.byId.has(id)) continue;
    out.push({ id, ...p });
  }
  return out;
}

/** Films servant de base aux recommandations personnalisées. */
export function tasteSeeds() {
  const seeds = new Map();
  for (const m of favorites('movie').slice(0, 10)) seeds.set(m.id, 1);
  const watched = Object.entries(store.progress)
    .filter(([id, p]) => p.kind === 'movie' && store.byId.has(id))
    .sort((a, b) => b[1].ts - a[1].ts)
    .slice(0, 8);
  for (const [id, p] of watched) if (!seeds.has(id)) seeds.set(id, p.done ? 1 : 0.6);
  return [...seeds].map(([id, weight]) => ({ id, weight }));
}

export function search(list, query, limit = 60) {
  const q = fold(query).trim();
  if (!q) return [];
  const words = q.split(/\s+/);
  const hits = [];
  for (const item of list) {
    const s = item.search;
    if (!words.every((w) => s.includes(w))) continue;
    const rank = s === q ? 0 : s.startsWith(q) ? 1 : ` ${s}`.includes(` ${words[0]}`) ? 2 : 3;
    hits.push({ item, rank });
  }
  hits.sort((a, b) => a.rank - b.rank || (b.item.rating || 0) - (a.item.rating || 0));
  return hits.slice(0, limit).map((x) => x.item);
}
