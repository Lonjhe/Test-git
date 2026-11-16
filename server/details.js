// Fiches détaillées (film, série) et guide des programmes, chargés à la demande.
import { detectGenres, parseEpisode } from '../shared/text.js';
import { Xtream, asArray, b64 } from './xtream.js';
import { demoEpg } from './demo.js';

const memo = new Map();
async function cached(key, ttlMs, fn) {
  const hit = memo.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await fn();
  if (memo.size > 400) memo.clear();
  memo.set(key, { value, until: Date.now() + ttlMs });
  return value;
}

const people = (s) => String(s || '').split(/[,/]/).map((x) => x.trim()).filter(Boolean).slice(0, 8);

function minutes(info) {
  if (+info.duration_secs > 0) return Math.round(info.duration_secs / 60);
  const m = String(info.duration || '').match(/^(\d+):(\d+)(?::(\d+))?$/);
  if (m) return m[3] !== undefined ? +m[1] * 60 + +m[2] : +m[1];
  return 0;
}

export async function movieDetail(catalog, tmdb, id) {
  const movie = catalog.findMovie(id);
  if (!movie) return null;
  const detail = { ...movie, plot: '', duration: 0, cast: [], director: '', trailer: '', recTmdbIds: [] };
  Object.assign(detail, catalog.data.extras[movie.id] || {});

  const ref = catalog.split(movie.id);
  if (ref?.source?.type === 'xtream') {
    try {
      const data = await cached(`vod:${movie.id}`, 6 * 3600e3, () => new Xtream(ref.source).call('get_vod_info', { vod_id: ref.key }, 20_000));
      const info = (!Array.isArray(data?.info) && data?.info) || {};
      detail.plot = info.plot || info.description || '';
      detail.duration = minutes(info);
      detail.cast = people(info.cast || info.actors);
      detail.director = String(info.director || '').trim();
      detail.trailer = String(info.youtube_trailer || '').trim();
      detail.backdrop = detail.backdrop || asArray(info.backdrop_path)[0] || '';
      if (!detail.genres.length) detail.genres = detectGenres(info.genre);
      if (!detail.tmdb && +info.tmdb_id) detail.tmdb = +info.tmdb_id;
      if (!detail.year) detail.year = +String(info.releasedate || info.release_date || '').slice(0, 4) || 0;
    } catch { /* la fiche du fournisseur est un plus, pas un prérequis */ }
  }

  if (tmdb.enabled) {
    try {
      if (!detail.tmdb) detail.tmdb = (await tmdb.match(detail))?.id || 0;
      const t = detail.tmdb && (await tmdb.movieDetails(detail.tmdb));
      if (t) {
        for (const k of ['plot', 'duration', 'director', 'trailer', 'backdrop', 'rating']) if (t[k]) detail[k] = t[k];
        if (t.genres.length) detail.genres = t.genres;
        if (t.cast.length) detail.cast = t.cast;
        detail.tagline = t.tagline;
        detail.recTmdbIds = t.recTmdbIds;
      }
    } catch { /* TMDB indisponible : on affiche ce qu'on a */ }
  }
  return detail;
}

export async function seriesDetail(catalog, id) {
  const serie = catalog.data?.series.find((s) => s.id === id);
  if (!serie) return null;
  const detail = { ...serie, cast: [], director: '', trailer: '', episodes: catalog.data.episodes[id] || [] };
  const ref = catalog.split(id);
  if (ref?.source?.type === 'xtream') {
    const data = await cached(`ser:${id}`, 30 * 60e3, () => new Xtream(ref.source).call('get_series_info', { series_id: ref.key }, 30_000));
    const info = (!Array.isArray(data?.info) && data?.info) || {};
    detail.plot = info.plot || detail.plot;
    detail.cast = people(info.cast);
    detail.director = String(info.director || '').trim();
    detail.trailer = String(info.youtube_trailer || '').trim();
    detail.backdrop = detail.backdrop || asArray(info.backdrop_path)[0] || '';
    const episodes = [];
    const seasons = data?.episodes || {};
    for (const [seasonKey, list] of Object.entries(seasons)) {
      for (const e of asArray(list)) {
        const info2 = (!Array.isArray(e.info) && e.info) || {};
        const parsed = parseEpisode(e.title || '');
        episodes.push({
          id: `e-${ref.source.id}-x${e.id}.${e.container_extension || 'mp4'}`,
          season: +e.season || +seasonKey || 1,
          episode: +e.episode_num || 0,
          title: (parsed ? parsed.title : e.title) || '',
          plot: info2.plot || '',
          duration: minutes(info2),
          image: info2.movie_image || info2.cover_big || '',
        });
      }
    }
    detail.episodes = episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
  }
  return detail;
}

/** Programme en cours et suivant d'une chaîne. */
export async function epg(catalog, id) {
  const ref = catalog.split(id);
  const channel = catalog.data?.channels.find((c) => c.id === id);
  if (!ref?.source || !channel) return [];
  if (ref.source.type === 'demo') return demoEpg(channel.name);
  if (ref.source.type !== 'xtream') return [];
  return cached(`epg:${id}`, 5 * 60e3, async () => {
    const data = await new Xtream(ref.source).call('get_short_epg', { stream_id: ref.key, limit: 3 }, 15_000);
    const now = Date.now() / 1000;
    return asArray(data?.epg_listings)
      .map((p) => ({ title: b64(p.title), desc: b64(p.description), start: +p.start_timestamp || 0, end: +p.stop_timestamp || 0 }))
      .filter((p) => p.end > now)
      .slice(0, 2);
  });
}
