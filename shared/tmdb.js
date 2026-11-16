// Enrichissement facultatif via TMDB (themoviedb.org) : genres précis, résumés
// en français, images, distribution et recommandations.
// Code partagé : tourne sur le serveur comme dans le navigateur (TMDB accepte les
// appels directs depuis une page web).
import { normKey } from './text.js';

const BASE = globalThis.process?.env?.TMDB_BASE_URL || 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';
export const tmdbImage = (p, size) => (p ? `${IMG}/${size}${p}` : '');

export class Tmdb {
  constructor(config, cache) {
    this.config = config;
    this.cache = cache; // JsonFile { matches: {clé: résumé|null}, genres: {id: nom} }
    this.details = new Map();
    this.progress = { running: false, done: 0, total: 0, error: '' };
  }

  get key() {
    return (this.config.data.settings.tmdbKey || '').trim();
  }

  get enabled() {
    return !!this.key;
  }

  async api(path, params = {}) {
    const u = new URL(BASE + path);
    u.searchParams.set('language', 'fr-FR');
    for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
    const headers = { Accept: 'application/json' };
    // Jeton « v4 » (JWT) en en-tête, clé « v3 » en paramètre.
    if (this.key.startsWith('eyJ')) headers.Authorization = `Bearer ${this.key}`;
    else u.searchParams.set('api_key', this.key);
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(u, { headers, signal: AbortSignal.timeout(20_000) });
      if (res.status === 429 && attempt < 4) {
        await new Promise((r) => setTimeout(r, (+res.headers.get('retry-after') || 2) * 1000));
        continue;
      }
      if (res.status === 401) throw Object.assign(new Error('Clé TMDB refusée'), { fatal: true });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`TMDB a répondu ${res.status}`);
      return res.json();
    }
  }

  async check() {
    await this.api('/configuration');
  }

  async genreNames() {
    const g = this.cache.data.genres;
    if (g && Object.keys(g).length) return g;
    const data = await this.api('/genre/movie/list');
    this.cache.data.genres = Object.fromEntries((data?.genres || []).map((x) => [x.id, x.name]));
    this.cache.save();
    return this.cache.data.genres;
  }

  summary(r, names) {
    return {
      id: r.id,
      genres: (r.genre_ids || (r.genres || []).map((g) => g.id)).map((id) => names[id]).filter(Boolean),
      poster: r.poster_path || '',
      backdrop: r.backdrop_path || '',
      vote: r.vote_count >= 5 ? Math.round(r.vote_average * 10) / 10 : 0,
      year: +(r.release_date || '').slice(0, 4) || 0,
    };
  }

  /** Trouve la fiche TMDB d'un film du catalogue (résultat mis en cache, y compris les échecs). */
  async match(movie) {
    const key = movie.tmdb ? `id:${movie.tmdb}` : `${normKey(movie.title)}|${movie.year || ''}`;
    const matches = this.cache.data.matches;
    if (key in matches) return matches[key];
    const names = await this.genreNames();
    let found = null;
    if (movie.tmdb) {
      const r = await this.api(`/movie/${movie.tmdb}`);
      if (r) found = this.summary(r, names);
    } else {
      let data = await this.api('/search/movie', { query: movie.title, year: movie.year || '', include_adult: 'false' });
      if (!data?.results?.length && movie.year) data = await this.api('/search/movie', { query: movie.title, include_adult: 'false' });
      const results = data?.results || [];
      const wanted = normKey(movie.title);
      const exact = results.find((r) => normKey(r.title) === wanted || normKey(r.original_title) === wanted);
      const best = exact || results[0];
      if (best) found = this.summary(best, names);
    }
    matches[key] = found;
    this.cache.save(5000);
    return found;
  }

  cached(movie) {
    const key = movie.tmdb ? `id:${movie.tmdb}` : `${normKey(movie.title)}|${movie.year || ''}`;
    return this.cache.data.matches[key];
  }

  /** Reporte les informations TMDB sur une fiche du catalogue. */
  static apply(movie, t) {
    if (!t) return;
    movie.tmdb = t.id;
    if (t.genres.length) movie.genres = t.genres;
    if (t.backdrop) movie.backdrop = tmdbImage(t.backdrop, 'w1280');
    if (!movie.poster && t.poster) movie.poster = tmdbImage(t.poster, 'w500');
    if (t.vote) movie.rating = t.vote;
    if (!movie.year && t.year) movie.year = t.year;
  }

  /** Fiche complète : résumé, durée, distribution, films recommandés. */
  async movieDetails(id) {
    if (this.details.has(id)) return this.details.get(id);
    const r = await this.api(`/movie/${id}`, { append_to_response: 'credits,recommendations,similar,videos' });
    if (!r) return null;
    const trailer = (r.videos?.results || []).find((v) => v.site === 'YouTube' && v.type === 'Trailer');
    const recs = [...(r.recommendations?.results || []), ...(r.similar?.results || [])].map((x) => x.id);
    const d = {
      plot: r.overview || '',
      tagline: r.tagline || '',
      duration: r.runtime || 0,
      genres: (r.genres || []).map((g) => g.name),
      cast: (r.credits?.cast || []).slice(0, 8).map((c) => c.name),
      director: (r.credits?.crew || []).filter((c) => c.job === 'Director').map((c) => c.name).join(', '),
      backdrop: tmdbImage(r.backdrop_path, 'w1280'),
      rating: r.vote_count >= 5 ? Math.round(r.vote_average * 10) / 10 : 0,
      trailer: trailer?.key || '',
      recTmdbIds: [...new Set(recs)],
    };
    if (this.details.size > 500) this.details.clear();
    this.details.set(id, d);
    return d;
  }

  /**
   * Parcourt tout le catalogue en tâche de fond pour récupérer les genres.
   * Reprend là où il s'était arrêté grâce au cache.
   */
  async enrichAll(catalog) {
    if (!this.enabled || this.progress.running || !catalog.data) return;
    const movies = catalog.data.movies;
    let changed = 0;
    for (const m of movies) {
      const hit = this.cached(m);
      if (hit && m.tmdb !== hit.id) { Tmdb.apply(m, hit); changed++; }
    }
    if (changed) catalog.touch();
    const todo = movies.filter((m) => this.cached(m) === undefined);
    this.progress = { running: todo.length > 0, done: movies.length - todo.length, total: movies.length, error: '' };
    if (!todo.length) return;

    let next = 0;
    let failures = 0;
    let sinceTouch = 0;
    const worker = async () => {
      while (next < todo.length && this.progress.running) {
        const movie = todo[next++];
        try {
          Tmdb.apply(movie, await this.match(movie));
          failures = 0;
        } catch (err) {
          if (err.fatal || ++failures > 8) {
            this.progress.error = err.message;
            this.progress.running = false;
            return;
          }
        }
        this.progress.done++;
        if (++sinceTouch >= 200) { sinceTouch = 0; catalog.touch(); }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    const stopped = !this.progress.running;
    this.progress.running = false;
    this.cache.save(50);
    catalog.cache.save(50);
    catalog.touch();
    // Le catalogue a été rechargé entre-temps : on complète les nouveaux films.
    if (!stopped && catalog.data?.movies !== movies) return this.enrichAll(catalog);
  }

  stop() {
    this.progress.running = false;
  }
}
