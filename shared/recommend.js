// Moteur de recommandation « dans le même style ».
// Fonctions pures, utilisées côté interface (et testées côté Node).
//
// Chaque film est comparé au film de référence sur :
//  - les genres en commun (poids principal),
//  - les mots rares partagés dans le titre (sagas, suites),
//  - la proximité d'époque,
//  - la catégorie du fournisseur,
//  - les recommandations TMDB quand elles sont disponibles,
//  - et un léger bonus pour les films bien notés.

import { titleTokens } from './text.js';

const W = { genres: 5, primary: 0.6, title: 6, year: 1.5, category: 1, tmdb: 6, rating: 0.15 };

export function buildIndex(items) {
  const genreBit = new Map();
  const df = new Map();
  const entries = items.map((item) => {
    let mask = 0;
    for (const g of item.genres || []) {
      if (!genreBit.has(g) && genreBit.size < 31) genreBit.set(g, 1 << genreBit.size);
      mask |= genreBit.get(g) || 0;
    }
    const tokens = [...new Set(titleTokens(item.title))];
    for (const t of tokens) df.set(t, (df.get(t) || 0) + 1);
    return { item, mask, tokens, primary: item.genres?.[0] || '' };
  });
  const n = Math.max(entries.length, 1);
  const idf = (t) => Math.log(1 + n / (df.get(t) || 1));
  const byId = new Map();
  for (const e of entries) {
    e.weight = e.tokens.reduce((s, t) => s + idf(t), 0);
    byId.set(e.item.id, e);
  }
  // Rareté maximale d'un mot : sert à ne pas prendre un mot banal pour une saga.
  return { entries, byId, idf, genreBit, rare: Math.log(1 + n) };
}

function popcount(x) {
  x -= (x >> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
  return (((x + (x >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
}

/**
 * Affinité entre deux films. Vaut 0 s'ils n'ont rien en commun sur le fond
 * (genre, titre, catégorie) : la seule proximité d'époque ne suffit pas.
 */
function pairScore(index, a, b) {
  let s = 0;
  if (a.mask && b.mask) {
    const inter = popcount(a.mask & b.mask);
    if (inter) {
      s += W.genres * (inter / popcount(a.mask | b.mask));
      if (a.primary && a.primary === b.primary) s += W.primary;
    }
  }
  if (a.weight && b.weight) {
    let shared = 0;
    for (const t of a.tokens) if (b.tokens.includes(t)) shared += index.idf(t);
    if (shared) {
      // Une suite contient le titre d'origine : on regarde la part commune des deux côtés.
      const ratio = 0.5 * (shared / Math.min(a.weight, b.weight) + shared / Math.max(a.weight, b.weight));
      if (ratio >= 0.5) s += W.title * ratio * Math.min(1, shared / index.rare);
    }
  }
  if (a.item.cat && a.item.cat === b.item.cat) s += a.mask && b.mask ? W.category * 0.5 : W.category * 2;
  if (!s) return 0;
  const ya = a.item.year, yb = b.item.year;
  if (ya && yb) s += W.year * Math.exp(-Math.abs(ya - yb) / 10);
  return s;
}

function qualityPrior(item) {
  return W.rating * (item.rating > 0 ? item.rating : 5);
}

function top(scored, limit) {
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, limit).map((x) => x.item);
}

/**
 * Films les plus proches d'un film donné.
 * opts.recTmdbIds : identifiants TMDB recommandés pour ce film (optionnel).
 */
export function similarTo(index, id, opts = {}) {
  const seed = index.byId.get(id);
  if (!seed) return [];
  const { limit = 20, exclude, recTmdbIds = [] } = opts;
  const recRank = new Map(recTmdbIds.map((t, i) => [t, i]));
  const scored = [];
  for (const e of index.entries) {
    if (e === seed || exclude?.has(e.item.id)) continue;
    let score = pairScore(index, seed, e);
    if (e.item.tmdb && recRank.has(e.item.tmdb)) score += Math.max(2, W.tmdb - 0.1 * recRank.get(e.item.tmdb));
    if (score < 1.2) continue;
    scored.push({ item: e.item, score: score + qualityPrior(e.item) });
  }
  return top(scored, limit);
}

/**
 * Sélection personnalisée à partir de plusieurs films appréciés.
 * seeds : [{ id, weight }]
 */
export function forYou(index, seeds, opts = {}) {
  const { limit = 24, exclude } = opts;
  const list = seeds.map((s) => ({ e: index.byId.get(s.id), w: s.weight ?? 1 })).filter((s) => s.e);
  if (!list.length) return [];
  const seedIds = new Set(list.map((s) => s.e.item.id));
  const totalW = list.reduce((s, x) => s + x.w, 0);
  const scored = [];
  for (const e of index.entries) {
    if (seedIds.has(e.item.id) || exclude?.has(e.item.id)) continue;
    let sum = 0;
    let best = 0;
    for (const { e: seed, w } of list) {
      const p = pairScore(index, seed, e);
      sum += w * p;
      if (p > best) best = p;
    }
    // Mélange de l'affinité moyenne et de la meilleure affinité :
    // un film très proche d'un seul favori reste bien classé.
    const score = 0.6 * (sum / totalW) + 0.4 * best;
    if (score < 1.5) continue;
    scored.push({ item: e.item, score: score + qualityPrior(e.item) });
  }
  return top(scored, limit);
}

/**
 * Propositions selon des critères (genres, décennie, note minimale…),
 * tirées au sort avec une préférence pour les films bien notés.
 */
export function suggest(index, filters = {}, opts = {}) {
  const { limit = 12, rng = Math.random, exclude } = opts;
  const { genres = [], decade = 0, minRating = 0, quality = '' } = filters;
  const pool = [];
  for (const { item } of index.entries) {
    if (exclude?.has(item.id)) continue;
    if (genres.length && !genres.every((g) => item.genres?.includes(g))) continue;
    if (decade && !(item.year >= decade && item.year < decade + 10)) continue;
    if (minRating && !(item.rating >= minRating)) continue;
    if (quality && item.quality !== quality && !item.versions?.some((v) => v.quality === quality)) continue;
    // Tirage pondéré (Efraimidis–Spirakis) : clé = u^(1/poids).
    const weight = 1 + Math.max(0, (item.rating || 5) - 4) ** 2;
    pool.push({ item, score: Math.pow(rng(), 1 / weight) });
  }
  return top(pool, limit);
}
